import { ConversationIdSchema } from "../contracts/commerce.schemas.server";
import { assertAllowedOrigin, buildCorsHeaders } from "../lib/cors.server";
import { requireWidgetRequestContext } from "../security/merchant-context.server";
import { getCustomerTokenStatus } from "../services/customer-token.server";

export async function loader({ request }) {
  const cors = buildCorsHeaders(request, {
    methods: "GET, OPTIONS",
    allowedHeaders: "Accept, Authorization, X-Request-Id"
  });
  try {
    assertAllowedOrigin(request);
    const conversationId = ConversationIdSchema.parse(
      new URL(request.url).searchParams.get("conversation_id")
    );
    const context = requireWidgetRequestContext(request, { conversationId });
    return tokenStatusResponse(context, conversationId, cors);
  } catch (error) {
    return Response.json({ error: "Unauthorized" }, {
      status: Number(error.status || 401),
      headers: cors
    });
  }
}

export async function action({ request }) {
  const cors = buildCorsHeaders(request, {
    methods: "GET, OPTIONS",
    allowedHeaders: "Accept, Authorization, X-Request-Id"
  });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors });
}

async function tokenStatusResponse(context, conversationId, headers = {}) {
  const token = await getCustomerTokenStatus(context, conversationId);
  return Response.json(token
    ? { status: "authorized", expires_at: token.expiresAt.toISOString() }
    : { status: "unauthorized" }, {
    headers: { "Cache-Control": "no-store", ...headers }
  });
}
