-- Manual rollback for review only. Do not run while expiring offline tokens are
-- active: dropping refresh metadata requires every affected shop to reinstall.
DROP INDEX IF EXISTS "Session_refreshLeaseExpires_idx";

ALTER TABLE "Session"
    DROP COLUMN IF EXISTS "refreshToken",
    DROP COLUMN IF EXISTS "refreshTokenExpires",
    DROP COLUMN IF EXISTS "tokenVersion",
    DROP COLUMN IF EXISTS "refreshLeaseId",
    DROP COLUMN IF EXISTS "refreshLeaseExpires",
    DROP COLUMN IF EXISTS "lastRefreshAt",
    DROP COLUMN IF EXISTS "revokedAt";
