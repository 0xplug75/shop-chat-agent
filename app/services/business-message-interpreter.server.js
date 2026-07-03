/**
 * Business Message Interpreter
 * Converts Shopify MCP business outcomes into assistant-safe summaries.
 *
 * STATUS: not yet wired into the live request path. Its only caller today is
 * cart-adapter.server.js (also currently unwired — see that file's header).
 * chat.jsx's applyCommerceToolResult() currently builds a thinner, hardcoded
 * business message inline for cart tool results instead of classifying
 * outcomes through this interpreter. Kept intentionally — richer outcome
 * classification (quantity_adjusted / not_found / unavailable /
 * requires_selling_plan / requires_buyer_input) is the target behavior once
 * cart-adapter is wired in. See
 * docs/architecture-notes/cart-adapter-wiring-gap.md.
 */

const OUTCOME_PATTERNS = [
  { outcome: 'quantity_adjusted', patterns: ['quantity_adjusted', 'quantity adjusted', 'adjusted quantity'] },
  { outcome: 'not_found', patterns: ['not_found', 'not found', 'could not find'] },
  { outcome: 'unavailable', patterns: ['unavailable', 'out of stock', 'not available'] },
  { outcome: 'requires_selling_plan', patterns: ['requires_selling_plan', 'selling plan', 'subscription required'] },
  { outcome: 'requires_buyer_input', patterns: ['requires_buyer_input', 'buyer input', 'select', 'choose'] }
];

function stringifyContent(response) {
  if (!response) return '';

  if (typeof response === 'string') return response;

  if (Array.isArray(response.content)) {
    return response.content
      .map((item) => item?.text || item?.content || '')
      .filter(Boolean)
      .join('\n');
  }

  try {
    return JSON.stringify(response);
  } catch (_error) {
    return String(response);
  }
}

export function createBusinessMessageInterpreter() {
  const detectOutcome = (message) => {
    const normalizedMessage = message.toLowerCase();
    const match = OUTCOME_PATTERNS.find(({ patterns }) =>
      patterns.some((pattern) => normalizedMessage.includes(pattern))
    );

    return match?.outcome || 'ok';
  };

  const interpret = (response) => {
    const rawMessage = stringifyContent(response);
    const outcome = detectOutcome(rawMessage);

    return {
      outcome,
      rawMessage,
      assistantMessage: toAssistantMessage(outcome, rawMessage)
    };
  };

  return { interpret };
}

function toAssistantMessage(outcome, rawMessage) {
  switch (outcome) {
    case 'quantity_adjusted':
      return 'Shopify adjusted the quantity based on current cart or inventory rules.';
    case 'not_found':
      return 'Shopify could not find the requested product, variant, cart, or policy result.';
    case 'unavailable':
      return 'Shopify reported that this item is currently unavailable.';
    case 'requires_selling_plan':
      return 'Shopify requires a selling plan or subscription option before this item can be added.';
    case 'requires_buyer_input':
      return 'Shopify needs an exact buyer choice before the commerce action can continue.';
    default:
      return rawMessage || 'Shopify completed the requested commerce action.';
  }
}

export default {
  createBusinessMessageInterpreter
};
