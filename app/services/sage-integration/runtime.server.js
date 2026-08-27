import {
  COMMERCE_HANDOFF_TTL_MS,
  resolveProductReferenceWire,
  SAGE_INTERLAB_PROTOCOL_VERSION,
  SageProtocolValidationError,
  validateCommerceIntentHandoff,
  validateDecisionExperienceInput,
} from "./protocol/1.0.0-rc.1.server";
import { createSageIntegrationPorts } from "./ports.server";

const COMMERCE_ACTIONS = new Set([
  "request_cart_add",
  "request_checkout_handoff",
]);

export class SageIntegrationError extends Error {
  constructor(code, message, { status = 400 } = {}) {
    super(message);
    this.name = "SageIntegrationError";
    this.code = code;
    this.status = status;
    this.publicMessage =
      "The Sage experience is unavailable or no longer current.";
  }
}

export function createSageIntegrationRuntime({
  ports: suppliedPorts,
  now = () => new Date(),
} = {}) {
  const ports = createSageIntegrationPorts(suppliedPorts);

  return Object.freeze({
    async submitIntent({ context, session, shopperRequest }) {
      assertContextAndSession(context, session);
      const intentText = normalizeIntentText(shopperRequest?.text);
      const catalog = await ports.catalog.search({
        context,
        session,
        shopperRequest: { text: intentText },
      });
      validateCatalogResult(catalog, context);
      const stateRevision = session.version + 1;
      const decision = await ports.decision.decide({
        context,
        session,
        shopperRequest: { text: intentText },
        catalog,
        stateRevision,
      });
      validateDecisionExperienceInput(decision);
      if (decision.stateRevision !== stateRevision) {
        throw new SageIntegrationError(
          "DECISION_REVISION_INVALID",
          "Decision revision does not match the persistence boundary",
          { status: 409 },
        );
      }
      assertDecisionCatalogScope(decision, catalog);
      const projection = ports.projection.fromDecision({
        decision,
        catalog,
        mode: catalog.mode,
      });
      const integrationState = buildIntegrationState({
        decision,
        catalog,
        projection,
        updatedAt: now(),
      });
      await ports.observability.record({
        eventType: "sage_decision_projected",
        context,
        session,
        payload: {
          protocolVersion: SAGE_INTERLAB_PROTOCOL_VERSION,
          mode: catalog.mode,
          resultCount: decision.recommendations?.products?.length || 0,
          stateRevision,
        },
      });
      return {
        decision,
        projection,
        mode: catalog.mode,
        live: catalog.live === true,
        sessionPatch: {
          recommendedProducts: catalog.products,
          buyerContext: {
            ...session.buyerContext,
            sageIntegration: integrationState,
          },
        },
      };
    },

    async submitAction({
      context,
      merchantConfig,
      session,
      action,
      commerceInputs,
    }) {
      assertContextAndSession(context, session);
      const state = requireIntegrationState(session);
      assertActiveDecision(state.decision, session);
      const authorization = ports.experience.authorize({
        action,
        decision: state.decision,
      });

      if (COMMERCE_ACTIONS.has(action.actionType)) {
        const handoff = createCommerceHandoff({
          context,
          state,
          action,
          now: now(),
        });
        const result = await ports.commerce.prepare({
          context,
          merchantConfig,
          session,
          handoff,
          commerceInputs: normalizeCommerceInputs(commerceInputs),
        });
        const projection = ports.projection.fromCommerce({
          envelope: result.envelope,
          previous: state.projection,
        });
        await ports.observability.record({
          eventType: "sage_commerce_prepared",
          context,
          session,
          payload: {
            actionType: action.actionType,
            resultStatus: result.envelope.result.status,
            handoffId: handoff.handoffId,
          },
        });
        return {
          authorization,
          handoff,
          commerceResult: result.envelope,
          commerceOutcome: result.outcomeEvent,
          projection,
          sessionPatch: null,
        };
      }

      const nextRevision = session.version + 1;
      const decision = advanceDecisionRevision(state.decision, nextRevision);
      const projection = ports.projection.fromAction({
        action,
        decision,
        previous: state.projection,
      });
      const nextState = {
        ...state,
        decision,
        projection,
        lastAction: {
          actionId: action.actionId,
          actionType: action.actionType,
        },
        updatedAt: now().toISOString(),
      };
      await ports.observability.record({
        eventType: "sage_experience_action",
        context,
        session,
        payload: {
          actionType: action.actionType,
          stateRevision: nextRevision,
        },
      });
      return {
        authorization,
        projection,
        sessionPatch: {
          buyerContext: {
            ...session.buyerContext,
            sageIntegration: nextState,
          },
        },
      };
    },

    async confirmCommerce({
      context,
      merchantConfig,
      session,
      handoff,
      confirmation,
    }) {
      assertContextAndSession(context, session);
      const state = requireIntegrationState(session);
      assertHandoffAuthorizedByState({ handoff, state, session, now: now() });
      const result = await ports.commerce.confirm({
        context,
        merchantConfig,
        session,
        handoff,
        confirmation,
      });
      const projection = ports.projection.fromCommerce({
        envelope: result.envelope,
        previous: state.projection,
      });
      const commerceState = {
        ...state,
        projection,
        lastCommerceOutcome: {
          resultRef: result.envelope.resultId,
          status: result.envelope.result.status,
          outcome: result.outcomeEvent.outcome,
        },
        updatedAt: now().toISOString(),
      };
      await ports.observability.record({
        eventType: "sage_commerce_outcome",
        context,
        session,
        payload: result.outcomeEvent,
      });
      return {
        commerceResult: result.envelope,
        commerceOutcome: result.outcomeEvent,
        projection,
        reconciliationStatus: result.reconciliationStatus,
        sessionPatch: {
          ...(result.sessionPatch || {}),
          buyerContext: {
            ...(result.sessionPatch?.buyerContext || session.buyerContext),
            sageIntegration: commerceState,
          },
        },
      };
    },

    getProjection({ context, session }) {
      assertContextAndSession(context, session);
      const state = requireIntegrationState(session);
      return {
        protocolVersion: SAGE_INTERLAB_PROTOCOL_VERSION,
        mode: state.mode,
        live: state.live,
        projection: state.projection,
      };
    },
  });
}

function buildIntegrationState({ decision, catalog, projection, updatedAt }) {
  const handoffTargets = {};
  for (const action of decision.allowedNextActions) {
    if (!COMMERCE_ACTIONS.has(action.actionType)) continue;
    const recommendation = decision.recommendations?.products?.find((item) =>
      item.allowedNextActions.includes(action.actionId),
    );
    if (!recommendation) {
      throw new SageIntegrationError(
        "COMMERCE_ACTION_PRODUCT_UNRESOLVED",
        "Commerce action is not linked to a recommended product",
      );
    }
    const product = catalog.products.find(
      (item) => item.reference.productId === recommendation.productRef,
    );
    handoffTargets[action.actionId] = {
      handoffId: action.targetRef,
      productRef: product.reference,
      evidenceSnapshotRefs: recommendation.evidenceRefs,
    };
  }
  return {
    version: "1.0",
    protocolVersion: SAGE_INTERLAB_PROTOCOL_VERSION,
    mode: catalog.mode,
    live: catalog.live === true,
    decision,
    projection,
    catalog: {
      providerId: catalog.providerId,
      sourceRef: catalog.sourceRef,
      marketRef: catalog.marketRef,
    },
    handoffTargets,
    updatedAt: updatedAt.toISOString(),
  };
}

function createCommerceHandoff({ context, state, action, now }) {
  const target = state.handoffTargets[action.actionId];
  if (!target || target.handoffId !== action.arguments.handoffRef) {
    throw new SageIntegrationError(
      "COMMERCE_HANDOFF_NOT_AUTHORIZED",
      "Commerce handoff is not linked to the authorized Experience action",
      { status: 403 },
    );
  }
  resolveProductReferenceWire(target.productRef, {
    shopId: context.shopId,
    providerId: state.catalog.providerId,
    sourceRef: state.catalog.sourceRef,
  });
  const issuedAt = now instanceof Date ? now : new Date(now);
  const handoff = {
    kind: "CommerceIntentHandoff",
    version: "1.1",
    handoffId: target.handoffId,
    decisionId: state.decision.decisionId,
    stateRevision: state.decision.stateRevision,
    correlationId: safeCorrelationId(context.requestId),
    causationId: action.actionId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(
      issuedAt.getTime() + COMMERCE_HANDOFF_TTL_MS,
    ).toISOString(),
    selectedProductRef: target.productRef,
    selectedOptionPreferences: [],
    shopperActionIntent: action.actionType,
    marketRef: state.catalog.marketRef,
    evidenceSnapshotRefs: target.evidenceSnapshotRefs,
    unresolvedCommerceInputs: ["variant", "quantity", "availability"],
  };
  return validateCommerceIntentHandoff(handoff, {
    now: issuedAt,
    expectedStateRevision: state.decision.stateRevision,
  });
}

function assertHandoffAuthorizedByState({ handoff, state, session, now }) {
  validateCommerceIntentHandoff(handoff, {
    now,
    expectedStateRevision: session.version,
  });
  if (
    handoff.decisionId !== state.decision.decisionId ||
    handoff.stateRevision !== state.decision.stateRevision
  ) {
    throw new SageIntegrationError(
      "COMMERCE_HANDOFF_DECISION_MISMATCH",
      "Commerce handoff does not target the active decision",
      { status: 409 },
    );
  }
  const allowance = state.decision.allowedNextActions.find(
    (item) => item.actionId === handoff.causationId,
  );
  const target = state.handoffTargets[handoff.causationId];
  if (
    !allowance ||
    allowance.actionType !== handoff.shopperActionIntent ||
    allowance.targetRef !== handoff.handoffId ||
    !target ||
    target.productRef.productId !== handoff.selectedProductRef.productId ||
    target.productRef.sourceRef !== handoff.selectedProductRef.sourceRef
  ) {
    throw new SageIntegrationError(
      "COMMERCE_HANDOFF_NOT_AUTHORIZED",
      "Commerce handoff differs from the server-owned decision state",
      { status: 403 },
    );
  }
}

function assertActiveDecision(decision, session) {
  validateDecisionExperienceInput(decision);
  if (decision.stateRevision !== session.version) {
    throw new SageProtocolValidationError(
      "STALE_STATE_REVISION",
      "Stored decision does not match the current commerce session",
      { status: 409 },
    );
  }
}

function advanceDecisionRevision(decision, stateRevision) {
  const next = structuredClone(decision);
  next.stateRevision = stateRevision;
  if (next.recommendations) next.recommendations.stateRevision = stateRevision;
  if (next.comparison) next.comparison.stateRevision = stateRevision;
  return validateDecisionExperienceInput(next);
}

function validateCatalogResult(catalog, context) {
  if (
    !catalog ||
    !catalog.providerId ||
    !catalog.sourceRef ||
    !catalog.marketRef ||
    !Array.isArray(catalog.products) ||
    catalog.products.length < 1 ||
    catalog.products.length > 3
  ) {
    throw new SageIntegrationError(
      "CATALOG_RESULT_INVALID",
      "Catalog port returned an invalid result",
      { status: 502 },
    );
  }
  for (const product of catalog.products) {
    resolveProductReferenceWire(product.reference, {
      shopId: context.shopId,
      providerId: catalog.providerId,
      sourceRef: catalog.sourceRef,
    });
  }
  if (catalog.mode === "fixture_non_live" && catalog.live !== false) {
    throw new SageIntegrationError(
      "FIXTURE_LIVE_CLAIM_FORBIDDEN",
      "Fixture catalog cannot be marked live",
      { status: 500 },
    );
  }
}

function assertDecisionCatalogScope(decision, catalog) {
  const productIds = new Set(
    catalog.products.map((product) => product.reference.productId),
  );
  for (const item of decision.recommendations?.products || []) {
    if (!productIds.has(item.productRef)) {
      throw new SageIntegrationError(
        "DECISION_PRODUCT_SCOPE_MISMATCH",
        "Decision references a product outside the catalog result",
        { status: 502 },
      );
    }
  }
}

function requireIntegrationState(session) {
  const state = session.buyerContext?.sageIntegration;
  if (
    !state ||
    state.protocolVersion !== SAGE_INTERLAB_PROTOCOL_VERSION ||
    !state.decision ||
    !state.projection
  ) {
    throw new SageIntegrationError(
      "SAGE_STATE_NOT_FOUND",
      "No active Sage decision exists for this session",
      { status: 404 },
    );
  }
  return state;
}

function normalizeCommerceInputs(value) {
  if (
    !value ||
    typeof value.variantRef !== "string" ||
    !Number.isInteger(value.quantity)
  ) {
    throw new SageIntegrationError(
      "COMMERCE_INPUTS_REQUIRED",
      "Variant and quantity are required before Commerce can prepare confirmation",
    );
  }
  return { variantRef: value.variantRef, quantity: value.quantity };
}

function normalizeIntentText(value) {
  const text = String(value || "")
    .normalize("NFKC")
    .trim();
  if (text.length < 1 || text.length > 2000) {
    throw new SageIntegrationError(
      "SHOPPER_INTENT_INVALID",
      "Shopper intent must contain between 1 and 2000 characters",
    );
  }
  return text;
}

function safeCorrelationId(requestId) {
  const value = `correlation:${String(requestId || "unknown")}`;
  return /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,127}$/.test(value)
    ? value
    : `correlation:${crypto.randomUUID()}`;
}

function assertContextAndSession(context, session) {
  if (!context?.shopId) {
    throw new SageIntegrationError(
      "MERCHANT_CONTEXT_REQUIRED",
      "Authenticated merchant context is required",
      { status: 401 },
    );
  }
  if (!session?.id || !Number.isInteger(session.version)) {
    throw new SageIntegrationError(
      "COMMERCE_SESSION_REQUIRED",
      "A versioned commerce session is required",
      { status: 404 },
    );
  }
}
