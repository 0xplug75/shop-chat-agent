import { assertTrustedShopifyUrl } from "../security/shopify-domain.server";

/**
 * Checkout Adapter
 * Handles checkout handoff boundaries for the MVP.
 */
export function createCheckoutAdapter({ shopDomain, storefrontOrigin } = {}) {
  const additionalHosts = storefrontOrigin
    ? [new URL(storefrontOrigin).hostname]
    : [];

  const createCheckoutFromCart = async ({ cartId, cartSnapshot }) => {
    return {
      cartId,
      checkoutUrl: getCheckoutUrlFromCartOrCheckout(cartSnapshot)
    };
  };

  const getCheckoutUrlFromCartOrCheckout = (response) => {
    if (!response) return '';

    if (typeof response === 'string') {
      try {
        return getCheckoutUrlFromCartOrCheckout(JSON.parse(response));
      } catch (_error) {
        return validateCheckoutUrl(response);
      }
    }

    if (Array.isArray(response)) {
      for (const item of response) {
        const checkoutUrl = getCheckoutUrlFromCartOrCheckout(item);
        if (checkoutUrl) return checkoutUrl;
      }

      return '';
    }

    const directCandidates = [
      response.checkoutUrl,
      response.checkout_url,
      response.webUrl,
      response.checkout?.url,
      response.checkout?.webUrl,
      response.cart?.checkoutUrl,
      response.cart?.checkout_url,
      response.url
    ];
    for (const candidate of directCandidates) {
      const checkoutUrl = validateCheckoutUrl(candidate);
      if (checkoutUrl) return checkoutUrl;
    }

    const content = Array.isArray(response.content) ? response.content[0]?.text : null;
    if (content) return getCheckoutUrlFromCartOrCheckout(content);

    if (typeof response === 'object') {
      for (const value of Object.values(response)) {
        const checkoutUrl = getCheckoutUrlFromCartOrCheckout(value);
        if (checkoutUrl) return checkoutUrl;
      }
    }

    return '';
  };

  const validateCheckoutUrl = (value) => {
    if (typeof value !== "string" || value.length > 4096) return "";
    try {
      const url = assertTrustedShopifyUrl(value, { shopDomain, additionalHosts });
      const path = url.pathname.toLowerCase();
      if (!path.includes("checkout") && !path.startsWith("/cart/c/")) return "";
      return url.toString();
    } catch (_error) {
      return "";
    }
  };

  return {
    createCheckoutFromCart,
    getCheckoutUrlFromCartOrCheckout,
    validateCheckoutUrl
  };
}
