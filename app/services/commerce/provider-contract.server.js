const REQUIRED_METHODS = [
  "initialize",
  "searchCatalog",
  "lookupCatalog",
  "getProduct",
  "searchPolicies",
  "getCart",
  "addConfirmedItem",
  "createCheckoutHandoff",
];

export class CommerceProviderError extends Error {
  constructor(code, message, { status = 502, retryable = false, details } = {}) {
    super(message);
    this.name = "CommerceProviderError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
    this.publicMessage = "Shopify could not complete the requested commerce action.";
  }
}

export function assertCommerceProvider(provider) {
  if (!provider || typeof provider.id !== "string") {
    throw new CommerceProviderError(
      "COMMERCE_PROVIDER_INVALID",
      "Commerce provider must expose an id",
      { status: 500 },
    );
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof provider[method] !== "function") {
      throw new CommerceProviderError(
        "COMMERCE_PROVIDER_INVALID",
        `Commerce provider ${provider.id} is missing ${method}()`,
        { status: 500 },
      );
    }
  }
  return provider;
}

export function commerceProviderCapabilities(overrides = {}) {
  return Object.freeze({
    catalogSearch: false,
    catalogLookup: false,
    productGet: false,
    policies: false,
    cartCreate: false,
    cartGet: false,
    cartUpdate: false,
    checkoutCreate: false,
    checkoutGet: false,
    checkoutUpdate: false,
    checkoutComplete: false,
    ...overrides,
  });
}
