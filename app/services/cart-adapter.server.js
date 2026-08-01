import AppConfig from "./config.server";
import { createBusinessMessageInterpreter } from "./business-message-interpreter.server";

/**
 * Cart Adapter
 * Wraps Shopify cart tools and preserves full-cart PUT semantics.
 *
 * This is the only live path to Shopify cart mutations. The tool registry
 * validates confirmation, variant and quantity before calling this adapter.
 */
export function createCartAdapter(mcpClient) {
  const businessMessageInterpreter = createBusinessMessageInterpreter();

  const createCart = async ({ lineItems = [], context = {} }) => {
    return updateCart({
      cartId: context.cartId || null,
      idempotencyKey: context.idempotencyKey,
      fullCartState: {
        line_items: lineItems,
        buyer_identity: context.buyerIdentity,
        note: context.note,
      },
    });
  };

  const getCart = async ({ cartId }) => {
    const response = await mcpClient.callTool(AppConfig.tools.getCartName, {
      cart_id: cartId,
    });
    assertToolResponse(response);

    return {
      toolName: AppConfig.tools.getCartName,
      response,
      cart: normalizeCartResponse(response),
      cartId: extractCartId(response),
      businessMessage: businessMessageInterpreter.interpret(response),
    };
  };

  const updateCart = async ({ cartId, fullCartState, idempotencyKey }) => {
    assertIdempotencyKey(idempotencyKey);
    const response = await mcpClient.callTool(
      AppConfig.tools.updateCartName,
      {
        cart_id: cartId,
        ...fullCartState,
      },
      { idempotencyKey },
    );
    assertToolResponse(response);

    return {
      toolName: AppConfig.tools.updateCartName,
      response,
      cart: normalizeCartResponse(response),
      cartId: extractCartId(response),
      businessMessage: businessMessageInterpreter.interpret(response),
    };
  };

  const preserveAndUpdateCart = async ({ cartId, update, idempotencyKey }) => {
    const currentCart = cartId ? await getCart({ cartId }) : null;
    const currentState = extractCartState(currentCart?.response);

    return updateCart({
      cartId,
      idempotencyKey,
      fullCartState: {
        ...currentState,
        ...update,
        line_items: update.line_items || currentState.line_items || [],
      },
    });
  };

  const addConfirmedItem = async ({
    cartId,
    productId,
    variantId,
    quantity,
    idempotencyKey,
  }) => {
    assertIdempotencyKey(idempotencyKey);
    const response = await mcpClient.callTool(
      AppConfig.tools.updateCartName,
      {
        ...(cartId ? { cart_id: cartId } : {}),
        add_items: [
          {
            product_id: productId,
            product_variant_id: variantId,
            quantity,
          },
        ],
      },
      { idempotencyKey },
    );
    assertToolResponse(response);

    return {
      toolName: AppConfig.tools.updateCartName,
      response,
      cart: normalizeCartResponse(response),
      cartId: extractCartId(response),
      businessMessage: businessMessageInterpreter.interpret(response),
    };
  };

  return {
    createCart,
    getCart,
    updateCart,
    preserveAndUpdateCart,
    addConfirmedItem,
  };
}

function assertIdempotencyKey(value) {
  if (!/^commerce:v1:[a-f0-9]{64}$/.test(String(value || ""))) {
    const error = new Error("A valid commerce idempotency key is required");
    error.code = "IDEMPOTENCY_KEY_REQUIRED";
    error.publicMessage = "The cart update could not be safely started.";
    throw error;
  }
}

function assertToolResponse(response) {
  if (!response?.error) return;
  const error = new Error("Shopify cart request failed");
  error.code =
    response.error.type === "auth_required"
      ? "AUTH_REQUIRED"
      : "SHOPIFY_TOOL_FAILED";
  error.authorizationUrl = response.error.authorizationUrl;
  error.publicMessage =
    response.error.type === "auth_required"
      ? "Customer authorization is required before accessing this cart."
      : "Shopify could not update the cart.";
  throw error;
}

export function extractCartId(response) {
  const payload = unwrapToolPayload(response);
  return (
    String(
      payload?.cartId ||
        payload?.cart_id ||
        payload?.cart?.id ||
        payload?.cart?.cartId ||
        payload?.cart?.cart_id ||
        payload?.id ||
        "",
    ) || null
  );
}

export function normalizeCartResponse(response) {
  return redactSensitiveCartFields(unwrapToolPayload(response));
}

function unwrapToolPayload(response) {
  if (!response) return {};
  const content = Array.isArray(response.content)
    ? response.content.find((item) => item?.text !== undefined)?.text
    : undefined;
  const candidate = content ?? response;
  if (typeof candidate !== "string") return candidate;
  try {
    return JSON.parse(candidate);
  } catch (_error) {
    return { outcome: candidate.slice(0, 2000) };
  }
}

function redactSensitiveCartFields(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) => redactSensitiveCartFields(item, depth + 1));
  }
  if (typeof value === "string") return value.slice(0, 5000);
  if (typeof value !== "object") return value;

  const blocked =
    /(authorization|cookie|token|secret|password|email|phone|address|buyerIdentity|buyer_identity)/i;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !blocked.test(key))
      .map(([key, item]) => [key, redactSensitiveCartFields(item, depth + 1)]),
  );
}

function extractCartState(response) {
  if (!response) return {};

  const content = Array.isArray(response.content)
    ? response.content[0]?.text
    : null;
  if (!content) return {};

  try {
    return typeof content === "string" ? JSON.parse(content) : content;
  } catch (_error) {
    return {};
  }
}

export default {
  createCartAdapter,
};
