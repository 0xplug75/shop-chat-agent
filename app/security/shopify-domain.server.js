import { ShopDomainSchema } from "../contracts/commerce.schemas.server";

const SHOPIFY_SERVICE_HOST_PATTERN = /(^|\.)shopify\.com$/i;
const MYSHOPIFY_HOST_PATTERN = /(^|\.)myshopify\.com$/i;

export function normalizeShopDomain(value) {
  if (typeof value !== "string") {
    throw new Error("A Shopify shop domain is required");
  }

  let candidate = value.trim().toLowerCase();
  if (candidate.includes("://")) {
    candidate = new URL(candidate).hostname.toLowerCase();
  }

  candidate = candidate.replace(/\.$/, "");
  return ShopDomainSchema.parse(candidate);
}

export function normalizeStorefrontOrigin(value) {
  if (!value) return null;

  const url = new URL(value);
  const isLocalDevelopment =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);

  if (url.protocol !== "https:" && !isLocalDevelopment) {
    throw new Error("Storefront origins must use HTTPS");
  }

  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Invalid storefront origin");
  }

  return url.origin.toLowerCase();
}

export function isShopifyStorefrontOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && MYSHOPIFY_HOST_PATTERN.test(url.hostname);
  } catch (_error) {
    return false;
  }
}

export function assertTrustedShopifyUrl(value, { shopDomain, additionalHosts = [] } = {}) {
  const url = new URL(value);

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Untrusted external URL");
  }

  const hostname = url.hostname.toLowerCase();
  const canonicalShop = shopDomain ? normalizeShopDomain(shopDomain) : null;
  const accountHost = canonicalShop
    ? canonicalShop.replace(/\.myshopify\.com$/, ".account.myshopify.com")
    : null;
  const allowedHosts = new Set(
    [canonicalShop, accountHost, ...additionalHosts]
      .filter(Boolean)
      .map((host) => String(host).toLowerCase())
  );

  const isExpectedHost = allowedHosts.has(hostname);
  const isShopifyService = SHOPIFY_SERVICE_HOST_PATTERN.test(hostname);

  // Do not accept an arbitrary *.myshopify.com host. A URL belonging to a
  // different shop is still a Shopify URL, but it is a cross-tenant target.
  if (!isExpectedHost && !isShopifyService) {
    throw new Error("External URL host is not trusted");
  }

  return url;
}
