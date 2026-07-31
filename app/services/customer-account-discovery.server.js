import { getCustomerAccountUrls, storeCustomerAccountUrls } from "./customer-account-urls.server";
import { fetchWithTimeout, readJsonResponseWithLimit } from "../lib/fetch-with-timeout.server";
import { assertTrustedShopifyUrl } from "../security/shopify-domain.server";

export async function resolveCustomerAccountUrls(context, conversationId) {
  const existing = await getCustomerAccountUrls(context, conversationId);
  if (existing) return existing;

  const baseUrl = new URL(`https://${context.shopDomain}`);
  const [mcpDiscovery, openIdDiscovery] = await Promise.all([
    fetchDiscovery(baseUrl, "/.well-known/customer-account-api"),
    fetchDiscovery(baseUrl, "/.well-known/openid-configuration")
  ]);
  const discovered = {
    mcpApiUrl: trustedOptionalUrl(mcpDiscovery.mcp_api, context),
    authorizationUrl: trustedOptionalUrl(openIdDiscovery.authorization_endpoint, context),
    tokenUrl: trustedOptionalUrl(openIdDiscovery.token_endpoint, context)
  };

  return storeCustomerAccountUrls(context, {
    conversationId,
    ...discovered
  });
}

async function fetchDiscovery(baseUrl, path) {
  const url = new URL(path, baseUrl);
  const response = await fetchWithTimeout(url.toString(), {
    headers: { Accept: "application/json" }
  }, 10_000);
  if (!response.ok) throw new Error("Customer account discovery failed");

  return readJsonResponseWithLimit(response, 100_000);
}

function trustedOptionalUrl(value, context) {
  return value
    ? assertTrustedShopifyUrl(value, { shopDomain: context.shopDomain }).toString()
    : null;
}
