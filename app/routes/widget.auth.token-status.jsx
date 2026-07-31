import { ConversationIdSchema } from "../contracts/commerce.schemas.server";
import { authenticateAppProxyContext } from "../security/app-proxy-context.server";
import { withConversationContext } from "../security/merchant-context.server";
import { getCustomerTokenStatus } from "../services/customer-token.server";

export async function loader({ request }) {
  const { context } = await authenticateAppProxyContext(request);
  const conversationId = ConversationIdSchema.parse(
    new URL(request.url).searchParams.get("conversation_id")
  );
  const token = await getCustomerTokenStatus(
    withConversationContext(context, conversationId),
    conversationId
  );
  return Response.json(token
    ? { status: "authorized", expires_at: token.expiresAt.toISOString() }
    : { status: "unauthorized" }, {
    headers: { "Cache-Control": "no-store" }
  });
}
