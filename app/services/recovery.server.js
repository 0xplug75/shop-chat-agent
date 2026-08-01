import { RecoveryStateSchema } from "../contracts/commerce.schemas.server";

const TERMINAL_STAGES = new Set(["COMPLETED", "ABANDONED", "EXPIRED"]);

export function buildRecoveryState(record, changes = {}, now = new Date()) {
  const merged = { ...record, ...changes };
  const pendingConfirmation = (merged.pendingMessages || []).find(
    (item) => item?.type === "cart_confirmation",
  );
  const hasCandidate = Boolean(
    merged.selectedProductId && merged.selectedVariantId,
  );
  const status = TERMINAL_STAGES.has(merged.journeyStage)
    ? merged.journeyStage === "COMPLETED"
      ? "consumed"
      : "expired"
    : merged.recoveryState?.status === "restored"
      ? "restored"
      : "available";

  return RecoveryStateSchema.parse({
    version: "1.0",
    status,
    intent: merged.structuredIntent || null,
    recommendations: Array.isArray(merged.recommendedProducts)
      ? merged.recommendedProducts.slice(0, 3)
      : [],
    cartCandidate: hasCandidate
      ? {
          version: "1.0",
          productId: merged.selectedProductId,
          variantId: merged.selectedVariantId,
          quantity: Number(merged.quantity || 1),
          confirmationId: pendingConfirmation?.confirmationId || null,
        }
      : null,
    cartId: merged.cartId || null,
    checkoutUrl: merged.checkoutUrl || null,
    savedAt: now.toISOString(),
    expiresAt: new Date(merged.expiresAt).toISOString(),
  });
}

export function canRestoreRecovery(
  record,
  { visitorId, now = new Date() } = {},
) {
  if (!record || !visitorId || record.visitorId !== visitorId) return false;
  if (new Date(record.expiresAt) <= now) return false;
  if (TERMINAL_STAGES.has(record.journeyStage)) return false;
  return ["available", "restored"].includes(record.recoveryState?.status);
}

export function markRecoveryRestored(state, now = new Date()) {
  return RecoveryStateSchema.parse({
    ...state,
    status: "restored",
    savedAt: now.toISOString(),
  });
}
