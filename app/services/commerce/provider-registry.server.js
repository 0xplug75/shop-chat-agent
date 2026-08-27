import { assertCommerceProvider } from "./provider-contract.server";
import { createFixtureProvider } from "./fixture-provider.server";
import { createShopifyProvider } from "./shopify-provider.server";
import { createUcpProvider } from "./ucp-provider.server";
import { UcpClient } from "./ucp-client.server";
import { resolveRuntimeUrls } from "../../config/runtime-urls";

export function createCommerceProvider({
  context,
  merchantConfig,
  env = global.process?.env || {},
  providerId = merchantConfig?.shopping?.commerceProvider || "shopify",
  dependencies = {},
} = {}) {
  if (providerId === "fixture") {
    return assertCommerceProvider(createFixtureProvider(dependencies.fixture));
  }
  if (providerId === "ucp") {
    const businessUrl = merchantConfig.shopping.ucp.businessUrl;
    if (!businessUrl) {
      throw new Error(
        "A UCP business URL is required when the UCP provider is active",
      );
    }
    const runtimeUrls = resolveRuntimeUrls(env);
    const client =
      dependencies.ucpClient ||
      new UcpClient({
        context,
        businessUrl,
        agentProfileUrl:
          env.UCP_AGENT_PROFILE_URL ||
          `${runtimeUrls.appUrl}/ucp/agent-profile`,
        authorization: env.UCP_ACCESS_TOKEN,
        env,
      });
    return assertCommerceProvider(
      createUcpProvider({
        client,
        policySearch: dependencies.policySearch,
        checkoutEnabled:
          merchantConfig.shopping.checkoutStrategy === "ucp_handoff" &&
          merchantConfig.shopping.ucp.checkoutEnabled,
      }),
    );
  }
  if (providerId !== "shopify") {
    throw new Error(`Unsupported commerce provider: ${providerId}`);
  }
  return assertCommerceProvider(
    createShopifyProvider({
      context,
      merchantConfig,
      env,
      legacyClient: dependencies.legacyClient,
      ucpClient: dependencies.ucpClient,
    }),
  );
}
