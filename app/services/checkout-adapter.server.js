/**
 * Checkout Adapter
 * Handles checkout handoff boundaries for the MVP.
 */
export function createCheckoutAdapter() {
  const createCheckoutFromCart = async ({ cartId, cartSnapshot }) => {
    return {
      cartId,
      checkoutUrl: getCheckoutUrlFromCartOrCheckout(cartSnapshot)
    };
  };

  const getCheckoutUrlFromCartOrCheckout = (response) => {
    if (!response) return '';

    if (typeof response === 'string') {
      if (response.includes('checkout')) return response;
      try {
        return getCheckoutUrlFromCartOrCheckout(JSON.parse(response));
      } catch (_error) {
        return '';
      }
    }

    if (Array.isArray(response)) {
      for (const item of response) {
        const checkoutUrl = getCheckoutUrlFromCartOrCheckout(item);
        if (checkoutUrl) return checkoutUrl;
      }

      return '';
    }

    if (response.checkoutUrl) return response.checkoutUrl;
    if (response.checkout_url) return response.checkout_url;
    if (response.webUrl) return response.webUrl;
    if (response.checkout?.url) return response.checkout.url;
    if (response.checkout?.webUrl) return response.checkout.webUrl;
    if (response.cart?.checkoutUrl) return response.cart.checkoutUrl;
    if (response.cart?.checkout_url) return response.cart.checkout_url;
    if (response.url && String(response.url).includes('checkout')) return response.url;

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

  return {
    createCheckoutFromCart,
    getCheckoutUrlFromCartOrCheckout
  };
}

export default {
  createCheckoutAdapter
};
