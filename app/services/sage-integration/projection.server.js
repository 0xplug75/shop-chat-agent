import {
  validateCommerceResultEnvelope,
  validateDecisionExperienceInput,
} from "./protocol/1.0.0-rc.1.server";

const MESSAGE_BY_STATUS = Object.freeze({
  denied: "This action is not available.",
  confirmation_required: "Confirm the exact product, variant, and quantity.",
  confirmation_declined: "The cart was not changed.",
  confirmation_expired: "This confirmation expired. Please review it again.",
  stale_state: "The recommendations changed. Please review the latest options.",
  stale_cart: "The cart changed. Please review it before continuing.",
  invalid_variant: "That variant is no longer valid.",
  invalid_quantity: "That quantity is not valid.",
  price_changed: "The price changed. Please review the current price.",
  unavailable: "That option is currently unavailable.",
  failed_before_mutation: "Shopify could not start this action.",
  outcome_unknown:
    "Shopify is reconciling this action. Do not submit it again.",
  succeeded_authoritative: "Shopify confirmed the commerce action.",
});

export function createSageProjectionPort() {
  return Object.freeze({
    fromDecision({ decision, catalog, mode }) {
      validateDecisionExperienceInput(decision);
      const productByRef = new Map(
        catalog.products.map((product) => [
          product.reference.productId,
          product,
        ]),
      );
      const recommendations = (decision.recommendations?.products || []).map(
        (item) => {
          const product = productByRef.get(item.productRef);
          return compact({
            productRef: item.productRef,
            title: product?.title,
            imageUrl: product?.imageUrl,
            canonicalUrl: product?.canonicalUrl,
            needMatched: item.needMatched,
            whyCodes: item.whyCodes,
            tradeoffs: item.tradeoffs,
            limits: item.limits,
            provenanceRefs: item.provenanceRefs,
          });
        },
      );
      return assertShopperSafe({
        kind: "SageExperienceProjection",
        version: "1.0",
        protocolVersion: "1.0.0-rc.1",
        mode,
        state: decision.decisionType,
        decisionId: decision.decisionId,
        stateRevision: decision.stateRevision,
        messageIntent: decision.messageIntent,
        recommendations,
        actions: decision.allowedNextActions,
        disclosures: decision.disclosures,
      });
    },

    fromAction({ action, decision, previous }) {
      return assertShopperSafe({
        ...previous,
        state: action.actionType,
        decisionId: decision.decisionId,
        stateRevision: decision.stateRevision,
        selectedProductRef:
          action.arguments.productRef || previous?.selectedProductRef,
        lastActionId: action.actionId,
      });
    },

    fromCommerce({ envelope, previous }) {
      validateCommerceResultEnvelope(envelope);
      const result = envelope.result;
      const receipt = result.receipt;
      return assertShopperSafe(
        compact({
          ...previous,
          state:
            result.status === "confirmation_required"
              ? "confirmation"
              : result.status === "succeeded_authoritative"
                ? "cart"
                : "commerce_result",
          commerceStatus: result.status,
          message: MESSAGE_BY_STATUS[result.status],
          confirmation: receipt
            ? {
                confirmationId: receipt.confirmationId,
                expiresAt: receipt.expiresAt,
                singleUse: receipt.singleUse,
                productRef: receipt.candidate.productRef.productId,
                variantRef: receipt.candidate.variantRef,
                quantity: receipt.candidate.quantity,
                unitPrice: receipt.candidate.unitPrice,
              }
            : undefined,
          currentUnitPrice: result.currentUnitPrice,
          retryAllowed: false,
        }),
      );
    },
  });
}

export function assertShopperSafe(value) {
  walk(value, []);
  return value;
}

function walk(value, path) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/(^|_)(score|fit|confidence)(_|$)/i.test(key)) {
      throw new Error(
        `Shopper projection exposes uncalibrated ${[...path, key].join(".")}`,
      );
    }
    if (
      /(token|secret|authorization|cookie|providerPayload|mutationRef)/i.test(
        key,
      )
    ) {
      throw new Error(
        `Shopper projection exposes private ${[...path, key].join(".")}`,
      );
    }
    walk(item, [...path, key]);
  }
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}
