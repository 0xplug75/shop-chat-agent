import { z } from "zod";
import { ConversationIdSchema } from "../contracts/commerce.schemas.server";
import { authenticateAppProxyContext } from "../security/app-proxy-context.server";
import { requireWidgetRequestContext } from "../security/merchant-context.server";
import { WidgetTokenError } from "../security/widget-token.server";
import {
  readJsonBodyWithLimit,
  RequestTooLargeError,
} from "../services/chat-request.server";
import { getCustomerTokenStatus } from "../services/customer-token.server";

const MAX_TOKEN_STATUS_BYTES = 12 * 1024;
const TokenStatusRequestSchema = z
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
    body = await readJsonBodyWithLimit(request, MAX_TOKEN_STATUS_BYTES);
  } catch (error) {
    return json(
      {
        error:
          error instanceof RequestTooLargeError
            ? "Request is too large"
            : "Invalid JSON",
      },
      error instanceof RequestTooLargeError ? 413 : 400,
      proxy.context.requestId,
    );
  }

  const parsed = TokenStatusRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "Invalid token status request" },
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
    const token = await getCustomerTokenStatus(
      context,
      parsed.data.conversation_id,
    );
    return json(
      token
        ? { status: "authorized", expires_at: token.expiresAt.toISOString() }
        : { status: "unauthorized" },
      200,
      context.requestId,
    );
  } catch (error) {
    if (error instanceof WidgetTokenError) {
      return json({ error: "Unauthorized" }, 401, proxy.context.requestId);
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
