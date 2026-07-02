import AppConfig from "./config.server";
import { createBusinessMessageInterpreter } from "./business-message-interpreter.server";

/**
 * Cart Adapter
 * Wraps Shopify cart tools and preserves full-cart PUT semantics.
 */
export function createCartAdapter(mcpClient) {
  const businessMessageInterpreter = createBusinessMessageInterpreter();

  const createCart = async ({ lineItems = [], context = {} }) => {
    return updateCart({
      cartId: context.cartId || null,
      fullCartState: {
        line_items: lineItems,
        buyer_identity: context.buyerIdentity,
        note: context.note
      }
    });
  };

  const getCart = async ({ cartId }) => {
    const response = await mcpClient.callTool(AppConfig.tools.getCartName, { cart_id: cartId });

    return {
      toolName: AppConfig.tools.getCartName,
      response,
      businessMessage: businessMessageInterpreter.interpret(response)
    };
  };

  const updateCart = async ({ cartId, fullCartState }) => {
    const response = await mcpClient.callTool(AppConfig.tools.updateCartName, {
      cart_id: cartId,
      ...fullCartState
    });

    return {
      toolName: AppConfig.tools.updateCartName,
      response,
      businessMessage: businessMessageInterpreter.interpret(response)
    };
  };

  const preserveAndUpdateCart = async ({ cartId, update }) => {
    const currentCart = cartId ? await getCart({ cartId }) : null;
    const currentState = extractCartState(currentCart?.response);

    return updateCart({
      cartId,
      fullCartState: {
        ...currentState,
        ...update,
        line_items: update.line_items || currentState.line_items || []
      }
    });
  };

  return {
    createCart,
    getCart,
    updateCart,
    preserveAndUpdateCart
  };
}

function extractCartState(response) {
  if (!response) return {};

  const content = Array.isArray(response.content) ? response.content[0]?.text : null;
  if (!content) return {};

  try {
    return typeof content === 'string' ? JSON.parse(content) : content;
  } catch (_error) {
    return {};
  }
}

export default {
  createCartAdapter
};
