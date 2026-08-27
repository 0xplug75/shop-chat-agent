import { commerceProviderCapabilities } from "./provider-contract.server";

export function createFixtureProvider({
  products = [],
  carts = new Map(),
  mutationResults = new Map(),
} = {}) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Fixture commerce provider is restricted to NODE_ENV=test");
  }

  return {
    id: "fixture",
    capabilities: commerceProviderCapabilities({
      catalogSearch: true,
      catalogLookup: true,
      productGet: true,
      policies: true,
      cartCreate: true,
      cartGet: true,
      cartUpdate: true,
      checkoutCreate: true,
    }),
    async initialize() {
      return { capabilities: this.capabilities };
    },
    async searchCatalog() {
      return { toolName: "fixture_search", products: products.slice(0, 3) };
    },
    async lookupCatalog({ ids = [] }) {
      return {
        toolName: "fixture_lookup",
        products: products
          .filter((product) => ids.includes(product.id))
          .slice(0, 3),
      };
    },
    async getProduct({ id }) {
      return { product: products.find((product) => product.id === id) || null };
    },
    async searchPolicies() {
      return { response: { content: [{ text: "Fixture policy" }] } };
    },
    async getCart({ cartId }) {
      const cart = carts.get(cartId) || null;
      return {
        cartId,
        cart: cart ? structuredClone(cart) : null,
        cartVersion: cart?.version ? String(cart.version) : null,
        continueUrl: cart?.continue_url || null,
      };
    },
    async addConfirmedItem({ cartId, variantId, quantity, idempotencyKey }) {
      assertFixtureIdempotencyKey(idempotencyKey);
      if (mutationResults.has(idempotencyKey)) {
        return structuredClone(mutationResults.get(idempotencyKey));
      }
      const id = cartId || `fixture-cart-${carts.size + 1}`;
      const current = carts.get(id);
      const lines = Array.isArray(current?.line_items)
        ? structuredClone(current.line_items)
        : [];
      const existing = lines.find(
        (line) => String(line?.item?.id || "") === variantId,
      );
      if (existing) existing.quantity = Number(existing.quantity || 0) + quantity;
      else lines.push({ item: { id: variantId }, quantity });
      const cart = {
        id,
        version: Number(current?.version || 0) + 1,
        line_items: lines,
        continue_url: `https://fixture.myshopify.com/cart/c/${id}`,
        messages: [],
      };
      carts.set(id, cart);
      const result = { cartId: id, cart, continueUrl: cart.continue_url };
      mutationResults.set(idempotencyKey, result);
      return structuredClone(result);
    },
    async createCheckoutHandoff({ cartId, idempotencyKey }) {
      assertFixtureIdempotencyKey(idempotencyKey);
      const cart = carts.get(cartId);
      return {
        cartId,
        checkoutUrl: cart?.continue_url || null,
        status: "handoff",
      };
    },
  };
}

function assertFixtureIdempotencyKey(value) {
  if (!/^commerce:v1:[a-f0-9]{64}$/.test(String(value || ""))) {
    const error = new Error("Fixture mutation requires an idempotency key");
    error.code = "IDEMPOTENCY_KEY_REQUIRED";
    error.status = 400;
    error.definitiveBeforeMutation = true;
    throw error;
  }
}
