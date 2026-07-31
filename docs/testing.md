# Verification guide

## Fast local checks

```bash
npm run db:generate
npm run db:validate
npm run typecheck
npm run lint
npm test
npm run build
```

`npm test` runs unit and contract tests with Prisma mocked at service boundaries.
It covers signed widget credentials, origin and URL validation, encryption,
bounded payloads, tenant-scoped queries, configuration, state transitions,
constraint merging, intent fallback, confirmation, tool validation, cart
binding, knowledge calls, OAuth one-shot state, and webhook idempotency.

## PostgreSQL integration

Use a disposable database with all migrations applied. The test will remain
skipped unless `TEST_DATABASE_URL` is set and exactly equals `DATABASE_URL`.

```bash
docker compose -f infra/docker-compose.postgres.yml up -d
export DATABASE_URL=postgresql://intentcart:intentcart@localhost:5433/intentcart
export DIRECT_URL="$DATABASE_URL"
npm run migrate:deploy
TEST_DATABASE_URL="$DATABASE_URL" npm run test:integration
```

The integration suite creates two temporary shops, verifies cross-shop commerce
session denial, verifies PostgreSQL FTS knowledge isolation, and deletes both
shops through cascade cleanup.

## Theme extension and live Shopify checks

Automated unit tests cannot prove Shopify App Proxy signatures, Customer Account
OAuth, live MCP tool names, inventory behavior, or Theme Editor installation.
After configuring a development store, run:

```bash
npm run dev
```

Then verify manually:

1. Embedded routes load through Shopify Admin authentication.
2. The Theme App Extension activates without changing the existing appearance.
3. `/apps/intentcart/bootstrap` returns configuration and a short-lived token.
4. A forged direct `/chat` request without a token returns 401.
5. Discover returns no more than three live Shopify products.
6. Compare uses only returned product facts.
7. Cart mutation is not attempted before exact confirmation.
8. Confirmed variant and quantity update the same Shopify cart.
9. Checkout URL belongs to the current canonical/custom storefront.
10. Customer authorization completes once and token status becomes authorized.
11. Duplicate webhook delivery returns success without repeating side effects.

## Current expected result

Without a running PostgreSQL test database, unit tests pass and PostgreSQL
integration tests are reported as skipped. This is intentional, not equivalent
to a successful migration application.

The architecture validation run on 2026-07-31 applied all seven migrations to
PostgreSQL 16 and passed all four database integration tests. The disposable
container was stopped afterward without deleting its local volume.
