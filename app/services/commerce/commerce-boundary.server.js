import {
  CommerceMutationError,
  createCommerceMutationCoordinator,
} from "../commerce-mutation.server";
import { createCommerceAuthority } from "./commerce-authority.server";
import { createCommerceConfirmationService } from "./commerce-confirmation.server";
import { createCommercePermissionService } from "./commerce-permission.server";
import {
  createArgumentDigest,
  createCommerceResultEnvelope,
  reduceCommerceOutcome,
  SageProtocolValidationError,
  validateCommerceIntentHandoff,
} from "./sage-protocol.server";

export function createCommerceBoundary({
  provider,
  now = () => new Date(),
  permissionService = createCommercePermissionService({ now }),
  confirmationService = createCommerceConfirmationService({ now }),
  mutationCoordinator = createCommerceMutationCoordinator({ now }),
  authority = createCommerceAuthority({ provider, now }),
} = {}) {
  if (!provider) throw new Error("Commerce provider is required");

  return {
    async prepare({
      context,
      merchantConfig,
      session,
      handoff,
      commerceInputs,
    }) {
      const validation = validateHandoffOrResult({ handoff, session, now });
      if (validation) return finish(handoff, validation, now);

      const discovery = await provider.initialize();
      const permission = await permissionService.check({
        context,
        merchantConfig,
        handoff,
        session,
        capabilities: discovery.capabilities || provider.capabilities,
      });
      if (!permission.allowed) {
        return finish(
          handoff,
          { status: "denied", safeReasonCode: permission.safeReasonCode },
          now,
        );
      }
      if (commerceInputs.cartRef && commerceInputs.cartRef !== session.cartId) {
        return finish(
          handoff,
          { status: "denied", safeReasonCode: "CART_REFERENCE_NOT_OWNED" },
          now,
        );
      }

      let revalidation;
      try {
        revalidation = await authority.revalidate({
          handoff,
          variantRef: commerceInputs.variantRef,
          quantity: commerceInputs.quantity,
          cartRef: session.cartId || undefined,
          buyerContext: session.buyerContext,
        });
      } catch (error) {
        return finish(
          handoff,
          {
            status: "failed_before_mutation",
            safeReasonCode: safeReasonCode(error),
          },
          now,
        );
      }
      if (revalidation.status !== "valid") {
        return finish(handoff, protocolRevalidationResult(revalidation), now);
      }

      const receipt = await confirmationService.issue({
        context,
        session,
        handoff,
        permission,
        candidate: revalidation.candidate,
        commerceSnapshotRef: revalidation.commerceSnapshotRef,
        cartRef: revalidation.cartRef,
        cartVersion: revalidation.cartVersion,
      });
      return finish(handoff, { status: "confirmation_required", receipt }, now);
    },

    async confirm({ context, merchantConfig, session, handoff, confirmation }) {
      const validation = validateHandoffOrResult({ handoff, session, now });
      if (validation) return finish(handoff, validation, now);

      const discovery = await provider.initialize();
      const permission = await permissionService.check({
        context,
        merchantConfig,
        handoff,
        session,
        capabilities: discovery.capabilities || provider.capabilities,
      });
      if (!permission.allowed) {
        return finish(
          handoff,
          { status: "denied", safeReasonCode: permission.safeReasonCode },
          now,
        );
      }

      const decision = await confirmationService.decide({
        context,
        session,
        handoff,
        confirmationId: confirmation.confirmationId,
        decision: confirmation.decision,
      });
      if (decision.status === "declined") {
        return finish(handoff, { status: "confirmation_declined" }, now);
      }
      if (decision.status === "expired") {
        return finish(handoff, { status: "confirmation_expired" }, now);
      }
      if (decision.status === "missing" || decision.status === "reused") {
        return finish(
          handoff,
          { status: "denied", safeReasonCode: "CONFIRMATION_NOT_USABLE" },
          now,
        );
      }
      const receipt = decision.receipt;
      const receiptFailure = validateReceipt({
        receipt,
        handoff,
        permission,
      });
      if (receiptFailure) return finish(handoff, receiptFailure, now);

      let revalidation;
      try {
        revalidation = await authority.revalidate({
          handoff,
          variantRef: receipt.candidate.variantRef,
          quantity: receipt.candidate.quantity,
          cartRef: receipt.cartRef || session.cartId || undefined,
          buyerContext: session.buyerContext,
        });
      } catch (error) {
        return finish(
          handoff,
          {
            status: "failed_before_mutation",
            safeReasonCode: safeReasonCode(error),
          },
          now,
        );
      }
      if (revalidation.status !== "valid") {
        return finish(handoff, protocolRevalidationResult(revalidation), now);
      }
      if (
        receipt.cartVersion &&
        receipt.cartVersion !== revalidation.cartVersion
      ) {
        return finish(
          handoff,
          compact({
            status: "stale_cart",
            currentCartVersion: revalidation.cartVersion,
          }),
          now,
        );
      }
      if (
        !sameMoney(
          receipt.candidate.unitPrice,
          revalidation.candidate.unitPrice,
        )
      ) {
        return finish(
          handoff,
          {
            status: "price_changed",
            currentUnitPrice: revalidation.candidate.unitPrice,
          },
          now,
        );
      }

      try {
        const mutation = await mutationCoordinator.execute({
          context,
          commerceSessionId: session.id,
          confirmationId: receipt.confirmationId,
          operation: handoff.shopperActionIntent,
          request: {
            handoffId: handoff.handoffId,
            correlationId: handoff.correlationId,
            stateRevision: handoff.stateRevision,
            action: handoff.shopperActionIntent,
            argumentDigest: receipt.argumentDigest,
            candidate: receipt.candidate,
            commerceSnapshotRef: revalidation.commerceSnapshotRef,
            cartRef: receipt.cartRef || session.cartId || null,
            cartVersion: revalidation.cartVersion || null,
            baselineQuantity: revalidation.baselineQuantity,
          },
          perform: ({ idempotencyKey }) =>
            authority.mutateAndVerify({
              action: handoff.shopperActionIntent,
              receipt,
              session,
              idempotencyKey,
              buyerContext: session.buyerContext,
              baselineQuantity: revalidation.baselineQuantity,
            }),
        });
        return successfulResult({ handoff, mutation, receipt, session, now });
      } catch (error) {
        if (!(error instanceof CommerceMutationError)) {
          return finish(
            handoff,
            {
              status: "failed_before_mutation",
              safeReasonCode: safeReasonCode(error),
            },
            now,
          );
        }
        if (
          ![
            "SIDE_EFFECT_UNKNOWN",
            "SIDE_EFFECT_IN_PROGRESS",
            "SIDE_EFFECT_RESULT_NOT_PERSISTED",
          ].includes(error.code)
        ) {
          return finish(
            handoff,
            {
              status: "failed_before_mutation",
              safeReasonCode: safeReasonCode(error.cause || error),
            },
            now,
          );
        }
        const mutationRef = error.mutation?.id;
        if (!mutationRef) {
          return finish(
            handoff,
            {
              status: "failed_before_mutation",
              safeReasonCode: "MUTATION_REFERENCE_UNAVAILABLE",
            },
            now,
          );
        }

        const reconciliation = await mutationCoordinator.reconcile({
          context,
          mutationRef,
          verify: () =>
            authority.reconcile({
              action: handoff.shopperActionIntent,
              receipt,
              session,
              baselineQuantity: revalidation.baselineQuantity,
            }),
        });
        if (reconciliation.status === "succeeded") {
          return successfulResult({
            handoff,
            mutation: reconciliation,
            receipt,
            session,
            now,
            reconciliationStatus: "succeeded",
          });
        }
        if (reconciliation.status === "not_applied") {
          return finish(
            handoff,
            {
              status: "failed_before_mutation",
              safeReasonCode: "RECONCILED_NOT_APPLIED",
            },
            now,
            { reconciliationStatus: "not_applied" },
          );
        }
        return finish(
          handoff,
          {
            status: "outcome_unknown",
            mutationRef,
            recovery: "reconcile",
          },
          now,
          { reconciliationStatus: "unknown" },
        );
      }
    },
  };
}

function validateHandoffOrResult({ handoff, session, now }) {
  try {
    validateCommerceIntentHandoff(handoff, {
      now: now(),
      expectedStateRevision: session.version,
    });
    return null;
  } catch (error) {
    if (error instanceof SageProtocolValidationError) {
      if (error.code === "STALE_STATE") {
        return {
          status: "stale_state",
          expectedRevision: session.version,
        };
      }
      return {
        status: "failed_before_mutation",
        safeReasonCode: safeReasonCode(error),
      };
    }
    throw error;
  }
}

function validateReceipt({ receipt, handoff, permission }) {
  if (
    !receipt ||
    receipt.handoffId !== handoff.handoffId ||
    receipt.stateRevision !== handoff.stateRevision ||
    receipt.action !== handoff.shopperActionIntent ||
    receipt.candidate?.productRef?.productId !==
      handoff.selectedProductRef.productId ||
    receipt.candidate?.productRef?.sourceRef !==
      handoff.selectedProductRef.sourceRef ||
    receipt.permissionDecisionId !== permission.permissionDecisionId ||
    receipt.singleUse !== true
  ) {
    return { status: "denied", safeReasonCode: "CONFIRMATION_MISMATCH" };
  }
  const digest = createArgumentDigest(
    compact({
      action: receipt.action,
      candidate: receipt.candidate,
      commerceSnapshotRef: receipt.commerceSnapshotRef,
      cartRef: receipt.cartRef,
      cartVersion: receipt.cartVersion,
      stateRevision: receipt.stateRevision,
    }),
  );
  if (digest !== receipt.argumentDigest) {
    return {
      status: "denied",
      safeReasonCode: "CONFIRMATION_ARGUMENT_DIGEST_INVALID",
    };
  }
  return null;
}

function protocolRevalidationResult(revalidation) {
  if (revalidation.status === "stale_cart") {
    return compact({
      status: "stale_cart",
      currentCartVersion: revalidation.currentCartVersion,
    });
  }
  return compact({
    status: revalidation.status,
    safeReasonCode: revalidation.safeReasonCode,
  });
}

function successfulResult({
  handoff,
  mutation,
  receipt,
  session,
  now,
  reconciliationStatus,
}) {
  const authoritative = mutation.result;
  const result = compact({
    status: "succeeded_authoritative",
    mutationRef: mutation.mutation.id,
    commerceStateRef: authoritative.commerceStateRef,
    cartVersion: authoritative.cartVersion,
    authorityRef: authoritative.authorityRef,
    observedAt: authoritative.observedAt,
  });
  const sessionPatch = {
    journeyStage:
      handoff.shopperActionIntent === "request_checkout_handoff"
        ? "CHECKOUT"
        : "CART",
    selectedProductId: handoff.selectedProductRef.productId,
    selectedVariantId: receipt.candidate.variantRef,
    quantity: receipt.candidate.quantity,
    cartId: authoritative.cartId || session.cartId,
    checkoutUrl:
      authoritative.checkoutUrl ||
      authoritative.continueUrl ||
      session.checkoutUrl,
    buyerContext: {
      ...session.buyerContext,
      cartSnapshot: authoritative.cart,
      cartVersion: authoritative.cartVersion,
    },
  };
  return finish(handoff, result, now, {
    sessionPatch,
    reconciliationStatus,
  });
}

function finish(handoff, result, now, metadata = {}) {
  const envelope = createCommerceResultEnvelope(handoff, result, {
    now: now(),
  });
  const outcomeEvent = reduceCommerceOutcome(envelope, { now: now() });
  return {
    envelope,
    outcomeEvent,
    ...compact(metadata),
  };
}

function sameMoney(left, right) {
  return (
    left?.amountMinor === right?.amountMinor &&
    left?.currency === right?.currency
  );
}

function safeReasonCode(error) {
  return String(error?.code || "COMMERCE_BOUNDARY_FAILED")
    .replace(/[^A-Z0-9_.:-]/gi, "_")
    .slice(0, 128);
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, item]) => item !== undefined && item !== null,
    ),
  );
}
