import {
  ChatRequestSchema,
  HistoryQuerySchema,
  formatZodError
} from "../contracts/commerce.schemas.server";
import { createLogger } from "../lib/logger.server";
import { withConversationContext } from "../security/merchant-context.server";
import { consumeWidgetRateLimit } from "../security/rate-limit.server";
import { createCommerceOrchestrator } from "./commerce-orchestrator.server";
import { getConversationHistory, ConversationNotFoundError } from "./conversation.server";
import { createSseStream } from "./streaming.server";

const MAX_REQUEST_BYTES = 32 * 1024;

export async function handlePublicChatRequest({ request, context, responseHeaders = {} }) {
  const logger = createLogger({
    requestId: context.requestId,
    shopId: context.shopId
  });
  const url = new URL(request.url);

  if (request.method === "GET" && url.searchParams.get("history") === "true") {
    const parsed = HistoryQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries())
    );
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid history request", requestId: context.requestId }, 400, responseHeaders);
    }

    try {
      const scopedContext = withConversationContext(context, parsed.data.conversation_id);
      const messages = await getConversationHistory(scopedContext, parsed.data.conversation_id);
      return jsonResponse({ messages }, 200, responseHeaders);
    } catch (error) {
      if (error instanceof ConversationNotFoundError) {
        return jsonResponse({ error: "Not found", requestId: context.requestId }, 404, responseHeaders);
      }
      logger.error("History request failed", { error });
      return jsonResponse({ error: "History is unavailable", requestId: context.requestId }, 500, responseHeaders);
    }
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed", requestId: context.requestId }, 405, responseHeaders);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "Request is too large", requestId: context.requestId }, 413, responseHeaders);
  }

  let rawBody;
  try {
    rawBody = await readJsonBodyWithLimit(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return jsonResponse({ error: "Request is too large", requestId: context.requestId }, 413, responseHeaders);
    }
    return jsonResponse({ error: "Invalid JSON request", requestId: context.requestId }, 400, responseHeaders);
  }
  const parsed = ChatRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    logger.warn("Chat payload rejected", { validation: formatZodError(parsed.error) });
    return jsonResponse({ error: "Invalid chat request", requestId: context.requestId }, 400, responseHeaders);
  }

  const scopedContext = parsed.data.conversation_id
    ? withConversationContext(context, parsed.data.conversation_id)
    : context;
  const rateLimit = consumeWidgetRateLimit(scopedContext);
  if (!rateLimit.allowed) {
    return jsonResponse({ error: "Too many requests", requestId: context.requestId }, 429, {
      ...responseHeaders,
      "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000))
    });
  }

  const orchestrator = createCommerceOrchestrator();
  const responseStream = createSseStream(async (stream) => {
    try {
      await orchestrator.handleTurn({
        context: scopedContext,
        message: parsed.data.message,
        conversationId: parsed.data.conversation_id || undefined,
        visitorId: parsed.data.visitor_id || undefined,
        promptType: parsed.data.prompt_type,
        stream
      });
    } catch (error) {
      logger.error("Commerce turn failed", { error });
      stream.sendMessage({
        type: error.status === 429 || error.status === 529
          ? "rate_limit_exceeded"
          : "error",
        error: error.publicMessage || "The shopping assistant is temporarily unavailable.",
        requestId: context.requestId
      });
    }
  }, { logger });

  return new Response(responseStream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Request-Id": context.requestId,
      ...responseHeaders
    }
  });
}

function jsonResponse(body, status, headers) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

export class RequestTooLargeError extends Error {
  constructor() {
    super("Request is too large");
    this.name = "RequestTooLargeError";
    this.status = 413;
  }
}

export async function readJsonBodyWithLimit(request, maxBytes = MAX_REQUEST_BYTES) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;

  try {
    while (!complete) {
      const { done, value } = await reader.read();
      complete = done;
      if (complete) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RequestTooLargeError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}
