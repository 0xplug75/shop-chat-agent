import { getConversationHistory, saveMessage } from "../db.server";

/**
 * Commerce Session
 * Owns the per-conversation commerce state for IntentCart.
 */
export async function loadOrCreateCommerceSession({ sessionId, userMessage }) {
  const messages = await getConversationHistory(sessionId);

  return {
    sessionId,
    messages: formatMessages(messages),
    intent: null,
    catalogResults: [],
    selectedProduct: null,
    selectedVariant: null,
    cartId: null,
    cartSnapshot: null,
    checkoutUrl: '',
    buyerContext: {},
    pendingBusinessMessages: [],
    currentUserMessage: userMessage || ''
  };
}

export async function appendUserMessage(session, message) {
  await saveMessage(session.sessionId, 'user', message);
  session.messages.push({
    role: 'user',
    content: message
  });

  return session;
}

export function applyIntent(session, intent) {
  session.intent = intent;

  if (intent?.type === 'product_discovery' || intent?.type === 'product_detail') {
    session.selectedProduct = null;
    session.selectedVariant = null;
    session.pendingBusinessMessages = [{
      outcome: 'new_product_discovery',
      rawMessage: session.currentUserMessage || '',
      assistantMessage: 'A new product discovery request is active. Do not mention older pending cart suggestions unless the shopper asks to return to them.'
    }];
  }

  return session;
}

export function applyCatalogResults(session, products) {
  session.catalogResults = products || [];
  session.selectedProduct = session.selectedProduct || session.catalogResults[0] || null;
  return session;
}

export function applyCartState(session, cartResult) {
  if (!cartResult) return session;

  session.cartSnapshot = cartResult.response || cartResult;
  if (cartResult.businessMessage) {
    session.pendingBusinessMessages.push(cartResult.businessMessage);
  }

  const cartId = extractFirstValue(session.cartSnapshot, ['cart_id', 'cartId', 'id']);
  if (cartId) session.cartId = cartId;

  const checkoutUrl = extractFirstValue(session.cartSnapshot, ['checkout_url', 'checkoutUrl', 'webUrl', 'url']);
  if (checkoutUrl) session.checkoutUrl = checkoutUrl;

  return session;
}

export function applyCheckout(session, checkoutResult) {
  if (!checkoutResult) return session;

  session.checkoutUrl = checkoutResult.checkoutUrl || session.checkoutUrl;
  return session;
}

export function getCommerceContext(session) {
  return {
    intent: session.intent,
    catalogResults: session.catalogResults,
    selectedProduct: session.selectedProduct,
    selectedVariant: session.selectedVariant,
    cartId: session.cartId,
    cartSnapshot: session.cartSnapshot,
    checkoutUrl: session.checkoutUrl,
    buyerContext: session.buyerContext,
    pendingBusinessMessages: session.pendingBusinessMessages
  };
}

function formatMessages(messages) {
  return messages.map((message) => {
    let content;
    try {
      content = JSON.parse(message.content);
    } catch (_error) {
      content = message.content;
    }

    return {
      role: message.role,
      content
    };
  });
}

function extractFirstValue(source, keys) {
  if (!source) return '';

  if (typeof source === 'string') {
    if (keys.some((key) => ['checkout_url', 'checkoutUrl', 'webUrl', 'url'].includes(key)) && source.includes('checkout')) {
      return source;
    }

    try {
      return extractFirstValue(JSON.parse(source), keys);
    } catch (_error) {
      return '';
    }
  }

  if (typeof source === 'object' && !Array.isArray(source)) {
    for (const key of keys) {
      if (source[key] && (key !== 'url' || String(source[key]).includes('checkout'))) {
        return source[key];
      }
    }

    for (const value of Object.values(source)) {
      const nestedValue = extractFirstValue(value, keys);
      if (nestedValue) return nestedValue;
    }
  }

  if (Array.isArray(source)) {
    for (const value of source) {
      const nestedValue = extractFirstValue(value, keys);
      if (nestedValue) return nestedValue;
    }
  }

  return '';
}
