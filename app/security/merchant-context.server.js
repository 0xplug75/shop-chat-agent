import { normalizeStorefrontOrigin } from "./shopify-domain.server";
import { verifyWidgetToken, WidgetTokenError } from "./widget-token.server";

export function createMerchantRequestContext({
  shopId,
  shopDomain,
  installationId,
  conversationId,
  visitorId,
  customerId,
  requestId,
  storefrontOrigin,
  tokenId,
  networkSubject,
}) {
  if (!shopId || !shopDomain) {
    throw new Error("Merchant context requires a shop");
  }

  return Object.freeze({
    shopId,
    shopDomain,
    installationId: installationId || undefined,
    conversationId: conversationId || undefined,
    visitorId: visitorId || undefined,
    customerId: customerId || undefined,
    requestId: requestId || crypto.randomUUID(),
    storefrontOrigin: storefrontOrigin || undefined,
    tokenId: tokenId || undefined,
    networkSubject: networkSubject || undefined,
  });
}

export function requireWidgetRequestContext(
  request,
  {
    conversationId,
    token: suppliedToken,
    expectedContext,
    verifyOrigin = true,
  } = {},
) {
  const token = suppliedToken || getBearerToken(request);
  const claims = verifyWidgetToken(token);
  const requestOrigin = verifyOrigin
    ? normalizeStorefrontOrigin(request.headers.get("Origin"))
    : null;

  if (
    verifyOrigin &&
    claims.storefrontOrigin &&
    requestOrigin !== claims.storefrontOrigin
  ) {
    throw new WidgetTokenError("Widget token origin mismatch");
  }
  if (
    expectedContext &&
    (claims.shopId !== expectedContext.shopId ||
      claims.shopDomain !== expectedContext.shopDomain ||
      (expectedContext.storefrontOrigin &&
        claims.storefrontOrigin !== expectedContext.storefrontOrigin))
  ) {
    throw new WidgetTokenError("Widget token tenant mismatch");
  }

  return createMerchantRequestContext({
    shopId: claims.shopId,
    shopDomain: claims.shopDomain,
    installationId: expectedContext?.installationId,
    conversationId,
    visitorId: claims.visitorId,
    requestId: getRequestId(request),
    storefrontOrigin: claims.storefrontOrigin,
    tokenId: claims.tokenId,
    networkSubject: expectedContext?.networkSubject,
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
    requestId: context.requestId,
  });
}

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new WidgetTokenError("Missing widget token");
  return match[1];
}
