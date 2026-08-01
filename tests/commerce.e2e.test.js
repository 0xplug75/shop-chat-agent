import { Session } from "@shopify/shopify-app-react-router/server";
import { describe, expect, it, vi } from "vitest";
import { requireWidgetRequestContext } from "../app/security/merchant-context.server";
import { issueWidgetToken } from "../app/security/widget-token.server";
import { createCheckoutAdapter } from "../app/services/checkout-adapter.server";
import {
  createCommerceMutationCoordinator,
  createInMemoryCommerceMutationStore,
  createTurnSideEffectState,
  SIDE_EFFECT_STATES,
} from "../app/services/commerce-mutation.server";
import { resolveConfirmation } from "../app/services/commerce-orchestrator.server";
import {
  classifyDeterministically,
  createIntentEngine,
} from "../app/services/intent-router.server";
import { createLLMGateway } from "../app/services/llm-gateway.server";
import { createFakeProvider } from "../app/services/llm/fake-provider.server";
import { mergeConstraints } from "../app/services/commerce-session.server";
import { EncryptedPrismaSessionStorage } from "../app/services/shopify-session-storage.server";
import { createToolRegistry } from "../app/services/tool-registry.server";

const SHOP = "alpha-store.myshopify.com";
const ORIGIN = `https://${SHOP}`;
const VISITOR_ID = "7e84f2bc-41b8-479e-bfab-75cd7a4ba7df";
const CHECKOUT_URL = `https://${SHOP}/checkouts/cn/deterministic`;

const products = [
  {
    id: "gid://shopify/Product/1",
    title: "All Mountain Board",
    available: true,
    price: { amount: 649, currencyCode: "EUR" },
    variants: [
      {
        id: "gid://shopify/ProductVariant/11",
        title: "158 cm",
        available: true,
      },
    ],
  },
  {
    id: "gid://shopify/Product/2",
    title: "Resort Board",
    available: true,
    price: { amount: 699, currencyCode: "EUR" },
    variants: [
      {
        id: "gid://shopify/ProductVariant/21",
        title: "156 cm",
        available: true,
      },
    ],
  },
];

describe("deterministic commercial E2E", () => {
  it("runs installation through Shopify checkout handoff without remote calls", async () => {
    const installed = await createFixtureInstallation();
    expect(installed.session).toMatchObject({
      shop: SHOP,
      isOnline: false,
      accessToken: "fixture-offline-access",
      refreshToken: "fixture-offline-refresh",
    });
    expect(installed.persisted.accessToken).toMatch(/^v1\./);
    expect(installed.persisted.accessToken).not.toContain(
      "fixture-offline-access",
    );

    const { token } = issueWidgetToken({
      shopId: "shop-alpha",
      shopDomain: SHOP,
      storefrontOrigin: ORIGIN,
      visitorId: VISITOR_ID,
      ttlSeconds: 600,
    });
    const request = new Request("https://app.intentcart.test/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: ORIGIN,
        "X-Request-Id": "e2e-request-1",
      },
    });
    const context = requireWidgetRequestContext(request);
    expect(context).toMatchObject({
      shopId: "shop-alpha",
      shopDomain: SHOP,
      storefrontOrigin: ORIGIN,
      visitorId: VISITOR_ID,
      requestId: "e2e-request-1",
    });

    let commerceSession = createCommerceSession();
    const vagueIntent = classifyDeterministically(
      "I need help finding something",
      commerceSession,
    );
    expect(vagueIntent).toMatchObject({
      goal: "discover",
      missingInformation: ["category_or_product_type"],
    });
    const clarification = await runTurn({
      responses: [{ text: "What kind of product are you looking for?" }],
      message: "I need help finding something",
    });
    expect(clarification.text).toContain("What kind of product");

    const intentEngine = createIntentEngine();
    const intent = await intentEngine.classify({
      message: "I need a snowboard under 700 EUR for the resort",
      session: commerceSession,
    });
    commerceSession = {
      ...commerceSession,
      structuredIntent: intent,
      constraints: mergeConstraints(commerceSession.constraints, intent),
      version: commerceSession.version + 1,
    };
    expect(intent).toMatchObject({
      goal: "discover",
      category: "snowboard",
      budget: { max: 700, currency: "EUR" },
      missingInformation: [],
    });

    const cartMutationStore = createInMemoryCommerceMutationStore();
    const addConfirmedItem = vi.fn(async ({ idempotencyKey }) => ({
      toolName: "update_cart",
      cartId: "cart-1",
      cart: {
        id: "cart-1",
        checkoutUrl: CHECKOUT_URL,
        lines: [
          {
            productId: products[0].id,
            variantId: products[0].variants[0].id,
            quantity: 1,
          },
        ],
      },
      businessMessage: {
        outcome: "ok",
        assistantMessage: "Shopify completed the requested commerce action.",
      },
      idempotencyKey,
    }));
    const registry = createToolRegistry({
      catalogAdapter: {
        searchCatalog: vi.fn().mockResolvedValue({ products }),
        getProduct: vi.fn().mockImplementation(async ({ id }) => ({
          product: products.find((product) => product.id === id),
        })),
      },
      policyAdapter: {
        searchPolicies: vi
          .fn()
          .mockResolvedValue({ response: "30 day returns" }),
      },
      cartAdapter: {
        getCart: vi.fn(),
        addConfirmedItem,
      },
      checkoutAdapter: createCheckoutAdapter({
        shopDomain: SHOP,
        storefrontOrigin: ORIGIN,
      }),
      knowledgeService: { searchKnowledge: vi.fn().mockResolvedValue([]) },
      mutationCoordinator: createCommerceMutationCoordinator({
        store: cartMutationStore,
      }),
    });

    const search = await runTurn({
      registry,
      getSession: () => commerceSession,
      setSession: (next) => {
        commerceSession = next;
      },
      context,
      message: "Show me matching snowboards",
      responses: [
        {
          toolCalls: [
            {
              name: "search_catalog",
              input: {
                query: "resort snowboard under 700 EUR",
                filters: {},
                availability: "available",
                limit: 3,
              },
            },
          ],
        },
        { text: "I found two current Shopify options." },
      ],
    });
    expect(search.text).toContain("two current Shopify options");
    expect(commerceSession.recommendedProducts).toHaveLength(2);
    expect(commerceSession.recommendedProducts.length).toBeLessThanOrEqual(3);

    const comparison = await runTurn({
      registry,
      getSession: () => commerceSession,
      setSession: (next) => {
        commerceSession = next;
      },
      context,
      message: "Compare them",
      responses: [
        {
          toolCalls: [
            {
              name: "compare_products",
              input: {
                productIds: products.map((product) => product.id),
                criteria: ["price", "fit"],
              },
            },
          ],
        },
        {
          text: "The first is less expensive; the second stays within budget.",
        },
      ],
    });
    expect(comparison.text).toContain("first is less expensive");
    expect(commerceSession.comparedProducts).toHaveLength(2);

    const selection = {
      productId: products[0].id,
      variantId: products[0].variants[0].id,
      quantity: 1,
      confirmed: true,
    };
    const confirmationRequest = await runTurn({
      registry,
      getSession: () => commerceSession,
      setSession: (next) => {
        commerceSession = next;
      },
      context,
      message: "Add the 158 cm first board",
      responses: [
        { toolCalls: [{ name: "update_cart", input: selection }] },
        {
          text: "Please confirm the exact board, 158 cm variant, and quantity 1.",
        },
      ],
    });
    expect(confirmationRequest.toolResults[0].type).toBe(
      "confirmation_required",
    );
    expect(addConfirmedItem).not.toHaveBeenCalled();
    expect(commerceSession.pendingMessages[0]).toMatchObject({
      type: "cart_confirmation",
      productId: selection.productId,
      variantId: selection.variantId,
      quantity: 1,
      confirmationId: expect.any(String),
    });

    const confirmation = resolveConfirmation(
      "I confirm",
      commerceSession.pendingMessages,
    );
    expect(confirmation).toMatchObject({
      accepted: true,
      productId: selection.productId,
      variantId: selection.variantId,
      quantity: selection.quantity,
      confirmationId: expect.any(String),
      selectionRevision: expect.any(Number),
    });
    const cart = await runTurn({
      registry,
      getSession: () => commerceSession,
      setSession: (next) => {
        commerceSession = next;
      },
      context,
      confirmation,
      message: "I confirm",
      responses: [
        { toolCalls: [{ name: "update_cart", input: selection }] },
        { text: "The confirmed variant is now in your Shopify cart." },
      ],
    });
    expect(cart.text).toContain("Shopify cart");
    expect(addConfirmedItem).toHaveBeenCalledOnce();
    expect(addConfirmedItem.mock.calls[0][0].idempotencyKey).toMatch(
      /^commerce:v1:[a-f0-9]{64}$/,
    );
    expect(commerceSession).toMatchObject({
      journeyStage: "CART",
      cartId: "cart-1",
      checkoutUrl: CHECKOUT_URL,
      pendingMessages: [],
    });
    expect([...cartMutationStore.records.values()][0].state).toBe(
      SIDE_EFFECT_STATES.CONFIRMED,
    );

    const checkout = await runTurn({
      registry,
      getSession: () => commerceSession,
      setSession: (next) => {
        commerceSession = next;
      },
      context,
      message: "Checkout",
      responses: [
        {
          toolCalls: [
            { name: "create_checkout_handoff", input: { cartId: "cart-1" } },
          ],
        },
        { text: "Continue securely to Shopify checkout." },
      ],
    });
    expect(checkout.text).toContain("Shopify checkout");
    expect(commerceSession).toMatchObject({
      journeyStage: "CHECKOUT",
      checkoutUrl: CHECKOUT_URL,
    });
  });
});

async function runTurn({
  responses,
  registry,
  getSession = () => createCommerceSession(),
  setSession = () => {},
  context = { shopId: "shop-alpha", shopDomain: SHOP },
  message,
  confirmation = null,
}) {
  const gateway = createLLMGateway({
    adapter: createFakeProvider({ responses }),
  });
  const sideEffectState = createTurnSideEffectState();
  const toolResults = [];
  const result = await gateway.runToolLoop({
    messages: [{ role: "user", content: message }],
    merchantConfig: merchantConfig(),
    commerceContext: {
      id: getSession().id,
      journeyStage: getSession().journeyStage,
    },
    tools: registry?.listModelTools() || [],
    sideEffectState,
    executeTool: registry
      ? async (name, input) => {
          const toolResult = await registry.execute(name, input, {
            context,
            session: getSession(),
            confirmation,
            sideEffectState,
          });
          toolResults.push(toolResult);
          if (toolResult.sessionPatch) {
            setSession({
              ...getSession(),
              ...toolResult.sessionPatch,
              version: getSession().version + 1,
            });
          }
          return toolResult;
        }
      : undefined,
  });
  return { ...result, toolResults };
}

function createCommerceSession() {
  return {
    id: "commerce-session-e2e",
    conversationId: "c9dca7e0-0210-4a0e-bd6d-b471d99828f9",
    journeyStage: "DISCOVER",
    structuredIntent: null,
    constraints: {},
    recommendedProducts: [],
    comparedProducts: [],
    selectedProductId: null,
    selectedVariantId: null,
    quantity: 1,
    cartId: null,
    checkoutUrl: null,
    buyerContext: {},
    pendingMessages: [],
    version: 1,
    messages: [],
  };
}

function merchantConfig() {
  return {
    assistant: { name: "Sage", personality: "calm", brandVoice: "clear" },
    shopping: {
      recommendationRules: { maxProducts: 3 },
      outOfStockPolicy: "suggest alternatives",
    },
  };
}

async function createFixtureInstallation() {
  const rows = new Map();
  const sessionModel = {
    findUnique: async ({ where, select }) => {
      const row = rows.get(where.id);
      if (!row) return null;
      if (!select) return structuredClone(row);
      return Object.fromEntries(
        Object.keys(select)
          .filter((key) => select[key])
          .map((key) => [key, row[key]]),
      );
    },
    upsert: async ({ where, create, update }) => {
      const value = rows.has(where.id)
        ? { ...rows.get(where.id), ...update }
        : create;
      rows.set(where.id, structuredClone(value));
      return structuredClone(value);
    },
  };
  const database = {
    session: sessionModel,
    $transaction: async (callback) => callback({ session: sessionModel }),
  };
  const storage = new EncryptedPrismaSessionStorage(database, {
    apiKey: "fixture-api-key",
    apiSecret: "fixture-api-secret",
  });
  const source = new Session({
    id: `offline_${SHOP}`,
    shop: SHOP,
    state: "",
    isOnline: false,
    scope: "read_products,write_app_proxy",
    accessToken: "fixture-offline-access",
    refreshToken: "fixture-offline-refresh",
    expires: new Date(Date.now() + 60 * 60_000),
    refreshTokenExpires: new Date(Date.now() + 90 * 24 * 60 * 60_000),
  });
  await storage.storeSession(source);
  return {
    session: await storage.loadSession(source.id),
    persisted: rows.get(source.id),
  };
}
