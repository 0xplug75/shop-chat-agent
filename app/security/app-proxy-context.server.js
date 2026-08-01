import { isIP } from "node:net";
import { authenticate } from "../shopify.server";
import {
  createMerchantRequestContext,
  getRequestId,
} from "./merchant-context.server";
import {
  normalizeShopDomain,
  normalizeStorefrontOrigin,
} from "./shopify-domain.server";
import { getOrCreateShop, getShopByDomain } from "../services/shop.server";

export async function authenticateAppProxyContext(
  request,
  { refreshStorefrontOrigin = false } = {},
) {
  const proxy = await authenticate.public.appProxy(request);
  if (!proxy.session) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const signedShop = new URL(request.url).searchParams.get("shop");
  const shopDomain = normalizeShopDomain(signedShop || proxy.session.shop);
  if (normalizeShopDomain(proxy.session.shop) !== shopDomain) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const existingShop = refreshStorefrontOrigin
    ? null
    : await getShopByDomain(shopDomain);
  const storefrontOrigin = refreshStorefrontOrigin
    ? await resolvePrimaryStorefrontOrigin(proxy.admin, shopDomain)
    : existingShop?.storefrontOrigin || `https://${shopDomain}`;
  const shop = await getOrCreateShop({ shopDomain, storefrontOrigin });
  const context = createMerchantRequestContext({
    shopId: shop.id,
    shopDomain: shop.shopDomain,
    installationId: proxy.session.id,
    requestId: getRequestId(request),
    storefrontOrigin: shop.storefrontOrigin || storefrontOrigin,
    networkSubject: getTrustedAppProxyNetworkSubject(request),
  });

  return { ...proxy, shop, context };
}

export function getTrustedAppProxyNetworkSubject(request) {
  const forwardedFor = request.headers.get("X-Forwarded-For") || "";
  const clientAddress = forwardedFor.split(",")[0]?.trim();
  return clientAddress && isIP(clientAddress)
    ? `app-proxy:${clientAddress}`
    : undefined;
}

async function resolvePrimaryStorefrontOrigin(admin, shopDomain) {
  if (!admin) return `https://${shopDomain}`;
  try {
    const response = await admin.graphql(`#graphql
      query IntentCartPrimaryDomain {
        shop { primaryDomain { url } }
      }
    `);
    const payload = await response.json();
    return (
      normalizeStorefrontOrigin(payload.data?.shop?.primaryDomain?.url) ||
      `https://${shopDomain}`
    );
  } catch (_error) {
    return `https://${shopDomain}`;
  }
}
