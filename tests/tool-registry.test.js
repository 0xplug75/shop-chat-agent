import { beforeEach, describe, expect, it, vi } from "vitest";
import { createToolRegistry } from "../app/services/tool-registry.server";
import {
  createCommerceMutationCoordinator,
  createInMemoryCommerceMutationStore,
  createTurnSideEffectState,
} from "../app/services/commerce-mutation.server";

const product = {
  id: "gid://shopify/Product/1",
  title: "All Mountain Board",
  available: true,
  variants: [
    {
      id: "gid://shopify/ProductVariant/11",
      title: "158 cm",
      available: true,
    },
  ],
};

function createRegistry() {
  const catalogAdapter = {
    searchCatalog: vi.fn().mockResolvedValue({
      products: [
        product,
        { ...product, id: "product-2" },
        { ...product, id: "product-3" },
        { ...product, id: "product-4" },
      ],
    }),
    getProduct: vi.fn().mockResolvedValue({ product }),
  };
  const policyAdapter = {
    searchPolicies: vi.fn().mockResolvedValue({
      response: { content: [{ text: "30 day returns" }] },
    }),
  };
  const cartAdapter = {
    getCart: vi.fn().mockResolvedValue({
      cartId: "cart-1",
      cart: { id: "cart-1", lines: [] },
    }),
    addConfirmedItem: vi.fn().mockResolvedValue({
      cartId: "cart-1",
      cart: {
        id: "cart-1",
        checkoutUrl: "https://alpha.myshopify.com/checkouts/cn/one",
      },
      businessMessage: {
        outcome: "ok",
        assistantMessage: "Shopify completed the requested commerce action.",
      },
    }),
  };
  const checkoutAdapter = {
    getCheckoutUrlFromCartOrCheckout: vi
      .fn()
      .mockReturnValue("https://alpha.myshopify.com/checkouts/cn/one"),
    createCheckoutFromCart: vi.fn().mockResolvedValue({
      cartId: "cart-1",
      checkoutUrl: "https://alpha.myshopify.com/checkouts/cn/one",
    }),
  };
  const knowledgeService = {
    searchKnowledge: vi
      .fn()
      .mockResolvedValue([
        { content: "Approved answer", reference: { title: "FAQ" } },
      ]),
  };
  return {
    registry: createToolRegistry({
      catalogAdapter,
      policyAdapter,
      cartAdapter,
      checkoutAdapter,
      knowledgeService,
      mutationCoordinator: createCommerceMutationCoordinator({
        store: createInMemoryCommerceMutationStore(),
      }),
    }),
    catalogAdapter,
    cartAdapter,
    checkoutAdapter,
    knowledgeService,
  };
}

function session(overrides = {}) {
  return {
    id: "commerce-session-1",
    journeyStage: "CONFIRM",
    recommendedProducts: [product],
    pendingMessages: [],
    buyerContext: {},
    cartId: null,
    version: 1,
    ...overrides,
  };
}

describe("typed Shopify tool registry", () => {
  let tools;

  beforeEach(() => {
    tools = createRegistry();
  });

  it("caps catalog recommendations at three", async () => {
    const result = await tools.registry.execute(
      "search_catalog",
      {
        query: "all mountain snowboard",
        limit: 3,
        availability: "available",
        filters: {},
      },
      { session: session() },
    );
    expect(result.products).toHaveLength(3);
    expect(result.sessionPatch.recommendedProducts).toHaveLength(3);
  });

  it("requires an exact second-turn confirmation before changing a cart", async () => {
    const input = {
      productId: product.id,
      variantId: product.variants[0].id,
      quantity: 1,
      confirmed: true,
    };
    const first = await tools.registry.execute("update_cart", input, {
      session: session(),
      confirmation: null,
    });
    expect(first.type).toBe("confirmation_required");
    expect(tools.cartAdapter.addConfirmedItem).not.toHaveBeenCalled();

    const pending = first.sessionPatch.pendingMessages;
    const second = await tools.registry.execute("update_cart", input, {
      context: { shopId: "shop-alpha" },
      session: session({ pendingMessages: pending }),
      confirmation: { accepted: true, ...pending[0] },
      sideEffectState: createTurnSideEffectState(),
    });
    expect(second.type).toBe("cart_updated");
    expect(second.sessionPatch).toMatchObject({
      cartId: "cart-1",
      journeyStage: "CART",
    });
    expect(tools.cartAdapter.addConfirmedItem).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown variants and cross-session cart identifiers", async () => {
    await expect(
      tools.registry.execute(
        "update_cart",
        {
          productId: product.id,
          variantId: "other-variant",
          quantity: 1,
          confirmed: true,
        },
        { session: session(), confirmation: null },
      ),
    ).rejects.toMatchObject({ code: "INVALID_VARIANT" });

    await expect(
      tools.registry.execute(
        "get_cart",
        { cartId: "cart-other" },
        {
          session: session({ cartId: "cart-1" }),
        },
      ),
    ).rejects.toMatchObject({ code: "CART_MISMATCH", status: 403 });
  });

  it("rejects invalid quantities before a cart adapter can run", async () => {
    await expect(
      tools.registry.execute(
        "update_cart",
        {
          productId: product.id,
          variantId: product.variants[0].id,
          quantity: 0,
          confirmed: true,
        },
        { session: session(), confirmation: null },
      ),
    ).rejects.toMatchObject({ code: "INVALID_TOOL_INPUT" });

    expect(tools.cartAdapter.addConfirmedItem).not.toHaveBeenCalled();
  });

  it("uses approved tenant knowledge before the Shopify policy fallback", async () => {
    const result = await tools.registry.execute(
      "retrieve_brand_knowledge",
      {
        query: "returns",
        limit: 5,
        maxCharacters: 6000,
      },
      {
        context: { shopId: "shop-alpha" },
        session: session(),
      },
    );
    expect(result.type).toBe("knowledge");
    expect(result.data[0].content).toBe("Approved answer");
    expect(tools.knowledgeService.searchKnowledge).toHaveBeenCalledWith(
      { shopId: "shop-alpha" },
      expect.objectContaining({ query: "returns" }),
    );
  });
});
