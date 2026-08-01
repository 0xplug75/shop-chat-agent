import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BehaviorSignalSchema,
  BuyerContextSchema,
  CartSnapshotSchema,
  CatalogSearchRequestSchema,
  ChatRequestSchema,
  CommerceSessionContractSchema,
  ExperienceDocumentSchema,
  ExperimentAssignmentSchema,
  IntentStateSchema,
  MerchantContextSchema,
  NormalizedProductSchema,
  PurchaseCandidateSchema,
  RecommendationSetSchema,
  RecoveryStateSchema,
  ShoppingIntentSchema,
  VerticalPackSchema,
} from "../app/contracts/commerce.schemas.server";
import {
  handlePublicChatRequest,
  readJsonBodyWithLimit,
  RequestTooLargeError,
} from "../app/services/chat-request.server";
import {
  fetchWithTimeout,
  readJsonResponseWithLimit,
} from "../app/lib/fetch-with-timeout.server";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("public request contracts", () => {
  it("accepts a strict bounded chat payload", () => {
    const parsed = ChatRequestSchema.parse({
      message: "Show me a snowboard under 700 EUR",
      visitor_id: "7e84f2bc-41b8-479e-bfab-75cd7a4ba7df",
    });
    expect(parsed.message).toContain("snowboard");
    expect(() =>
      ChatRequestSchema.parse({ message: "hello", admin: true }),
    ).toThrow();
    expect(() =>
      ChatRequestSchema.parse({ message: "x".repeat(2001) }),
    ).toThrow();
  });

  it("rejects a visitor identifier that does not match the signed widget context", async () => {
    const request = new Request("https://app.example/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Show me a snowboard",
        visitor_id: "494aec6b-bad2-4962-996c-9fd1cd715741",
      }),
    });
    const response = await handlePublicChatRequest({
      request,
      context: {
        shopId: "shop-alpha",
        shopDomain: "alpha-store.myshopify.com",
        visitorId: "7e84f2bc-41b8-479e-bfab-75cd7a4ba7df",
        requestId: "request-visitor-mismatch",
      },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Unauthorized",
    });
  });

  it("validates the complete structured intent shape", () => {
    expect(
      ShoppingIntentSchema.parse({
        goal: "discover",
        category: "snowboard",
        useCase: null,
        budget: { min: null, max: 700, currency: "EUR" },
        attributes: {},
        preferences: ["all mountain"],
        exclusions: [],
        requestedProductIds: [],
        confidence: 0.8,
        missingInformation: [],
      }).budget.currency,
    ).toBe("EUR");
  });

  it("validates strict versioned consolidation boundaries", () => {
    const intent = IntentStateSchema.parse({
      version: "1.0",
      revision: 2,
      goal: "discover",
      category: "snowboard",
      useCase: "resort",
      budget: { min: null, max: 700, currency: "EUR" },
      attributes: {},
      preferences: ["all mountain"],
      exclusions: [],
      requestedProductIds: [],
      confidence: 0.8,
      missingInformation: [],
      constraints: { availability: "available" },
      evidence: [
        {
          source: "shopper",
          field: "budget.max",
          value: 700,
          observedAt: "2026-08-01T10:00:00.000Z",
        },
      ],
    });
    expect(
      CatalogSearchRequestSchema.parse({
        version: "1.0",
        merchant: { shopId: "shop-alpha" },
        buyer: { countryCode: "FR", languageCode: "fr-FR" },
        vertical: null,
        intent,
        filters: { hard: { availability: "available" }, soft: {} },
        signals: [],
        pagination: { cursor: null },
        limit: 3,
      }).limit,
    ).toBe(3);
    expect(
      PurchaseCandidateSchema.parse({
        version: "1.0",
        confirmationId: "a6d3e3cb-1675-48f4-9e14-29d79b28a37b",
        selectionRevision: 2,
        productId: "gid://shopify/Product/1",
        variantId: "gid://shopify/ProductVariant/11",
        quantity: 1,
        cartId: null,
        confirmedAt: "2026-08-01T10:01:00.000Z",
      }).quantity,
    ).toBe(1);
    expect(
      CartSnapshotSchema.parse({
        version: "1.0",
        provider: "shopify",
        cartId: "gid://shopify/Cart/1",
        checkoutUrl: "https://alpha.myshopify.com/checkouts/cn/one",
        lines: [
          {
            lineId: null,
            productId: "gid://shopify/Product/1",
            variantId: "gid://shopify/ProductVariant/11",
            quantity: 1,
          },
        ],
        cost: { subtotal: 649, total: 649, currency: "EUR" },
        providerUpdatedAt: "2026-08-01T10:02:00.000Z",
      }).provider,
    ).toBe("shopify");
    expect(() =>
      PurchaseCandidateSchema.parse({
        version: "1.0",
        extra: true,
      }),
    ).toThrow();
  });

  it("validates the production Sage core contract family", () => {
    const requestId = "e7a28b09-fe38-4d31-ae73-46ef85d82992";
    const visitorId = "7e84f2bc-41b8-479e-bfab-75cd7a4ba7df";
    const conversationId = "c60f8b36-c699-4d3a-8d77-e768f5786acc";
    const generatedAt = "2026-08-01T10:00:00.000Z";
    const intent = IntentStateSchema.parse({
      version: "1.0",
      revision: 1,
      goal: "discover",
      category: "snowboard",
      useCase: "resort",
      budget: { min: null, max: 700, currency: "EUR" },
      attributes: {},
      preferences: [],
      exclusions: [],
      requestedProductIds: [],
      confidence: 0.9,
      missingInformation: [],
      constraints: {},
      evidence: [],
    });
    const product = NormalizedProductSchema.parse({
      version: "1.0",
      id: "gid://shopify/Product/1",
      handle: "all-mountain-board",
      title: "All Mountain Board",
      description: "A resort snowboard.",
      canonicalUrl: "https://alpha.myshopify.com/products/all-mountain-board",
      imageUrl: null,
      available: true,
      variants: [
        {
          id: "gid://shopify/ProductVariant/1",
          title: "158 cm",
          available: true,
          price: { amount: "649.00", currencyCode: "EUR" },
          selectedOptions: [{ name: "Size", value: "158 cm" }],
        },
      ],
      trust: {
        version: "1.0",
        source: "shopify",
        sourceId: "gid://shopify/Product/1",
        fetchedAt: generatedAt,
        canonicalUrl: "https://alpha.myshopify.com/products/all-mountain-board",
        evidence: ["Shopify live catalog"],
      },
      attributes: {},
    });
    const recommendations = RecommendationSetSchema.parse({
      version: "1.0",
      id: "ec8062fa-2a5a-470f-a909-056656fa7794",
      intentRevision: 1,
      products: [product],
      rationale: "Fits the stated budget and resort use case.",
      tradeoffs: ["More stable than playful."],
      generatedAt,
    });
    const recovery = RecoveryStateSchema.parse({
      version: "1.0",
      status: "available",
      intent,
      recommendations: [recommendations],
      cartCandidate: null,
      cartId: null,
      checkoutUrl: null,
      savedAt: generatedAt,
      expiresAt: "2026-08-02T10:00:00.000Z",
    });

    expect(
      MerchantContextSchema.parse({
        version: "1.0",
        shopId: "shop-alpha",
        shopDomain: "alpha.myshopify.com",
        storefrontOrigin: "https://alpha.myshopify.com",
        requestId,
        conversationId,
      }).shopDomain,
    ).toBe("alpha.myshopify.com");
    expect(
      BuyerContextSchema.parse({
        version: "1.0",
        visitorId,
        customerId: null,
        countryCode: "FR",
        languageCode: "fr-FR",
        currencyCode: "EUR",
        consent: { personalization: true, recovery: true },
      }).consent.recovery,
    ).toBe(true);
    expect(
      VerticalPackSchema.parse({
        version: "1.0",
        id: "skincare",
        displayName: "Skincare",
        status: "shadow",
        capabilities: ["routine-discovery"],
        configuration: {},
        provenance: {
          owner: "IntentCart",
          source: "labs/magpie-intent-finder",
          updatedAt: generatedAt,
        },
      }).id,
    ).toBe("skincare");
    expect(
      ExperienceDocumentSchema.parse({
        version: "1.0",
        id: "e091fc52-cab5-4edf-8a19-e535958b5980",
        surface: "widget",
        state: "recommendations",
        blocks: [{ id: "products", type: "product_list", data: {} }],
        actions: [
          { id: "compare", type: "compare", label: "Compare", payload: {} },
        ],
      }).surface,
    ).toBe("widget");
    expect(
      ExperimentAssignmentSchema.parse({
        version: "1.0",
        id: "assignment-1",
        experimentKey: "launcher_entry_v1",
        variant: "reactive",
        visitorId,
        assignedAt: generatedAt,
        exposedAt: null,
      }).variant,
    ).toBe("reactive");
    expect(
      BehaviorSignalSchema.parse({
        version: "1.0",
        eventName: "products_recommended",
        shopId: "shop-alpha",
        visitorId,
        conversationId,
        experimentKey: "launcher_entry_v1",
        variant: "reactive",
        payload: { count: 1 },
        occurredAt: generatedAt,
      }).payload.count,
    ).toBe(1);
    expect(
      CommerceSessionContractSchema.parse({
        version: "1.0",
        id: "session-1",
        shopId: "shop-alpha",
        conversationId,
        stage: "COMPARE",
        intent,
        recommendations,
        cartCandidate: null,
        cart: null,
        recovery,
        experiment: null,
        expiresAt: "2026-08-02T10:00:00.000Z",
        revision: 1,
      }).recommendations.products,
    ).toHaveLength(1);
  });

  it("enforces the request body limit while streaming", async () => {
    const valid = new Request("https://app.example/chat", {
      method: "POST",
      body: JSON.stringify({ message: "hello" }),
    });
    await expect(readJsonBodyWithLimit(valid, 100)).resolves.toEqual({
      message: "hello",
    });

    const oversized = new Request("https://app.example/chat", {
      method: "POST",
      body: JSON.stringify({ message: "x".repeat(200) }),
    });
    await expect(readJsonBodyWithLimit(oversized, 50)).rejects.toBeInstanceOf(
      RequestTooLargeError,
    );
  });

  it("rejects oversized upstream JSON before parsing it", async () => {
    const response = new Response(JSON.stringify({ data: "x".repeat(200) }));
    await expect(readJsonResponseWithLimit(response, 50)).rejects.toMatchObject(
      { code: "EXTERNAL_RESPONSE_TOO_LARGE" },
    );
  });

  it("aborts a stalled external request and returns a normalized timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
              },
              { once: true },
            );
          }),
      ),
    );

    await expect(
      fetchWithTimeout("https://example.test", {}, 5),
    ).rejects.toMatchObject({
      code: "EXTERNAL_TIMEOUT",
      isTimeout: true,
    });
  });

  it("keeps the storefront renderer free of dangerous HTML sinks", async () => {
    const source = await readFile(
      new URL("../extensions/chat-bubble/assets/chat.js", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(
      /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval)\b/,
    );
    expect(source).toContain("textContent");
    expect(source).toContain("widget_token: this.bootstrapData.token");
    expect(source).toContain('method: usesAppProxy ? "POST" : "GET"');
  });
});
