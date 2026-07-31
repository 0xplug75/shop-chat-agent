import { assertAllowedOrigin, buildCorsHeaders, CorsOriginError } from "../lib/cors.server";
import { requireWidgetRequestContext } from "../security/merchant-context.server";
import { WidgetTokenError } from "../security/widget-token.server";
import { requireActiveShopById } from "../services/shop.server";
import { handlePublicChatRequest } from "../services/chat-request.server";

export async function loader({ request }) {
  return handleDirectRequest(request);
}

export async function action({ request }) {
  return handleDirectRequest(request);
}

async function handleDirectRequest(request) {
  const cors = buildCorsHeaders(request, {
    methods: "GET, POST, OPTIONS",
    allowedHeaders: "Content-Type, Accept, Authorization, X-Request-Id"
  });
  try {
    assertAllowedOrigin(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const context = requireWidgetRequestContext(request);
    const shop = await requireActiveShopById(context.shopId);
    if (shop.shopDomain !== context.shopDomain) throw new WidgetTokenError();
    return handlePublicChatRequest({ request, context, responseHeaders: cors });
  } catch (error) {
    const status = error instanceof CorsOriginError
      ? 403
      : error instanceof WidgetTokenError
        ? 401
        : Number(error.status || 500);
    return Response.json({
      error: status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Request failed"
    }, { status, headers: cors });
  }
}
