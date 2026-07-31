# Railway and Supabase runbook

This is a preparation guide. No Railway service, Supabase project, remote
migration, Shopify release, or deployment was created during the architecture
work.

## Intended production topology

```text
Shopify Admin / Storefront
        |
        v
Railway web service (Node 20, React Router, SSE, webhooks)
        |
        v
Supabase PostgreSQL (same or nearest practical region)
```

Only the `web` service exists now. A future `worker` can reuse service contracts
for asynchronous compliance, indexing, or lifecycle jobs without moving web
request logic into a second implementation.

## Supabase preparation

1. Create a dedicated project and choose a region close to the Railway service.
2. Generate a unique database password in a password manager.
3. Copy connection strings from the Supabase **Connect** panel.
4. Set `DATABASE_URL` to the Supavisor session pooler on port `5432` for the
   persistent Railway container when direct IPv6 connectivity is unavailable.
5. Set `DIRECT_URL` to the direct endpoint on port `5432` for migrations when
   Railway can reach it. If the direct endpoint is unreachable from an IPv4-only
   environment, use the session pooler for migrations. Do not use transaction
   mode on port `6543` for Prisma migrations.
6. Apply migrations first to a disposable staging database.

Supabase documents direct connections for migrations and long-lived backends,
session pooling for persistent IPv4 clients, and transaction pooling for
serverless clients: <https://supabase.com/docs/guides/database/connecting-to-postgres>.
Its Prisma guide is at <https://supabase.com/docs/guides/database/prisma>.

Example shapes only, never commit real values:

```env
DATABASE_URL=postgresql://USER.PROJECT_REF:PASSWORD@REGION.pooler.supabase.com:5432/postgres
DIRECT_URL=postgresql://USER:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres
```

Before any remote migration:

```bash
npm ci
npm run db:generate
npm run db:validate
npm test
npm run typecheck
npm run lint
npm run build
```

Then, against staging only:

```bash
npm run migrate:deploy
TEST_DATABASE_URL="$DATABASE_URL" npm run test:integration
```

The integration command deliberately runs only when `TEST_DATABASE_URL` exactly
matches `DATABASE_URL`, reducing the chance of accidentally targeting another
database.

## RLS posture

RLS is a future defense in depth, not the primary tenant boundary. Prisma
services already include `shopId` in sensitive reads and writes. Do not enable a
policy that depends on a connection-global variable while using a pooler.

Before enabling RLS:

1. Create a runtime role that does not have `BYPASSRLS`.
2. Wrap each request transaction in a transaction-local tenant setting.
3. Add and test policies for every merchant-owned table.
4. Keep migration credentials separate from runtime credentials.
5. Run the two-shop integration suite through the same pooler mode used by web.

The Shopify widget must never receive any Supabase key or database URL.

## Railway preparation

`railway.json` selects the root `Dockerfile`, executes
`npm run migrate:deploy` as a pre-deploy command, configures `/health`, and gives
the process 30 seconds to drain. Railway runs pre-deploy commands after build and
before the new application starts; a failed command blocks the deployment:
<https://docs.railway.com/deployments/pre-deploy-command>.

Railway configuration:

| Setting | Value |
|---|---|
| Builder | Dockerfile |
| Start | Dockerfile `CMD` (`react-router-serve`) |
| Pre-deploy | `npm run migrate:deploy` |
| Healthcheck | `/health` |
| Health timeout | 300 seconds |
| Restart | On failure, maximum 3 retries |
| Region | Nearest practical region to Supabase |

Railway injects `PORT`; React Router Serve reads it. Railway requires an HTTP 200
from the configured endpoint before activating a deployment:
<https://docs.railway.com/deployments/healthchecks>.

Use `/health` for deployment liveness. `/health/db` is an explicit database
readiness diagnostic and returns 503 when PostgreSQL is unavailable. Do not use
the database endpoint as a continuous public monitor without access controls and
alerting policy.

## Required environment variables

Populate values from `.env.example` in Railway. Required production categories:

- Application: `NODE_ENV`, `APP_URL`, `SHOPIFY_APP_URL`, `PORT`.
- Shopify: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`.
- Database: `DATABASE_URL`, `DIRECT_URL`.
- LLM: `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `LLM_TIMEOUT_MS`.
- Customer OAuth: `REDIRECT_URL`, `OAUTH_STATE_TTL_SECONDS`.
- Encryption: `TOKEN_ENCRYPTION_KEY`.
- Widget: `WIDGET_SIGNING_SECRET`, token/rate-limit/origin settings.
- Commerce: `COMMERCE_SESSION_TTL_SECONDS`.
- Logs: `LOG_LEVEL`.

Generate independent secrets of at least 32 bytes for token encryption and
widget signing. Rotating `TOKEN_ENCRYPTION_KEY` requires a token re-encryption or
forced customer reauthorization plan. Rotating `WIDGET_SIGNING_SECRET` invalidates
existing short-lived widget tokens, which is acceptable.

## Shopify configuration after a production URL exists

Update the production Shopify app configuration before releasing a version:

- `application_url`
- OAuth redirect URLs
- Customer Account redirect URI
- webhook URI `/api/webhooks`
- App Proxy destination `/widget`
- App Proxy prefix/subpath

The configured scopes include `write_app_proxy`. Shopify allows merchants to
customize an App Proxy prefix and subpath, so verify the storefront path after
installation: <https://shopify.dev/docs/apps/build/online-store/app-proxies>.

Do not place a changing development tunnel in production Theme Editor settings.

## SSE and runtime notes

- Keep the web service awake in production because Shopify webhooks and shopper
  chat require immediate receipt.
- Preserve `text/event-stream`, `X-Accel-Buffering: no`, and no-cache headers.
- Keep provider and MCP timeouts lower than the platform request timeout.
- The in-memory rate limiter assumes one process. Use Redis before scaling to
  multiple replicas.
- The Node process is PID 1 in the runtime image. React Router Serve handles
  `SIGTERM`/`SIGINT` and closes its HTTP server.
- No persistent Railway volume is required; PostgreSQL owns durable state.

## Deployment checklist (future, do not run implicitly)

1. Back up the target database and verify the restore path.
2. Run all local checks and staging integration tests.
3. Review Prisma migration SQL.
4. Set production variables in Railway.
5. Validate Shopify URLs and scopes in a non-production app configuration.
6. Trigger the Railway deployment manually or through the approved CI path.
7. Confirm `/health`, then `/health/db`.
8. Test embedded admin authentication.
9. Test signed App Proxy bootstrap and SSE chat.
10. Test discover, compare, confirm, cart, and checkout on a development store.
11. Send duplicate webhook fixtures and verify idempotent responses.
12. Monitor logs by `requestId` without exposing tokens or checkout URLs.

## Rollback

Application rollback can redeploy a prior Railway image. Database rollback must
not use `prisma migrate reset` in production. Use expand-contract migrations so
the prior and new application versions can overlap. The first SQLite-to-Postgres
cutover is a data migration event and requires its own backup, validation, and
rollback window as described in `docs/data/sqlite-to-postgres.md`.
