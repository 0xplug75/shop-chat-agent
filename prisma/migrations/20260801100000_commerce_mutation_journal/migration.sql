-- Durable idempotency journal for Shopify commerce mutations. The application
-- stores only redacted request/result projections in this table.
CREATE TABLE "CommerceMutation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "commerceSessionId" TEXT NOT NULL,
    "confirmationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "result" JSONB,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommerceMutation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommerceMutation_state_check" CHECK (
        "state" IN (
            'side_effect_requested',
            'side_effect_started',
            'side_effect_confirmed',
            'side_effect_unknown',
            'side_effect_failed'
        )
    )
);

CREATE UNIQUE INDEX "CommerceMutation_shopId_idempotencyKey_key"
    ON "CommerceMutation"("shopId", "idempotencyKey");
CREATE UNIQUE INDEX "CommerceMutation_shopId_confirmationId_operation_key"
    ON "CommerceMutation"("shopId", "confirmationId", "operation");
CREATE INDEX "CommerceMutation_shopId_state_updatedAt_idx"
    ON "CommerceMutation"("shopId", "state", "updatedAt");
CREATE INDEX "CommerceMutation_commerceSessionId_createdAt_idx"
    ON "CommerceMutation"("commerceSessionId", "createdAt");

ALTER TABLE "CommerceMutation"
    ADD CONSTRAINT "CommerceMutation_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommerceMutation"
    ADD CONSTRAINT "CommerceMutation_commerceSessionId_fkey"
    FOREIGN KEY ("commerceSessionId") REFERENCES "CommerceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
