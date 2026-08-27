import { describe, expect, it, vi } from "vitest";
import { merchantDefaults } from "../app/merchant/merchant.defaults";
import {
  createCommerceMutationCoordinator,
  createInMemoryCommerceMutationStore,
} from "../app/services/commerce-mutation.server";
import { createCommerceAuthority } from "../app/services/commerce/commerce-authority.server";
import { createCommerceBoundary } from "../app/services/commerce/commerce-boundary.server";
import {
  createCommerceConfirmationService,
  createInMemoryCommerceConfirmationStore,
} from "../app/services/commerce/commerce-confirmation.server";
import { createFixtureProvider } from "../app/services/commerce/fixture-provider.server";
import {
  createCanonicalExperienceIngressPort,
  createCommerceBoundaryPort,
  createNonLiveFixtureCatalogPort,
  createNonLiveFixtureDecisionPort,
  getNonLiveFixtureProducts,
} from "../app/services/sage-integration/non-live-adapters.server";
import { createSageProjectionPort } from "../app/services/sage-integration/projection.server";
import {
  SageProtocolValidationError,
  validateCommerceResultEnvelope,
} from "../app/services/sage-integration/protocol/1.0.0-rc.1.server";
import { createSageIntegrationRuntime } from "../app/services/sage-integration/runtime.server";

const BASE_TIME = new Date("2026-08-08T12:00:00.000Z");

describe("product-owned Sage integration runtime", () => {
  it("runs intent to authoritative cart result through all owner boundaries", async () => {
    const harness = createHarness();
    let session = baseSession();
    const intent = await harness.runtime.submitIntent({
      context: context(),
      session,
      shopperRequest: { text: "I need the best local fixture option" },
    });
    expect(intent.mode).toBe("fixture_non_live");
    expect(intent.live).toBe(false);
    expect(intent.decision.recommendations.products).toHaveLength(2);
    expect(JSON.stringify(intent.projection)).not.toMatch(
      /"(?:score|fit|confidence)"/i,
    );
    session = applyPatch(session, intent.sessionPatch);

    const cartAction = intent.decision.allowedNextActions.find(
      (action) => action.actionType === "request_cart_add",
    );
    const prepared = await harness.runtime.submitAction({
      context: context(),
      merchantConfig: merchantConfig(),
      session,
      action: {
        kind: "ExperienceActionRequest",
        version: "1.0",
        decisionId: intent.decision.decisionId,
        stateRevision: session.version,
        actionId: cartAction.actionId,
        actionType: cartAction.actionType,
        arguments: { handoffRef: cartAction.targetRef },
      },
      commerceInputs: {
        variantRef: "variant:fixture:001",
        quantity: 1,
      },
    });
    expect(prepared.commerceResult.result.status).toBe("confirmation_required");
    expect(harness.carts.size).toBe(0);

    const completed = await harness.runtime.confirmCommerce({
      context: context(),
      merchantConfig: merchantConfig(),
      session,
      handoff: prepared.handoff,
      confirmation: {
        confirmationId: prepared.commerceResult.result.receipt.confirmationId,
        decision: "accept",
      },
    });
    expect(validateCommerceResultEnvelope(completed.commerceResult)).toBe(
      completed.commerceResult,
    );
    expect(completed.commerceResult.result.status).toBe(
      "succeeded_authoritative",
    );
    expect(completed.commerceOutcome.outcome).toBe("mutation_succeeded");
    expect(completed.projection.commerceStatus).toBe("succeeded_authoritative");
    expect(harness.carts.size).toBe(1);
    expect(harness.observability).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "sage_commerce_outcome" }),
    );
  });

  it("rejects stale, forbidden, and retargeted Experience actions", async () => {
    const harness = createHarness();
    let session = baseSession();
    const intent = await harness.runtime.submitIntent({
      context: context(),
      session,
      shopperRequest: { text: "Find an option" },
    });
    session = applyPatch(session, intent.sessionPatch);
    const selection = intent.decision.allowedNextActions.find(
      (action) => action.actionType === "select_product",
    );
    const action = {
      kind: "ExperienceActionRequest",
      version: "1.0",
      decisionId: intent.decision.decisionId,
      stateRevision: session.version,
      actionId: selection.actionId,
      actionType: selection.actionType,
      arguments: { productRef: selection.targetRef },
    };

    await expect(
      harness.runtime.submitAction({
        context: context(),
        merchantConfig: merchantConfig(),
        session,
        action: { ...action, stateRevision: action.stateRevision - 1 },
      }),
    ).rejects.toMatchObject({ code: "STALE_STATE_REVISION" });
    await expect(
      harness.runtime.submitAction({
        context: context(),
        merchantConfig: merchantConfig(),
        session,
        action: { ...action, actionId: "action:forbidden" },
      }),
    ).rejects.toMatchObject({ code: "ACTION_NOT_ALLOWED" });
    await expect(
      harness.runtime.submitAction({
        context: context(),
        merchantConfig: merchantConfig(),
        session,
        action: {
          ...action,
          arguments: { productRef: "product:fixture:002" },
        },
      }),
    ).rejects.toMatchObject({ code: "ACTION_TARGET_MISMATCH" });
  });

  it("rejects expired handoffs, tampering, and confirmation reuse", async () => {
    const clock = createClock(BASE_TIME);
    const harness = createHarness({ clock });
    let session = baseSession();
    const intent = await harness.runtime.submitIntent({
      context: context(),
      session,
      shopperRequest: { text: "Find an option" },
    });
    session = applyPatch(session, intent.sessionPatch);
    const action = commerceAction(intent.decision, session.version);
    const prepared = await harness.runtime.submitAction({
      context: context(),
      merchantConfig: merchantConfig(),
      session,
      action,
      commerceInputs: {
        variantRef: "variant:fixture:001",
        quantity: 1,
      },
    });

    const tampered = structuredClone(prepared.handoff);
    tampered.selectedProductRef = {
      ...tampered.selectedProductRef,
      productId: "product:fixture:002",
    };
    await expect(
      harness.runtime.confirmCommerce({
        context: context(),
        merchantConfig: merchantConfig(),
        session,
        handoff: tampered,
        confirmation: {
          confirmationId: prepared.commerceResult.result.receipt.confirmationId,
          decision: "accept",
        },
      }),
    ).rejects.toMatchObject({ code: "COMMERCE_HANDOFF_NOT_AUTHORIZED" });

    const first = await harness.runtime.confirmCommerce({
      context: context(),
      merchantConfig: merchantConfig(),
      session,
      handoff: prepared.handoff,
      confirmation: {
        confirmationId: prepared.commerceResult.result.receipt.confirmationId,
        decision: "accept",
      },
    });
    const reused = await harness.runtime.confirmCommerce({
      context: context(),
      merchantConfig: merchantConfig(),
      session,
      handoff: prepared.handoff,
      confirmation: {
        confirmationId: prepared.commerceResult.result.receipt.confirmationId,
        decision: "accept",
      },
    });
    expect(first.commerceResult.result.status).toBe("succeeded_authoritative");
    expect(reused.commerceResult.result).toEqual({
      status: "denied",
      safeReasonCode: "CONFIRMATION_NOT_USABLE",
    });
    expect(harness.carts.size).toBe(1);

    const freshHarness = createHarness({ clock });
    let freshSession = baseSession();
    const freshIntent = await freshHarness.runtime.submitIntent({
      context: context(),
      session: freshSession,
      shopperRequest: { text: "Find an option" },
    });
    freshSession = applyPatch(freshSession, freshIntent.sessionPatch);
    const freshPrepared = await freshHarness.runtime.submitAction({
      context: context(),
      merchantConfig: merchantConfig(),
      session: freshSession,
      action: commerceAction(freshIntent.decision, freshSession.version),
      commerceInputs: {
        variantRef: "variant:fixture:001",
        quantity: 1,
      },
    });
    clock.advance(5 * 60 * 1000);
    await expect(
      freshHarness.runtime.confirmCommerce({
        context: context(),
        merchantConfig: merchantConfig(),
        session: freshSession,
        handoff: freshPrepared.handoff,
        confirmation: {
          confirmationId:
            freshPrepared.commerceResult.result.receipt.confirmationId,
          decision: "accept",
        },
      }),
    ).rejects.toBeInstanceOf(SageProtocolValidationError);
  });
});

function createHarness({ clock = createClock(BASE_TIME) } = {}) {
  const products = getNonLiveFixtureProducts();
  const carts = new Map();
  const provider = createFixtureProvider({
    products: products.map((product) => ({
      id: product.reference.productId,
      productId: product.reference.productId,
      title: product.title,
      available: true,
      variants: product.variants,
    })),
    carts,
  });
  const boundary = createCommerceBoundary({
    provider,
    now: clock.now,
    authority: createCommerceAuthority({ provider, now: clock.now }),
    confirmationService: createCommerceConfirmationService({
      store: createInMemoryCommerceConfirmationStore(),
      now: clock.now,
    }),
    mutationCoordinator: createCommerceMutationCoordinator({
      store: createInMemoryCommerceMutationStore(),
      now: clock.now,
    }),
  });
  const observability = vi.fn().mockResolvedValue(undefined);
  return {
    carts,
    observability,
    runtime: createSageIntegrationRuntime({
      now: clock.now,
      ports: {
        catalog: createNonLiveFixtureCatalogPort({ products }),
        decision: createNonLiveFixtureDecisionPort({
          idFactory: (prefix) => `${prefix}:fixture:runtime`,
        }),
        experience: createCanonicalExperienceIngressPort(),
        commerce: createCommerceBoundaryPort(boundary),
        projection: createSageProjectionPort(),
        observability: { record: observability },
      },
    }),
  };
}

function commerceAction(decision, stateRevision) {
  const allowed = decision.allowedNextActions.find(
    (action) => action.actionType === "request_cart_add",
  );
  return {
    kind: "ExperienceActionRequest",
    version: "1.0",
    decisionId: decision.decisionId,
    stateRevision,
    actionId: allowed.actionId,
    actionType: allowed.actionType,
    arguments: { handoffRef: allowed.targetRef },
  };
}

function applyPatch(session, patch) {
  return {
    ...session,
    ...patch,
    version: session.version + 1,
  };
}

function baseSession() {
  return {
    id: "session:fixture:001",
    shopId: "shop:fixture:001",
    conversationId: "conversation:fixture:001",
    visitorId: "visitor:fixture:001",
    version: 6,
    buyerContext: {},
    cartId: null,
  };
}

function context() {
  return Object.freeze({
    shopId: "shop:fixture:001",
    shopDomain: "fixture.myshopify.com",
    visitorId: "visitor:fixture:001",
    requestId: "request:fixture:001",
  });
}

function merchantConfig() {
  return structuredClone(merchantDefaults);
}

function createClock(initial) {
  let value = new Date(initial);
  return {
    now: () => new Date(value),
    advance: (milliseconds) => {
      value = new Date(value.getTime() + milliseconds);
    },
  };
}
