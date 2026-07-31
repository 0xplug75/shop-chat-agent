import { normalizeStorefrontOrigin } from "./shopify-domain.server";
import { verifyWidgetToken, WidgetTokenError } from "./widget-token.server";

export function createMerchantRequestContext({
  shopId,
  shopDomain,
  installationId,
  conversationId,
  customerId,
  requestId,
  storefrontOrigin
}) {
  if (!shopId || !shopDomain) {
    throw new Error("Merchant context requires a shop");
  }

  return Object.freeze({
    shopId,
    shopDomain,
    installationId: installationId || undefined,
    conversationId: conversationId || undefined,
    customerId: customerId || undefined,
    requestId: requestId || crypto.randomUUID(),
    storefrontOrigin: storefrontOrigin || undefined
  });
}

export function requireWidgetRequestContext(request, { conversationId } = {}) {
  const token = getBearerToken(request);
  const claims = verifyWidgetToken(token);
  const requestOrigin = normalizeStorefrontOrigin(request.headers.get("Origin"));

  if (claims.storefrontOrigin && requestOrigin !== claims.storefrontOrigin) {
    throw new WidgetTokenError("Widget token origin mismatch");
  }

  return createMerchantRequestContext({
    shopId: claims.shopId,
    shopDomain: claims.shopDomain,
    conversationId,
    requestId: getRequestId(request),
    storefrontOrigin: claims.storefrontOrigin
  });
}

export function getRequestId(request) {
  const supplied = request.headers.get("X-Request-Id");
  return supplied && /^[a-zA-Z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

export function withConversationContext(context, conversationId) {
  return createMerchantRequestContext({
    ...context,
    conversationId,
    requestId: context.requestId
  });
}

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new WidgetTokenError("Missing widget token");
  return match[1];
}
