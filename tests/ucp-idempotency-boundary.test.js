import { describe, expect, it, vi } from "vitest";
import { createUcpProvider } from "../app/services/commerce/ucp-provider.server";

const IDEMPOTENCY_KEY = `commerce:v1:${"a".repeat(64)}`;

describe("UCP mutation idempotency boundary", () => {
  it("forwards the durable key to cart create, cart update and checkout create", async () => {
    const calls = [];
    const client = createClient(calls);
    const provider = createUcpProvider({ client, checkoutEnabled: true });

    await provider.addConfirmedItem({
      variantId: "variant:1",
      quantity: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    await provider.addConfirmedItem({
      cartId: "cart:1",
      variantId: "variant:1",
      quantity: 1,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    await provider.createCheckoutHandoff({
      cartId: "cart:1",
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    for (const name of ["create_cart", "update_cart", "create_checkout"]) {
      expect(calls.find((call) => call.name === name)?.options).toMatchObject({
        idempotencyKey: IDEMPOTENCY_KEY,
      });
    }
  });

  it("keeps complete_checkout unavailable in V1", async () => {
    const calls = [];
    const provider = createUcpProvider({
      client: createClient(calls),
      checkoutEnabled: true,
    });
    await expect(provider.completeCheckout()).rejects.toMatchObject({
      code: "COMMERCE_CAPABILITY_UNAVAILABLE",
    });
    expect(calls.some((call) => call.name === "complete_checkout")).toBe(false);
  });
});

function createClient(calls) {
  const tools = new Set([
    "create_cart",
    "get_cart",
    "update_cart",
    "create_checkout",
    "complete_checkout",
  ]);
  return {
    initialize: vi.fn(async () => ({ tools: [...tools] })),
    hasCapability: vi.fn(() => true),
    hasTool: vi.fn((name) => tools.has(name)),
    callTool: vi.fn(async (name, args, options = {}) => {
      calls.push({ name, args, options });
      if (name === "get_cart") {
        return result({
          cart: {
            id: "cart:1",
            version: 1,
            line_items: [{ item: { id: "variant:1" }, quantity: 1 }],
            continue_url: "https://fixture.myshopify.com/cart/c/cart-1",
          },
        });
      }
      if (name === "create_cart" || name === "update_cart") {
        return result({
          cart: {
            id: "cart:1",
            version: 2,
            line_items: [{ item: { id: "variant:1" }, quantity: 2 }],
            continue_url: "https://fixture.myshopify.com/cart/c/cart-1",
          },
        });
      }
      return result(
        { checkout: { id: "checkout:1" } },
        {
          continueUrl: "https://fixture.myshopify.com/checkouts/checkout-1",
        },
      );
    }),
  };
}

function result(structured, overrides = {}) {
  return {
    structured,
    resource: structured.cart || structured.checkout || structured,
    messages: [],
    warnings: [],
    disclosures: [],
    status: "completed",
    requiresEscalation: false,
    continueUrl: structured.cart?.continue_url || null,
    ...overrides,
  };
}
