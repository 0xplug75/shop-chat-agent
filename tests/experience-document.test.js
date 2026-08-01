import { describe, expect, it } from "vitest";
import { merchantDefaults } from "../app/merchant/merchant.defaults";
import { toPublicMerchantConfig } from "../app/merchant/public-config.server";
import {
  buildExperienceDocument,
  normalizeExperienceProduct,
} from "../app/services/experience-document.server";

const context = {
  shopId: "shop-alpha",
  shopDomain: "alpha.myshopify.com",
  storefrontOrigin: "https://alpha.myshopify.com",
  requestId: "e7a28b09-fe38-4d31-ae73-46ef85d82992",
};

describe("ExperienceDocument projection", () => {
  it("normalizes provider output and limits recommendations to three", () => {
    const ids = [
      "ec8062fa-2a5a-470f-a909-056656fa7794",
      "e091fc52-cab5-4edf-8a19-e535958b5980",
    ];
    const result = buildExperienceDocument({
      context,
      merchantConfig: structuredClone(merchantDefaults),
      session: { version: 3, journeyStage: "COMPARE", comparedProducts: [] },
      intent: { missingInformation: [] },
      assistantText: "These are the strongest current options.",
      products: [1, 2, 3, 4].map(productFixture),
      providerId: "shopify",
      clock: () => new Date("2026-08-01T10:00:00.000Z"),
      idFactory: () => ids.shift(),
    });

    expect(result.document).toMatchObject({
      version: "1.0",
      surface: "widget",
      state: "recommendations",
    });
    expect(result.recommendations.products).toHaveLength(3);
    expect(result.recommendations.products[0]).toMatchObject({
      canonicalUrl: "https://alpha.myshopify.com/products/product-1",
      imageUrl: "https://cdn.shopify.com/product-1.jpg",
      trust: { source: "shopify" },
      variants: [
        {
          price: { amount: "49.00", currencyCode: "EUR" },
          selectedOptions: [{ name: "Size", value: "Medium" }],
        },
      ],
    });
    expect(result.document.actions).toContainEqual(
      expect.objectContaining({ type: "compare_products" }),
    );
  });

  it("projects confirmation and checkout without mutating commerce", () => {
    const result = buildExperienceDocument({
      context,
      merchantConfig: {
        ...structuredClone(merchantDefaults),
        widget: {
          ...structuredClone(merchantDefaults.widget),
          layout: "inline",
        },
      },
      session: { version: 4, journeyStage: "CHECKOUT", comparedProducts: [] },
      intent: { missingInformation: [] },
      assistantText: "Your confirmed cart is ready.",
      confirmationRequired: {
        confirmationId: "7b21f3e6-00dd-42e1-95e6-36c1420c5f36",
        productId: "product-1",
        variantId: "variant-1",
        quantity: 1,
      },
      cartState: {
        cartId: "cart-1",
        checkoutUrl: "https://alpha.myshopify.com/checkouts/cn/one",
      },
      idFactory: () => "e091fc52-cab5-4edf-8a19-e535958b5980",
    });

    expect(result.document.surface).toBe("inline");
    expect(result.document.state).toBe("checkout");
    expect(result.document.actions).toContainEqual(
      expect.objectContaining({
        type: "open_checkout",
        payload: {
          checkoutUrl: "https://alpha.myshopify.com/checkouts/cn/one",
        },
      }),
    );
  });

  it("drops malformed catalog entries at the contract boundary", () => {
    expect(
      normalizeExperienceProduct(
        { title: "Missing identifier" },
        {
          context,
          providerId: "shopify",
          generatedAt: "2026-08-01T10:00:00.000Z",
        },
      ),
    ).toBeNull();
  });
});

describe("public launcher assignment", () => {
  it("activates the contextual suggestion only for its assigned treatment", () => {
    const config = structuredClone(merchantDefaults);
    config.shopping.featureFlags.contextualLauncher = true;
    const assignment = {
      experimentKey: "launcher_entry_v1",
      variant: "contextual",
    };

    expect(
      toPublicMerchantConfig(config, { experimentAssignment: assignment }),
    ).toMatchObject({
      widget: { behavior: { contextualSuggestion: true } },
      experiment: { key: "launcher_entry_v1", variant: "contextual" },
    });
    expect(
      toPublicMerchantConfig(config, {
        experimentAssignment: { ...assignment, variant: "reactive" },
      }).widget.behavior.contextualSuggestion,
    ).toBe(false);
  });
});

function productFixture(index) {
  return {
    id: `gid://shopify/Product/${index}`,
    title: `Product ${index}`,
    description: "Current Shopify product.",
    url: `/products/product-${index}`,
    image_url: `https://cdn.shopify.com/product-${index}.jpg`,
    available: true,
    variants: [
      {
        id: `gid://shopify/ProductVariant/${index}`,
        title: "Medium",
        price: "EUR 49.00",
        currency: "EUR",
        available: true,
        selected_options: ["Size: Medium"],
      },
    ],
    tags: ["featured"],
  };
}
