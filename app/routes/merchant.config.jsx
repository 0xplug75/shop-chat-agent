import { getMerchantConfig } from "../merchant/merchant.server";
import { buildCorsHeaders } from "../lib/cors.server";

/**
 * Read-only storefront-safe merchant configuration endpoint.
 * Do not return the full merchant config from this route.
 */
export async function loader({ request }) {
  const merchantConfig = getMerchantConfig();

  return new Response(JSON.stringify(toPublicMerchantConfig(merchantConfig)), {
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request)
    }
  });
}

export async function action({ request }) {
  if (request.method.toLowerCase() === "options") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request)
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request)
    }
  });
}

function toPublicMerchantConfig(config) {
  return {
    assistant: {
      name: config.assistant.name,
      welcomeMessage: config.assistant.welcomeMessage,
      quickActions: config.assistant.quickActions
    },
    widget: {
      position: config.widget.position,
      layout: config.widget.layout,
      colors: config.widget.colors,
      behavior: config.widget.behavior
    }
  };
}

function corsHeaders(request) {
  return buildCorsHeaders(request, {
    methods: "GET, OPTIONS",
    allowedHeaders: "Content-Type, Accept",
    credentials: false
  });
}

