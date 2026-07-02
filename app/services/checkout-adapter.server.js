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

    if (typeof response === 'string') return response.includes('checkout') ? response : '';

    if (response.checkoutUrl) return response.checkoutUrl;
    if (response.checkout_url) return response.checkout_url;
    if (response.webUrl) return response.webUrl;
    if (response.url && String(response.url).includes('checkout')) return response.url;

    const content = Array.isArray(response.content) ? response.content[0]?.text : null;
    if (!content) return '';

    try {
      const parsedContent = typeof content === 'string' ? JSON.parse(content) : content;
      return getCheckoutUrlFromCartOrCheckout(parsedContent);
    } catch (_error) {
      const match = String(content).match(/https?:\/\/\S*checkout\S*/);
      return match ? match[0] : '';
    }
  };

  return {
    createCheckoutFromCart,
    getCheckoutUrlFromCartOrCheckout
  };
}

export default {
  createCheckoutAdapter
};
