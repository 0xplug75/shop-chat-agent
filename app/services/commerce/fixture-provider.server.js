import { commerceProviderCapabilities } from "./provider-contract.server";

export function createFixtureProvider({
  products = [],
  carts = new Map(),
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
      return { cartId, cart, continueUrl: cart?.continue_url || null };
    },
    async addConfirmedItem({ cartId, variantId, quantity }) {
      const id = cartId || `fixture-cart-${carts.size + 1}`;
      const cart = {
        id,
        line_items: [{ item: { id: variantId }, quantity }],
        continue_url: `https://fixture.myshopify.com/cart/c/${id}`,
        messages: [],
      };
      carts.set(id, cart);
      return { cartId: id, cart, continueUrl: cart.continue_url };
    },
    async createCheckoutHandoff({ cartId }) {
      const cart = carts.get(cartId);
      return {
        cartId,
        checkoutUrl: cart?.continue_url || null,
        status: "handoff",
      };
    },
  };
}
