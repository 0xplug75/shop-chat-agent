-- Persist expiring Shopify offline token rotation metadata. Token values are
-- encrypted by the application before they enter these text columns.
ALTER TABLE "Session"
    ALTER COLUMN "accessToken" TYPE TEXT,
    ADD COLUMN "refreshToken" TEXT,
    ADD COLUMN "refreshTokenExpires" TIMESTAMP(3),
    ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "refreshLeaseId" TEXT,
    ADD COLUMN "refreshLeaseExpires" TIMESTAMP(3),
    ADD COLUMN "lastRefreshAt" TIMESTAMP(3),
    ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE INDEX "Session_refreshLeaseExpires_idx"
    ON "Session"("refreshLeaseExpires");
