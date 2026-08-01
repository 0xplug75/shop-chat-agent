-- Persist the complete merchant configuration while retaining legacy columns
-- for rolling deployments.
ALTER TABLE "MerchantConfig"
    ADD COLUMN "settings" JSONB;

ALTER TABLE "Message"
    ADD COLUMN "provider" TEXT,
    ADD COLUMN "costMicros" BIGINT;

CREATE TABLE "ExperimentAssignment" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "experimentKey" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "exposedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperimentAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExperimentAssignment_shopId_visitorId_experimentKey_key"
    ON "ExperimentAssignment"("shopId", "visitorId", "experimentKey");
CREATE INDEX "ExperimentAssignment_shopId_experimentKey_variant_idx"
    ON "ExperimentAssignment"("shopId", "experimentKey", "variant");

ALTER TABLE "ExperimentAssignment"
    ADD CONSTRAINT "ExperimentAssignment_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommerceSession"
    ADD COLUMN "recoveryState" JSONB,
    ADD COLUMN "experimentAssignmentId" TEXT,
    ADD COLUMN "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "CommerceSession_shopId_visitorId_lastActivityAt_idx"
    ON "CommerceSession"("shopId", "visitorId", "lastActivityAt");
CREATE INDEX "CommerceSession_experimentAssignmentId_idx"
    ON "CommerceSession"("experimentAssignmentId");

ALTER TABLE "CommerceSession"
    ADD CONSTRAINT "CommerceSession_experimentAssignmentId_fkey"
    FOREIGN KEY ("experimentAssignmentId") REFERENCES "ExperimentAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommerceEvent"
    ADD COLUMN "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
    ADD COLUMN "experimentKey" TEXT,
    ADD COLUMN "experimentVariant" TEXT;

CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RateLimitBucket_shopId_keyHash_windowStart_key"
    ON "RateLimitBucket"("shopId", "keyHash", "windowStart");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

ALTER TABLE "RateLimitBucket"
    ADD CONSTRAINT "RateLimitBucket_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
