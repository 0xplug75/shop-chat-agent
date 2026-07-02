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
  session.pendingBusinessMessages.push(cartResult.businessMessage);

  const cartId = extractFirstValue(session.cartSnapshot, ['cart_id', 'cartId', 'id']);
  if (cartId) session.cartId = cartId;

  const checkoutUrl = extractFirstValue(session.cartSnapshot, ['checkout_url', 'checkoutUrl']);
  if (checkoutUrl) session.checkoutUrl = checkoutUrl;

  return session;
}

export function applyCheckout(session, checkoutResult) {
  if (!checkoutResult) return session;

  session.checkoutUrl = checkoutResult.checkoutUrl || session.checkoutUrl;
  return session;
}

export function buildClaudeMessages(session) {
  const commerceContext = {
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

  return [
    ...session.messages,
    {
      role: 'user',
      content: `Commerce session context:\n${JSON.stringify(commerceContext)}`
    }
  ];
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

  if (typeof source === 'object' && !Array.isArray(source)) {
    for (const key of keys) {
      if (source[key]) return source[key];
    }
  }

  const content = Array.isArray(source.content) ? source.content[0]?.text : null;
  if (!content) return '';

  try {
    const parsedContent = typeof content === 'string' ? JSON.parse(content) : content;
    return extractFirstValue(parsedContent, keys);
  } catch (_error) {
    return '';
  }
}

export default {
  loadOrCreateCommerceSession,
  appendUserMessage,
  applyIntent,
  applyCatalogResults,
  applyCartState,
  applyCheckout,
  buildClaudeMessages
};
