import { authenticateAppProxyContext } from "../security/app-proxy-context.server";
import { issueWidgetToken } from "../security/widget-token.server";
import { getMerchantConfig } from "../merchant/merchant.server";
import { toPublicMerchantConfig } from "../merchant/public-config.server";

export async function loader({ request }) {
  const { context, shop } = await authenticateAppProxyContext(request, {
    refreshStorefrontOrigin: true
  });
  const config = await getMerchantConfig(context);
  const credential = issueWidgetToken({
    shopId: shop.id,
    shopDomain: shop.shopDomain,
    storefrontOrigin: shop.storefrontOrigin
  });

  return Response.json({
    ...credential,
    shop: {
      domain: shop.shopDomain,
      storefrontOrigin: shop.storefrontOrigin
    },
    config: toPublicMerchantConfig(config),
    endpoints: {
      chat: "/apps/intentcart/chat",
      tokenStatus: "/apps/intentcart/auth/token-status"
    },
    requestId: context.requestId
  }, {
    headers: {
      "Cache-Control": "no-store, private",
      "X-Request-Id": context.requestId
    }
  });
}
