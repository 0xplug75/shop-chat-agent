/**
 * Intent Router
 * Classifies shopper messages into commerce session intents.
 */

const INTENT_TYPES = {
  PRODUCT_DISCOVERY: 'product_discovery',
  PRODUCT_DETAIL: 'product_detail',
  POLICY_QUESTION: 'policy_question',
  CART_ACTION: 'cart_action',
  CHECKOUT_ACTION: 'checkout_action',
  GENERAL_SALES_QUESTION: 'general_sales_question'
};

export function createIntentRouter() {
  const route = ({ message }) => {
    const normalizedMessage = String(message || '').toLowerCase();

    if (matches(normalizedMessage, ['checkout', 'check out', 'pay', 'payment'])) {
      return toIntent(INTENT_TYPES.CHECKOUT_ACTION);
    }

    if (matches(normalizedMessage, ['add to cart', 'cart', 'basket', 'remove', 'quantity'])) {
      return toIntent(INTENT_TYPES.CART_ACTION);
    }

    if (matches(normalizedMessage, ['shipping', 'return', 'refund', 'policy', 'delivery', 'faq'])) {
      return toIntent(INTENT_TYPES.POLICY_QUESTION);
    }

    if (matches(normalizedMessage, ['variant', 'size', 'color', 'available', 'in stock', 'details'])) {
      return toIntent(INTENT_TYPES.PRODUCT_DETAIL);
    }

    if (matches(normalizedMessage, ['find', 'looking for', 'recommend', 'compare', 'best', 'need', 'want', 'show me'])) {
      return toIntent(INTENT_TYPES.PRODUCT_DISCOVERY);
    }

    return toIntent(INTENT_TYPES.GENERAL_SALES_QUESTION);
  };

  return { route };
}

function matches(message, terms) {
  return terms.some((term) => message.includes(term));
}

function toIntent(type) {
  return {
    type,
    confidence: 'heuristic'
  };
}

export { INTENT_TYPES };

export default {
  createIntentRouter,
  INTENT_TYPES
};
