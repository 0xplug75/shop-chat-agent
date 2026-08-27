-- Exact, expiring and single-use shopper confirmations for Commerce handoffs.
CREATE TABLE "CommerceConfirmation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "commerceSessionId" TEXT NOT NULL,
    "handoffId" TEXT NOT NULL,
    "permissionDecisionId" TEXT NOT NULL,
    "stateRevision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "argumentDigest" TEXT NOT NULL,
    "receipt" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceConfirmation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommerceConfirmation_status_check" CHECK (
        "status" IN ('pending', 'declined', 'expired', 'consumed')
    ),
    CONSTRAINT "CommerceConfirmation_action_check" CHECK (
        "action" IN ('request_cart_add', 'request_checkout_handoff')
    )
);

CREATE UNIQUE INDEX "CommerceConfirmation_shopId_handoffId_key"
    ON "CommerceConfirmation"("shopId", "handoffId");
CREATE INDEX "CommerceConfirmation_shopId_status_expiresAt_idx"
    ON "CommerceConfirmation"("shopId", "status", "expiresAt");
CREATE INDEX "CommerceConfirmation_commerceSessionId_createdAt_idx"
    ON "CommerceConfirmation"("commerceSessionId", "createdAt");

ALTER TABLE "CommerceConfirmation"
    ADD CONSTRAINT "CommerceConfirmation_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceConfirmation"
    ADD CONSTRAINT "CommerceConfirmation_commerceSessionId_fkey"
    FOREIGN KEY ("commerceSessionId") REFERENCES "CommerceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
