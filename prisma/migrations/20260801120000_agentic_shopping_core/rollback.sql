-- Manual rollback for review only. This removes merchant settings, experiment
-- assignments, recovery state, shared rate-limit counters, and event
-- attribution. Export any required operational data before running it.
ALTER TABLE "CommerceSession"
    DROP CONSTRAINT IF EXISTS "CommerceSession_experimentAssignmentId_fkey";

DROP INDEX IF EXISTS "CommerceSession_experimentAssignmentId_idx";
DROP INDEX IF EXISTS "CommerceSession_shopId_visitorId_lastActivityAt_idx";

ALTER TABLE "CommerceSession"
    DROP COLUMN IF EXISTS "experimentAssignmentId",
    DROP COLUMN IF EXISTS "recoveryState",
    DROP COLUMN IF EXISTS "lastActivityAt";

ALTER TABLE "CommerceEvent"
    DROP COLUMN IF EXISTS "experimentVariant",
    DROP COLUMN IF EXISTS "experimentKey",
    DROP COLUMN IF EXISTS "schemaVersion";

DROP TABLE IF EXISTS "RateLimitBucket";
DROP TABLE IF EXISTS "ExperimentAssignment";

ALTER TABLE "Message"
    DROP COLUMN IF EXISTS "costMicros",
    DROP COLUMN IF EXISTS "provider";

ALTER TABLE "MerchantConfig"
    DROP COLUMN IF EXISTS "settings";
