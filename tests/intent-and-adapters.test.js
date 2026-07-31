import { describe, expect, it } from "vitest";
import { classifyDeterministically, createIntentEngine } from "../app/services/intent-router.server";
import {
  isExplicitConfirmation,
  isExplicitRejection,
  resolveConfirmation,
  resolveConfirmationRejection
} from "../app/services/commerce-orchestrator.server";
import { createCheckoutAdapter } from "../app/services/checkout-adapter.server";
import { extractCartId, normalizeCartResponse } from "../app/services/cart-adapter.server";
import { createBusinessMessageInterpreter } from "../app/services/business-message-interpreter.server";

describe("intent, confirmation, and commerce adapters", () => {
  it("extracts multilingual shopping intent and preserves known constraints", () => {
    const intent = classifyDeterministically(
      "Je cherche un snowboard à moins de 700 euros, avec une planche légère",
      { constraints: { budget: { min: 250 }, category: null } }
    );
    expect(intent).toMatchObject({
      goal: "discover",
      category: "snowboard",
      budget: { min: 250, max: 700, currency: "EUR" }
    });
  });

  it("falls back to deterministic intent when model output is invalid", async () => {
    const engine = createIntentEngine({
      llmGateway: { generateStructuredIntent: async () => ({ invalid: true }) }
    });
    await expect(engine.classify({ message: "compare ces snowboards", session: {} }))
      .resolves.toMatchObject({ goal: "compare" });
  });

  it("accepts and rejects only explicit confirmation turns", () => {
    const pending = [{
      type: "cart_confirmation",
      productId: "product-1",
      variantId: "variant-1",
      quantity: 2
    }];
    expect(isExplicitConfirmation("Oui merci !")).toBe(true);
    expect(isExplicitConfirmation("Maybe yes after another comparison")).toBe(false);
    expect(resolveConfirmation("je confirme", pending)).toMatchObject({
      accepted: true,
      productId: "product-1",
      variantId: "variant-1",
      quantity: 2
    });
    expect(isExplicitRejection("non merci")).toBe(true);
    expect(resolveConfirmationRejection("cancel", pending)).toBe(true);
  });

  it("returns checkout URLs only for the current shop or configured storefront", () => {
    const adapter = createCheckoutAdapter({
      shopDomain: "alpha.myshopify.com",
      storefrontOrigin: "https://shop.alpha.example"
    });
    expect(adapter.validateCheckoutUrl("https://alpha.myshopify.com/checkouts/cn/one"))
      .toContain("alpha.myshopify.com/checkouts");
    expect(adapter.validateCheckoutUrl("https://shop.alpha.example/cart/c/one"))
      .toContain("shop.alpha.example/cart/c/one");
    expect(adapter.validateCheckoutUrl("https://other.myshopify.com/checkouts/cn/one"))
      .toBe("");
    expect(adapter.validateCheckoutUrl("https://attacker.example/checkout"))
      .toBe("");
    expect(adapter.validateCheckoutUrl("https://alpha.myshopify.com/products/one"))
      .toBe("");
  });

  it("extracts a cart ID while redacting buyer secrets from the session snapshot", () => {
    const response = {
      content: [{
        text: JSON.stringify({
          cart: {
            id: "gid://shopify/Cart/one",
            lines: [],
            buyer_identity: { email: "shopper@example.com", accessToken: "secret" }
          }
        })
      }]
    };
    expect(extractCartId(response)).toBe("gid://shopify/Cart/one");
    expect(normalizeCartResponse(response)).toEqual({
      cart: { id: "gid://shopify/Cart/one", lines: [] }
    });
  });

  it("never returns a raw Shopify business response as assistant text", () => {
    const interpreter = createBusinessMessageInterpreter();
    const sensitiveRaw = "Operation succeeded for shopper@example.com with token abc123";
    expect(interpreter.interpret(sensitiveRaw)).toEqual({
      outcome: "ok",
      assistantMessage: "Shopify completed the requested commerce action."
    });
  });
});
