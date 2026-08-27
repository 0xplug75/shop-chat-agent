import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCommerceAuthority } from "../app/services/commerce/commerce-authority.server";
import { createCommerceBoundary } from "../app/services/commerce/commerce-boundary.server";
import {
  createCommerceConfirmationService,
  createInMemoryCommerceConfirmationStore,
} from "../app/services/commerce/commerce-confirmation.server";
import {
  createCommerceMutationCoordinator,
  createInMemoryCommerceMutationStore,
} from "../app/services/commerce-mutation.server";
import { createToolRegistry } from "../app/services/tool-registry.server";

const BASE_TIME = new Date("2026-08-08T12:00:00.000Z");
const PRODUCT_ID = "product:fixture:001";
const VARIANT_ID = "variant:fixture:001";

describe("Shopify Commerce boundary", () => {
  let clock;
  let provider;
  let runtime;

  beforeEach(() => {
    clock = createClock(BASE_TIME);
    provider = createDeterministicProvider();
    runtime = createRuntime({ provider, clock });
  });

  it("requires an exact confirmation before the first cart mutation", async () => {
    const prepared = await runtime.boundary.prepare(request());
    expect(prepared.envelope.result.status).toBe("confirmation_required");
    expect(prepared.envelope.result.receipt).toMatchObject({
      action: "request_cart_add",
      stateRevision: 7,
      singleUse: true,
      candidate: {
        productRef: { productId: PRODUCT_ID },
        variantRef: VARIANT_ID,
        quantity: 2,
        unitPrice: { amountMinor: 4999, currency: "EUR" },
      },
    });
    expect(provider.addConfirmedItem).not.toHaveBeenCalled();

    const completed = await runtime.boundary.confirm(
      confirmationRequest(prepared, "accept"),
    );
    expect(completed.envelope.result.status).toBe("succeeded_authoritative");
    expect(completed.outcomeEvent.outcome).toBe("mutation_succeeded");
    expect(provider.addConfirmedItem).toHaveBeenCalledOnce();
    expect(provider.addConfirmedItem.mock.calls[0][0].idempotencyKey).toMatch(
      /^commerce:v1:[a-f0-9]{64}$/,
    );
  });

  it("consumes a confirmation once and never mutates again when it is reused", async () => {
    const prepared = await runtime.boundary.prepare(request());
    const first = await runtime.boundary.confirm(
      confirmationRequest(prepared, "accept"),
    );
    const second = await runtime.boundary.confirm(
      confirmationRequest(prepared, "accept"),
    );
    expect(first.envelope.result.status).toBe("succeeded_authoritative");
    expect(second.envelope.result).toEqual({
      status: "denied",
      safeReasonCode: "CONFIRMATION_NOT_USABLE",
    });
    expect(provider.addConfirmedItem).toHaveBeenCalledOnce();
  });

  it("binds the confirmation receipt to the exact handoff product", async () => {
    const prepared = await runtime.boundary.prepare(request());
    const alteredHandoff = {
      ...handoff(),
      selectedProductRef: {
        ...handoff().selectedProductRef,
        productId: "product:fixture:002",
      },
    };
    const denied = await runtime.boundary.confirm(
      confirmationRequest(prepared, "accept", { handoff: alteredHandoff }),
    );
    expect(denied.envelope.result).toEqual({
      status: "denied",
      safeReasonCode: "CONFIRMATION_MISMATCH",
    });
    expect(provider.addConfirmedItem).not.toHaveBeenCalled();
  });

  it("records an explicit decline without mutating", async () => {
    const prepared = await runtime.boundary.prepare(request());
    const declined = await runtime.boundary.confirm(
      confirmationRequest(prepared, "decline"),
    );
    expect(declined.envelope.result.status).toBe("confirmation_declined");
    expect(declined.outcomeEvent.outcome).toBe("no_mutation");
    expect(provider.addConfirmedItem).not.toHaveBeenCalled();
  });

  it("expires confirmations and handoffs fail closed", async () => {
    const prepared = await runtime.boundary.prepare(request());
    clock.advance(121_000);
    const expired = await runtime.boundary.confirm(
      confirmationRequest(prepared, "accept"),
    );
    expect(expired.envelope.result.status).toBe("confirmation_expired");
    expect(provider.addConfirmedItem).not.toHaveBeenCalled();

    clock.set(new Date("2026-08-08T12:05:00.000Z"));
    const staleHandoff = await runtime.boundary.prepare(request());
    expect(staleHandoff.envelope.result).toEqual({
      status: "failed_before_mutation",
      safeReasonCode: "HANDOFF_EXPIRED",
    });
  });

  it("rejects stale decision state before permission or mutation", async () => {
    const stale = await runtime.boundary.prepare(
      request({ session: { ...session(), version: 8 } }),
    );
    expect(stale.envelope.result).toEqual({
      status: "stale_state",
      expectedRevision: 8,
    });
    expect(provider.getProduct).not.toHaveBeenCalled();
  });

  it("detects fresh price and availability changes after confirmation", async () => {
    const pricePrepared = await runtime.boundary.prepare(request());
    provider.state.product.variants[0].unitPrice.amountMinor = 5999;
    const priceChanged = await runtime.boundary.confirm(
      confirmationRequest(pricePrepared, "accept"),
    );
    expect(priceChanged.envelope.result).toEqual({
      status: "price_changed",
      currentUnitPrice: { amountMinor: 5999, currency: "EUR" },
    });
    expect(provider.addConfirmedItem).not.toHaveBeenCalled();

    runtime = createRuntime({ provider: createDeterministicProvider(), clock });
    provider = runtime.provider;
    const stockPrepared = await runtime.boundary.prepare(request());
    provider.state.product.variants[0].available = false;
    const unavailable = await runtime.boundary.confirm(
      confirmationRequest(stockPrepared, "accept"),
    );
    expect(unavailable.envelope.result).toEqual({
      status: "unavailable",
      safeReasonCode: "VARIANT_UNAVAILABLE",
    });
    expect(provider.addConfirmedItem).not.toHaveBeenCalled();
  });

  it("rejects a fresh stock quantity below the confirmed quantity", async () => {
    const prepared = await runtime.boundary.prepare(request());
    provider.state.product.variants[0].quantityAvailable = 1;
    const unavailable = await runtime.boundary.confirm(
      confirmationRequest(prepared, "accept"),
    );
    expect(unavailable.envelope.result).toEqual({
      status: "unavailable",
      safeReasonCode: "INSUFFICIENT_STOCK",
    });
    expect(provider.addConfirmedItem).not.toHaveBeenCalled();
  });

  it("rejects invalid variants and quantities before confirmation", async () => {
    const invalidVariant = await runtime.boundary.prepare(
      request({
        commerceInputs: { variantRef: "variant:missing", quantity: 1 },
      }),
    );
    expect(invalidVariant.envelope.result).toEqual({
      status: "invalid_variant",
      safeReasonCode: "VARIANT_NOT_FOUND",
    });

    const invalidQuantity = await runtime.boundary.prepare(
      request({ commerceInputs: { variantRef: VARIANT_ID, quantity: 101 } }),
    );
    expect(invalidQuantity.envelope.result).toEqual({
      status: "invalid_quantity",
      safeReasonCode: "QUANTITY_OUT_OF_RANGE",
    });
    expect(provider.addConfirmedItem).not.toHaveBeenCalled();
  });

  it("rejects a stale authoritative cartVersion", async () => {
    provider.state.carts.set("cart:fixture:001", cart("cart:fixture:001", 1));
    const prepared = await runtime.boundary.prepare(
      request({
        session: { ...session(), cartId: "cart:fixture:001" },
        commerceInputs: {
          variantRef: VARIANT_ID,
          quantity: 1,
          cartRef: "cart:fixture:001",
        },
      }),
    );
    provider.state.carts.get("cart:fixture:001").version = 2;
    const stale = await runtime.boundary.confirm(
      confirmationRequest(prepared, "accept", {
        session: { ...session(), cartId: "cart:fixture:001" },
      }),
    );
    expect(stale.envelope.result.status).toBe("stale_cart");
    expect(provider.addConfirmedItem).not.toHaveBeenCalled();
  });

  it("never accepts a cart reference that is not bound to the session", async () => {
    provider.state.carts.set("cart:other", cart("cart:other", 1));
    const denied = await runtime.boundary.prepare(
      request({
        commerceInputs: {
          variantRef: VARIANT_ID,
          quantity: 1,
          cartRef: "cart:other",
        },
      }),
    );
    expect(denied.envelope.result).toEqual({
      status: "denied",
      safeReasonCode: "CART_REFERENCE_NOT_OWNED",
    });
    expect(provider.getCart).not.toHaveBeenCalled();
  });

  it("confirms an exact checkout handoff but never completes checkout", async () => {
    provider.state.carts.set("cart:fixture:001", cart("cart:fixture:001", 1));
    const checkoutHandoff = handoff("request_checkout_handoff");
    const checkoutSession = { ...session(), cartId: "cart:fixture:001" };
    const prepared = await runtime.boundary.prepare(
      request({
        handoff: checkoutHandoff,
        session: checkoutSession,
        commerceInputs: { variantRef: VARIANT_ID, quantity: 1 },
      }),
    );
    expect(prepared.envelope.result.receipt.action).toBe(
      "request_checkout_handoff",
    );
    const result = await runtime.boundary.confirm(
      confirmationRequest(prepared, "accept", {
        handoff: checkoutHandoff,
        session: checkoutSession,
      }),
    );
    expect(result.envelope.result.status).toBe("succeeded_authoritative");
    expect(provider.createCheckoutHandoff).toHaveBeenCalledOnce();
    expect(
      provider.createCheckoutHandoff.mock.calls[0][0].idempotencyKey,
    ).toMatch(/^commerce:v1:[a-f0-9]{64}$/);
  });

  it("denies checkout handoff when fresh cart reads are unavailable", async () => {
    provider.state.carts.set("cart:fixture:001", cart("cart:fixture:001", 1));
    provider.capabilities.cartGet = false;
    const denied = await runtime.boundary.prepare(
      request({
        handoff: handoff("request_checkout_handoff"),
        session: { ...session(), cartId: "cart:fixture:001" },
        commerceInputs: { variantRef: VARIANT_ID, quantity: 1 },
      }),
    );
    expect(denied.envelope.result).toEqual({
      status: "denied",
      safeReasonCode: "CART_CAPABILITY_UNAVAILABLE",
    });
    expect(provider.getCart).not.toHaveBeenCalled();
  });

  it("allows only one concurrent consumer of a single-use confirmation", async () => {
    const prepared = await runtime.boundary.prepare(request());
    const [left, right] = await Promise.all([
      runtime.boundary.confirm(confirmationRequest(prepared, "accept")),
      runtime.boundary.confirm(confirmationRequest(prepared, "accept")),
    ]);
    expect(
      [left.envelope.result.status, right.envelope.result.status].sort(),
    ).toEqual(["denied", "succeeded_authoritative"]);
    expect(provider.addConfirmedItem).toHaveBeenCalledOnce();
  });

  it("reconciles an ambiguous applied mutation without retrying it", async () => {
    provider.behavior = "apply_then_timeout";
    provider.state.carts.set("cart:fixture:001", cart("cart:fixture:001", 1));
    const baseRequest = request({
      session: { ...session(), cartId: "cart:fixture:001" },
      commerceInputs: {
        variantRef: VARIANT_ID,
        quantity: 1,
        cartRef: "cart:fixture:001",
      },
    });
    const prepared = await runtime.boundary.prepare(baseRequest);
    const result = await runtime.boundary.confirm(
      confirmationRequest(prepared, "accept", {
        session: baseRequest.session,
      }),
    );
    expect(result.envelope.result.status).toBe("succeeded_authoritative");
    expect(result.reconciliationStatus).toBe("succeeded");
    expect(provider.addConfirmedItem).toHaveBeenCalledOnce();
  });

  it("returns outcome_unknown only after reconciliation was attempted", async () => {
    provider.behavior = "timeout_and_unreadable";
    provider.state.carts.set("cart:fixture:001", cart("cart:fixture:001", 1));
    const baseRequest = request({
      session: { ...session(), cartId: "cart:fixture:001" },
      commerceInputs: {
        variantRef: VARIANT_ID,
        quantity: 1,
        cartRef: "cart:fixture:001",
      },
    });
    const prepared = await runtime.boundary.prepare(baseRequest);
    const result = await runtime.boundary.confirm(
      confirmationRequest(prepared, "accept", { session: baseRequest.session }),
    );
    expect(result.envelope.result).toMatchObject({
      status: "outcome_unknown",
      recovery: "reconcile",
    });
    expect(result.reconciliationStatus).toBe("unknown");
    expect(result.outcomeEvent.outcome).toBe("mutation_unknown");
    expect(provider.addConfirmedItem).toHaveBeenCalledOnce();
  });

  it("never exposes mutation tools to a language model", async () => {
    const registry = createToolRegistry({
      commerceProvider: provider,
      knowledgeService: { searchKnowledge: vi.fn().mockResolvedValue([]) },
    });
    const names = registry.listModelTools().map((tool) => tool.name);
    expect(names).not.toContain("update_cart");
    expect(names).not.toContain("create_checkout_handoff");
    await expect(
      registry.executeModelTool(
        "update_cart",
        { productId: PRODUCT_ID, variantId: VARIANT_ID, quantity: 1 },
        { context: context(), session: session() },
      ),
    ).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
  });

  function request(overrides = {}) {
    return {
      context: context(),
      merchantConfig: merchantConfig(),
      session: overrides.session || session(),
      handoff: overrides.handoff || handoff(),
      commerceInputs: overrides.commerceInputs || {
        variantRef: VARIANT_ID,
        quantity: 2,
      },
    };
  }

  function confirmationRequest(prepared, decision, overrides = {}) {
    return {
      context: context(),
      merchantConfig: merchantConfig(),
      session: overrides.session || session(),
      handoff: overrides.handoff || handoff(),
      confirmation: {
        confirmationId: prepared.envelope.result.receipt.confirmationId,
        decision,
      },
    };
  }
});

function createRuntime({ provider = createDeterministicProvider(), clock }) {
  const confirmationService = createCommerceConfirmationService({
    store: createInMemoryCommerceConfirmationStore(),
    now: clock.now,
  });
  const mutationCoordinator = createCommerceMutationCoordinator({
    store: createInMemoryCommerceMutationStore(),
    now: clock.now,
  });
  const authority = createCommerceAuthority({ provider, now: clock.now });
  return {
    provider,
    boundary: createCommerceBoundary({
      provider,
      now: clock.now,
      confirmationService,
      mutationCoordinator,
      authority,
    }),
  };
}

function createDeterministicProvider() {
  const state = {
    product: {
      id: PRODUCT_ID,
      title: "Fixture product",
      available: true,
      variants: [
        {
          id: VARIANT_ID,
          title: "50 ml",
          available: true,
          quantityAvailable: 20,
          unitPrice: { amountMinor: 4999, currency: "EUR" },
        },
      ],
    },
    carts: new Map(),
    idempotency: new Map(),
  };
  const provider = {
    id: "deterministic-shopify",
    behavior: "success",
    state,
    capabilities: {
      catalogSearch: true,
      catalogLookup: true,
      productGet: true,
      policies: true,
      cartCreate: true,
      cartGet: true,
      cartUpdate: true,
      checkoutCreate: false,
      checkoutGet: false,
      checkoutUpdate: false,
      checkoutComplete: false,
    },
    initialize: vi.fn(async function () {
      return { capabilities: provider.capabilities };
    }),
    searchCatalog: vi.fn(),
    lookupCatalog: vi.fn(),
    getProduct: vi.fn(async () => ({
      product: structuredClone(state.product),
    })),
    searchPolicies: vi.fn(),
    getCart: vi.fn(async ({ cartId }) => {
      if (provider.behavior === "timeout_and_unreadable_after_mutation") {
        throw Object.assign(new Error("read timeout"), { code: "TIMEOUT" });
      }
      const value = state.carts.get(cartId) || null;
      return {
        cartId,
        cart: value ? structuredClone(value) : null,
        cartVersion: value ? String(value.version) : null,
        continueUrl: value?.continue_url || null,
      };
    }),
    addConfirmedItem: vi.fn(
      async ({ cartId, variantId, quantity, idempotencyKey }) => {
        if (state.idempotency.has(idempotencyKey)) {
          return structuredClone(state.idempotency.get(idempotencyKey));
        }
        const id = cartId || "cart:fixture:new";
        const current = state.carts.get(id) || cart(id, 0);
        const existing = current.line_items.find(
          (line) => line.item.id === variantId,
        );
        if (existing) existing.quantity += quantity;
        else current.line_items.push({ item: { id: variantId }, quantity });
        current.version += 1;
        state.carts.set(id, current);
        const result = {
          cartId: id,
          cart: structuredClone(current),
          continueUrl: current.continue_url,
        };
        state.idempotency.set(idempotencyKey, result);
        if (provider.behavior === "apply_then_timeout") {
          throw Object.assign(new Error("ambiguous timeout"), {
            code: "TIMEOUT",
          });
        }
        if (provider.behavior === "timeout_and_unreadable") {
          provider.behavior = "timeout_and_unreadable_after_mutation";
          throw Object.assign(new Error("ambiguous timeout"), {
            code: "TIMEOUT",
          });
        }
        return structuredClone(result);
      },
    ),
    createCheckoutHandoff: vi.fn(async ({ cartId }) => ({
      cartId,
      checkoutUrl: state.carts.get(cartId)?.continue_url || null,
    })),
  };
  return provider;
}

function handoff(action = "request_cart_add") {
  return {
    kind: "CommerceIntentHandoff",
    version: "1.1",
    handoffId: "handoff:fixture:001",
    decisionId: "decision:fixture:001",
    stateRevision: 7,
    correlationId: "correlation:fixture:001",
    causationId: "action:cart:001",
    issuedAt: "2026-08-08T12:00:00.000Z",
    expiresAt: "2026-08-08T12:05:00.000Z",
    selectedProductRef: {
      kind: "ProductReference",
      version: "0.1-candidate",
      productId: PRODUCT_ID,
      sourceRef: "catalog:fixture:001",
    },
    selectedOptionPreferences: [
      { optionName: "Format", preferredValue: "50 ml" },
    ],
    shopperActionIntent: action,
    marketRef: "market:fr-eur",
    evidenceSnapshotRefs: ["snapshot:fixture:001"],
    unresolvedCommerceInputs: ["variant", "quantity", "availability"],
  };
}

function context() {
  return {
    shopId: "shop:fixture:001",
    shopDomain: "fixture.myshopify.com",
    requestId: "request:fixture:001",
    visitorId: "visitor:fixture:001",
  };
}

function session() {
  return {
    id: "session:fixture:001",
    version: 7,
    cartId: null,
    checkoutUrl: null,
    buyerContext: {},
    selectedVariantId: null,
    quantity: 1,
  };
}

function merchantConfig() {
  return {
    experiments: { killSwitch: false },
  };
}

function cart(id, version) {
  return {
    id,
    version,
    line_items: [],
    continue_url: `https://fixture.myshopify.com/cart/c/${id.replace(/:/g, "-")}`,
  };
}

function createClock(initial) {
  let value = new Date(initial);
  return {
    now: () => new Date(value),
    advance: (milliseconds) => {
      value = new Date(value.getTime() + milliseconds);
    },
    set: (next) => {
      value = new Date(next);
    },
  };
}
