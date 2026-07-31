import { getMerchantConfig } from "./merchant.server";
import { appApiKey, authenticate } from "../shopify.server";
import { createMerchantRequestContext } from "../security/merchant-context.server";
import { getOrCreateShop } from "../services/shop.server";

export async function loadIntentCartDashboard(request) {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop({
    shopDomain: session.shop,
    storefrontOrigin: `https://${session.shop}`
  });
  const context = createMerchantRequestContext({
    shopId: shop.id,
    shopDomain: shop.shopDomain
  });
  const merchantConfig = await getMerchantConfig(context);
  const shopHandle = session.shop.replace(/\.myshopify\.com$/i, "");
  const activationId = appApiKey
    ? `&activateAppId=${encodeURIComponent(`${appApiKey}/chat-interface`)}`
    : "";

  return {
    assistant: {
      name: merchantConfig.assistant.name,
      personality: merchantConfig.assistant.personality,
      brandVoice: merchantConfig.assistant.brandVoice,
      welcomeMessage: merchantConfig.assistant.welcomeMessage,
      quickActions: merchantConfig.assistant.quickActions
    },
    storefront: merchantConfig.widget,
    commerce: {
      maxProducts: merchantConfig.shopping.recommendationRules.maxProducts,
      bundleStrategy: merchantConfig.shopping.bundleStrategy,
      outOfStockPolicy: merchantConfig.shopping.outOfStockPolicy,
      requireVariantConfirmation:
        merchantConfig.shopping.recommendationRules.requireVariantConfirmation,
      preferAvailableInventory:
        merchantConfig.shopping.recommendationRules.preferAvailableInventory
    },
    links: {
      themeEditor: `https://${session.shop}/admin/themes/current/editor?context=apps${activationId}`,
      storefront: `https://${session.shop}`,
      adminProducts: `https://admin.shopify.com/store/${shopHandle}/products`
    }
  };
}
