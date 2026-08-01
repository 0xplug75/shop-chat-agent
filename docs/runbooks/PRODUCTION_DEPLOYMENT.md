# Production deployment and rollback runbook

This runbook is an approval checklist, not authorization to mutate Railway,
Shopify, or Supabase. Execute it first in preview with an isolated database and
development store.

## Release inputs

- Immutable reviewed Git commit and candidate tag.
- Passing CI for tests, lint, typecheck, build, Prisma validation, and
  deterministic E2E.
- Approved environment inventory from
  `docs/execution/ENVIRONMENT_VARIABLES.md`.
- Database backup with a recorded restore test owner.
- One approved primary LLM provider; fallback disabled until a second provider
  is independently validated.
- Authorized Shopify development stores and test products/variants.

## Pre-deployment gates

1. Confirm the worktree is clean and record `git rev-parse HEAD`.
2. Confirm `shopify.app.toml`, Railway service domain, OAuth callback, Customer
   Account callback, and App Proxy URL share the intended stable HTTPS origin.
3. Confirm no tracked executable file contains `trycloudflare.com`.
4. Confirm production `TOKEN_ENCRYPTION_KEY` continuity. Losing it invalidates
   persisted Shopify sessions.
5. Create and verify a PostgreSQL backup before migration.
6. Inspect unresolved `CommerceMutation` rows. Resolve every
   `side_effect_unknown` before changing commerce code or rolling back.
7. Run:

   ```bash
   npm ci
   npm test
   npm run lint
   npm run typecheck
   npm run build
   npm run db:generate
   npm run test:e2e:deterministic
   ```

8. Review `npm audit --omit=dev`. Record an explicit decision for every high or
   critical advisory.

## Preview database

Use an isolated PostgreSQL database only. Set both `DATABASE_URL` and
`TEST_DATABASE_URL` to that exact test database before integration tests.

1. Check migration history:

   ```bash
   npx prisma migrate status
   ```

2. Review the three migration and rollback pairs under `prisma/migrations/`.
3. Apply migrations:

   ```bash
   npm run migrate:deploy
   ```

4. Execute the PostgreSQL suite:

   ```bash
   npm run test:integration
   ```

5. Verify tenant isolation, configuration optimistic locking, recovery,
   experiment exposure uniqueness, shared rate limiting, and knowledge search.

Local proof from 2026-08-01: all 11 migrations, 113 tests, and all 3 candidate
rollback files passed against a disposable PostgreSQL 16 container. This does
not replace preview backup, migration, and restore evidence.

## Preview application deployment

1. Deploy the exact reviewed commit. Railway uses `Dockerfile` and executes
   `npm run migrate:deploy` as its pre-deploy command.
2. Record the Railway deployment ID and commit SHA.
3. Verify non-mutating endpoints:

   ```bash
   curl --fail --silent --show-error https://APP_HOST/health
   curl --fail --silent --show-error https://APP_HOST/health/db
   curl --fail --silent --show-error https://APP_HOST/ucp/agent-profile
   ```

4. Confirm logs are structured and carry request IDs without tokens, prompts,
   cookies, or checkout URLs.
5. Confirm the UCP profile advertises only configured capabilities. Checkout
   completion must remain absent.
6. Run one non-commerce LLM smoke request. Record provider, model, latency,
   usage, and status, never the key or full merchant prompt.

## Shopify configuration and release

The local Shopify CLI must be repaired before this step. Its current executable
references a missing Node binary.

1. Verify the selected Shopify app configuration file and stable URLs.
2. Review the requested scopes. Do not broaden scopes without product need.
3. Deploy/release the application configuration and Theme App Extension through
   the approved Shopify workflow.
4. Install or reinstall on the authorized development store.
5. Verify the signed App Proxy bootstrap and the short shop/origin/visitor-bound
   token from the storefront. App Proxy POSTs must carry it in the JSON body,
   never in the URL; direct backend requests use a bearer header.
6. Run `docs/runbooks/SHOPIFY_E2E.md` on desktop and mobile.
7. Repeat the isolation checks on a second development store.

## Production rollout

1. Keep UCP checkout, contextual launcher, and the launcher experiment off for
   the initial production deployment.
2. Deploy the exact preview-approved commit and migrations.
3. Verify health and database readiness before accepting traffic.
4. Verify one installed merchant can open the five admin pages and save a
   harmless configuration field.
5. Verify catalog search and policy reads before enabling cart actions.
6. Enable UCP cart for one internal merchant. Confirm exact selection and
   duplicate-submission idempotence.
7. Enable session recovery only after the consent and restore UX is reviewed.
8. Enable the launcher experiment only after exposure and outcome queries are
   observable.

## Rollback strategy

### Preferred application rollback

Roll back the application to the previous known commit while leaving the three
additive database migrations in place. The migrations retain legacy merchant
columns and are intended to permit a rolling application rollback.

1. Disable merchant feature flags and the experiment kill switch first.
2. Stop new commerce mutations if any `side_effect_unknown` record exists.
3. Roll Railway back to the previous immutable image/commit.
4. Verify `/health`, `/health/db`, admin authentication, and catalog read.
5. Do not automatically retry unknown cart or checkout operations.

### Database rollback

Database rollback is a last resort and requires a maintenance window, backup,
and explicit data-loss approval.

- `20260801120000_agentic_shopping_core/rollback.sql` removes settings,
  experiments, recovery, attribution, and shared rate limits.
- `20260801100000_commerce_mutation_journal/rollback.sql` removes idempotency
  evidence; reconcile all mutations first.
- `20260801090000_secure_expiring_offline_sessions/rollback.sql` removes
  refresh metadata and can force every affected shop to reauthorize.

Run rollback SQL manually in strict reverse order only after the old
application is active and the consequences above are accepted. A restore from
the pre-migration backup is safer when schema and data must both be reverted.

## Post-deployment evidence

Record in the release ticket:

- Git commit and tag;
- Railway deployment ID and region;
- migration status;
- health/readiness timestamps;
- Shopify app configuration/release version;
- two dev-store test results;
- LLM smoke provider/model/status;
- feature flags enabled per shop;
- unresolved mutation count;
- alert and rollback owner.

Do not call the release production-ready until every item has an observed
result.
