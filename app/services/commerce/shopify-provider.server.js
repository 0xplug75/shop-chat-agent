import { resolveRuntimeUrls } from "../../config/runtime-urls";
import MCPClient from "../../mcp-client";
import { createCatalogAdapter } from "../catalog-adapter.server";
import { createPolicyAdapter } from "../policy-adapter.server";
import { createUcpProvider } from "./ucp-provider.server";
import { UcpClient } from "./ucp-client.server";
import { commerceProviderCapabilities } from "./provider-contract.server";

export function createShopifyProvider({
  context,
  merchantConfig,
  env = global.process?.env || {},
  legacyClient,
  ucpClient,
} = {}) {
  const runtimeUrls = resolveRuntimeUrls(env);
  const storefrontClient =
    legacyClient ||
    new MCPClient({
      context,
    });
  const agentProfileUrl =
    env.UCP_AGENT_PROFILE_URL || `${runtimeUrls.appUrl}/ucp/agent-profile`;
  const ucp =
    ucpClient ||
    new UcpClient({
      context,
      businessUrl:
        merchantConfig.shopping.ucp.businessUrl ||
        `https://${context.shopDomain}`,
      agentProfileUrl,
      authorization: env.UCP_ACCESS_TOKEN,
      env,
    });
  const catalog = createCatalogAdapter(storefrontClient);
  const policy = createPolicyAdapter(storefrontClient);
  const ucpProvider = createUcpProvider({
    client: ucp,
    policySearch: policy.searchPolicies,
    checkoutEnabled:
      merchantConfig.shopping.checkoutStrategy === "ucp_handoff" &&
      merchantConfig.shopping.ucp.checkoutEnabled &&
      merchantConfig.shopping.featureFlags.ucpCheckout,
  });
  const ucpCartEnabled =
    merchantConfig.shopping.ucp.cartEnabled &&
    merchantConfig.shopping.featureFlags.ucpCart;
  let initialized = false;
  let ucpReady = false;

  return {
    id: "shopify",
    get capabilities() {
      return commerceProviderCapabilities({
        ...ucpProvider.capabilities,
        catalogSearch: true,
        catalogLookup: true,
        productGet: true,
        policies: true,
      });
    },

    async initialize() {
      if (!initialized) {
        await storefrontClient.connectToStorefrontServer();
        if (ucpCartEnabled) {
          try {
            await ucpProvider.initialize();
            ucpReady = true;
          } catch (_error) {
            // Catalog and approved policy reads can remain available. Cart calls
            // fail closed and retry UCP discovery when explicitly requested.
            ucpReady = false;
          }
        }
        initialized = true;
      }
      return { capabilities: this.capabilities };
    },

    searchCatalog: catalog.searchCatalog,
    lookupCatalog: catalog.lookupCatalog,
    getProduct: catalog.getProduct,
    searchPolicies: policy.searchPolicies,
    async getCart(input) {
      await requireUcpCart();
      return ucpProvider.getCart(input);
    },
    async addConfirmedItem(input) {
      await requireUcpCart();
      return ucpProvider.addConfirmedItem({
        ...input,
        buyerContext: input.buyerContext || {},
      });
    },
    async createCheckoutHandoff(input) {
      await requireUcpCart();
      return ucpProvider.createCheckoutHandoff(input);
    },
    getCheckout: ucpProvider.getCheckout,
    updateCheckout: ucpProvider.updateCheckout,
    completeCheckout: ucpProvider.completeCheckout,
  };

  async function requireUcpCart() {
    if (!ucpCartEnabled) {
      const error = new Error("UCP cart is disabled for this merchant");
      error.code = "UCP_CART_DISABLED";
      error.status = 409;
      error.publicMessage = "Cart actions are currently unavailable.";
      throw error;
    }
    if (!ucpReady) {
      await ucpProvider.initialize();
      ucpReady = true;
    }
  }
}
