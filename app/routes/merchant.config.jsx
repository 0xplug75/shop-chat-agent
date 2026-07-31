import { buildCorsHeaders, assertAllowedOrigin } from "../lib/cors.server";
import { requireWidgetRequestContext } from "../security/merchant-context.server";
import { getMerchantConfig } from "../merchant/merchant.server";
import { toPublicMerchantConfig } from "../merchant/public-config.server";

export async function loader({ request }) {
  const cors = corsHeaders(request);
  try {
    assertAllowedOrigin(request);
    const context = requireWidgetRequestContext(request);
    const merchantConfig = await getMerchantConfig(context);
    return Response.json(toPublicMerchantConfig(merchantConfig), {
      headers: { "Cache-Control": "no-store", ...cors }
    });
  } catch (error) {
    return Response.json({ error: "Unauthorized" }, {
      status: Number(error.status || 401),
      headers: cors
    });
  }
}

export async function action({ request }) {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  return Response.json({ error: "Method not allowed" }, { status: 405, headers });
}

function corsHeaders(request) {
  return buildCorsHeaders(request, {
    methods: "GET, OPTIONS",
    allowedHeaders: "Accept, Authorization, X-Request-Id"
  });
}
