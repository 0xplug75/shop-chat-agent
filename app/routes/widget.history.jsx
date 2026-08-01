import { z } from "zod";
import { ConversationIdSchema } from "../contracts/commerce.schemas.server";
import { authenticateAppProxyContext } from "../security/app-proxy-context.server";
import { requireWidgetRequestContext } from "../security/merchant-context.server";
import { WidgetTokenError } from "../security/widget-token.server";
import {
  readJsonBodyWithLimit,
  RequestTooLargeError,
} from "../services/chat-request.server";
import {
  ConversationNotFoundError,
  getConversationHistory,
} from "../services/conversation.server";

const MAX_HISTORY_BYTES = 12 * 1024;
const HistoryRequestSchema = z
  .object({
    conversation_id: ConversationIdSchema,
    widget_token: z.string().min(1).max(8192),
  })
  .strict();

export async function loader() {
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

export async function action({ request }) {
  const proxy = await authenticateAppProxyContext(request);
  let body;
  try {
    body = await readJsonBodyWithLimit(request, MAX_HISTORY_BYTES);
  } catch (error) {
    return json(
      {
        error:
          error instanceof RequestTooLargeError
            ? "Request is too large"
            : "Invalid JSON request",
      },
      error instanceof RequestTooLargeError ? 413 : 400,
      proxy.context.requestId,
    );
  }

  const parsed = HistoryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "Invalid history request" },
      400,
      proxy.context.requestId,
    );
  }

  try {
    const context = requireWidgetRequestContext(request, {
      token: parsed.data.widget_token,
      expectedContext: proxy.context,
      conversationId: parsed.data.conversation_id,
      verifyOrigin: false,
    });
    const messages = await getConversationHistory(
      context,
      parsed.data.conversation_id,
    );
    return json({ messages }, 200, context.requestId);
  } catch (error) {
    if (error instanceof WidgetTokenError) {
      return json({ error: "Unauthorized" }, 401, proxy.context.requestId);
    }
    if (error instanceof ConversationNotFoundError) {
      return json({ error: "Not found" }, 404, proxy.context.requestId);
    }
    throw error;
  }
}

function json(body, status, requestId) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Request-Id": requestId,
    },
  });
}
