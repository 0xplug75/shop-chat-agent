import { createHash } from "node:crypto";

const MUTATING_ACTIONS = new Set([
  "request_cart_add",
  "request_checkout_handoff",
]);

export function createCommercePermissionService({
  now = () => new Date(),
} = {}) {
  return {
    async check({ context, merchantConfig, handoff, session, capabilities }) {
      const checkedAt = now().toISOString();
      const permissionDecisionId = createPermissionDecisionId({
        shopId: context?.shopId,
        handoffId: handoff?.handoffId,
        stateRevision: handoff?.stateRevision,
      });

      if (!context?.shopId || session?.shopId === "") {
        return denied("MERCHANT_CONTEXT_REQUIRED");
      }
      if (merchantConfig?.experiments?.killSwitch) {
        return denied("COMMERCE_KILL_SWITCH_ACTIVE");
      }
      if (!MUTATING_ACTIONS.has(handoff.shopperActionIntent)) {
        return denied("ACTION_NOT_EXECUTABLE_IN_V1");
      }
      if (handoff.shopperActionIntent === "request_cart_add") {
        const canCreate = Boolean(capabilities?.cartCreate);
        const canUpdate = Boolean(capabilities?.cartUpdate);
        const canRead = Boolean(capabilities?.cartGet);
        if (!canRead || (session?.cartId ? !canUpdate : !canCreate)) {
          return denied("CART_CAPABILITY_UNAVAILABLE");
        }
      }
      if (
        handoff.shopperActionIntent === "request_checkout_handoff" &&
        !session?.cartId
      ) {
        return denied("CART_REQUIRED_FOR_CHECKOUT_HANDOFF");
      }
      if (
        handoff.shopperActionIntent === "request_checkout_handoff" &&
        !capabilities?.cartGet
      ) {
        return denied("CART_CAPABILITY_UNAVAILABLE");
      }

      return {
        allowed: true,
        requiresConfirmation: true,
        permissionDecisionId,
        checkedAt,
        policyVersion: "commerce-permission:1",
      };

      function denied(safeReasonCode) {
        return {
          allowed: false,
          requiresConfirmation: false,
          permissionDecisionId,
          safeReasonCode,
          checkedAt,
          policyVersion: "commerce-permission:1",
        };
      }
    },
  };
}

function createPermissionDecisionId({ shopId, handoffId, stateRevision }) {
  const digest = createHash("sha256")
    .update(`${shopId || "unknown"}:${handoffId || "unknown"}:${stateRevision}`)
    .digest("hex")
    .slice(0, 32);
  return `permission:${digest}`;
}
