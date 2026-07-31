# Architecture implementation report

Validation date: 2026-07-31.

This report closes the architecture-hardening mission. It complements:

- `docs/architecture-audit.md` for the pre-hardening system;
- `docs/architecture-target.md` for the implemented topology and diagrams;
- `docs/deployment/railway-supabase.md` for future deployment;
- `docs/data/sqlite-to-postgres.md` for the data cutover;
- `docs/testing.md` for repeatable verification.

## Delivered foundation

- Shopify Admin session authentication and one App Bridge navigation owner.
- Signed Shopify App Proxy bootstrap plus short-lived storefront credentials.
- Central `MerchantRequestContext`, canonical shop-domain checks, restrictive
  CORS, request limits, timeouts, neutral errors, structured redacted logs, and
  a replaceable rate-limiter interface.
- PostgreSQL Prisma schema with tenant-owned records, JSONB state, constraints,
  indexes, full-text search, optimistic locking, encrypted customer tokens,
  one-shot OAuth state, and idempotent webhook receipts.
- Per-shop merchant configuration, conversation, commerce-session, knowledge,
  analytics-event, and shop-lifecycle services.
- Structured multilingual intent, explicit commerce state machine, one typed
  tool registry, provider-independent LLM gateway, and one orchestration path.
- Railway manifest, multi-stage Node 20 image, liveness/readiness routes, local
  PostgreSQL Compose service, expiration command, and runbooks.

## Architecture implementation surface

The following files are the architecture and security implementation surface
created or changed for this mission. The worktree already contained unrelated
dashboard/widget visual changes; those files were preserved and are not claimed
as part of this architecture pass.

### Configuration and runtime

```text
.dockerignore
.env.example
Dockerfile
package.json
package-lock.json
railway.json
shopify.app.toml
shopify.web.toml
vitest.config.js
```

### Database and operations

```text
infra/docker-compose.postgres.yml
prisma/schema.prisma
prisma/migrations/migration_lock.toml
prisma/migrations/20240530213853_create_session_table/migration.sql
prisma/migrations/20250501044923_add_customer_tokens_table/migration.sql
prisma/migrations/20250502141909_add_code_verifier_table/migration.sql
prisma/migrations/20250508000001_add_conversation_tables/migration.sql
prisma/migrations/20251010121648_add_customer_account_urls_table/migration.sql
prisma/migrations/20260721120000_add_shop_id_to_conversation/migration.sql
prisma/migrations/20260731090000_postgres_multitenant_foundation/migration.sql
scripts/expire-commerce-sessions.mjs
```

### Server boundaries and services

```text
app/auth.server.js
app/contracts/commerce.schemas.server.js
app/db.server.js
app/entry.server.jsx
app/lib/cors.server.js
app/lib/fetch-with-timeout.server.js
app/lib/logger.server.js
app/mcp-client.js
app/merchant/dashboard.server.js
app/merchant/merchant.schema.js
app/merchant/merchant.server.js
app/merchant/public-config.server.js
app/security/app-proxy-context.server.js
app/security/encryption.server.js
app/security/merchant-context.server.js
app/security/rate-limit.server.js
app/security/shopify-domain.server.js
app/security/widget-token.server.js
app/services/analytics-event.server.js
app/services/business-message-interpreter.server.js
app/services/cart-adapter.server.js
app/services/catalog-adapter.server.js
app/services/chat-request.server.js
app/services/checkout-adapter.server.js
app/services/claude.server.js
app/services/commerce-orchestrator.server.js
app/services/commerce-session.server.js
app/services/conversation.server.js
app/services/customer-account-discovery.server.js
app/services/customer-account-urls.server.js
app/services/customer-token.server.js
app/services/intent-router.server.js
app/services/knowledge.server.js
app/services/llm-gateway.server.js
app/services/oauth-state.server.js
app/services/policy-adapter.server.js
app/services/shop.server.js
app/services/streaming.server.js
app/services/tool-registry.server.js
app/services/tool.server.js
app/services/webhook.server.js
app/shopify.server.js
```

### Authenticated and public routes

```text
app/routes/api.webhooks.jsx
app/routes/app.jsx
app/routes/app._index.jsx
app/routes/app.assistant.jsx
app/routes/app.commerce.jsx
app/routes/app.knowledge.jsx
app/routes/app.widget.jsx
app/routes/customer-auth.callback.jsx
app/routes/auth.token-status.jsx
app/routes/chat.jsx
app/routes/health.db.jsx
app/routes/health.jsx
app/routes/merchant.config.jsx
app/routes/widget.auth.token-status.jsx
app/routes/widget.bootstrap.jsx
app/routes/widget.chat.jsx
```

### Storefront security bridge

```text
extensions/chat-bubble/assets/chat.js
extensions/chat-bubble/blocks/chat-interface.liquid
```

### Verification and documentation

```text
README.md
docs/Architecture.md
docs/MerchantConsole.md
docs/PROJECT_STATE.md
docs/architecture-audit.md
docs/architecture-target.md
docs/data/sqlite-to-postgres.md
docs/deployment/railway-supabase.md
docs/implementation-report.md
docs/testing.md
tests/commerce-session.test.js
tests/contracts-and-streams.test.js
tests/intent-and-adapters.test.js
tests/oauth-and-webhooks.test.js
tests/postgres.integration.test.js
tests/security.test.js
tests/setup.js
tests/tool-registry.test.js
```

## Validation results

```text
Prisma schema validation          PASS
Prisma client generation          PASS (6.19.3)
Seven migrations on PostgreSQL 16 PASS
PostgreSQL integration tests      PASS (4/4)
Unit and contract tests           PASS (35/35; DB suite gated when DB absent)
ESLint                            PASS
TypeScript / route typegen        PASS
React Router production build     PASS
Docker production image build     PASS
Container /health                 PASS
Container /health/db              PASS
Railway manifest keys             PASS against current public JSON schema
```

The repository-wide Prettier check reports 86 pre-existing or mixed-provenance
files. They were not rewritten because doing so would create unrelated visual
and documentation churn.

The production npm audit has no critical vulnerability. It reports four package
entries caused by one React Router RSC-mode advisory. IntentCart does not enable
RSC, and no fixed compatible release exists at validation time. The development
toolchain still reports high-severity transitive advisories in legacy lint and
Shopify code-generation dependencies; it is excluded from the pruned runtime
image and should be upgraded in a separate tooling change.

## Manual work still required

1. Create Supabase and Railway resources in approved regions.
2. Set real secrets only in platform secret stores.
3. Apply migrations to a disposable remote staging database, then run the
   integration suite against that exact database.
4. Update production Shopify URLs, OAuth redirects, webhook URI, and App Proxy.
5. Test embedded Admin authentication and every App Bridge route in a real
   development store.
6. Test signed App Proxy bootstrap, live Storefront MCP, Customer Account OAuth,
   cart mutation after confirmation, and Shopify checkout handoff.
7. Define the operational response for `customers/data_request` and the formal
   retention/deletion policy.
8. Add Redis-backed rate limiting before horizontal scaling.
9. Reassess the React Router RSC advisory before production deployment.

No remote migration, Supabase/Railway resource creation, Shopify release,
deployment, or commit was performed. No real secret was added. The architecture
pass did not redesign the dashboard or widget and did not touch Intent Card Demo.
