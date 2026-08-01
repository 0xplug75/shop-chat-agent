# Shopify runtime stabilization report

> Historical snapshot: this report covers the first stabilization pass and is
> superseded by `docs/execution/PRODUCTION_RUN.md` for the current candidate
> status, verification results, and release gates.

Extended validation addendum: the candidate now passes 113 tests with the
PostgreSQL integration suite enabled. All 11 migrations and all 3 candidate
rollbacks were validated on disposable PostgreSQL 16, and the built runtime
passed its three local endpoint smoke checks.

Run completed locally on 2026-08-01. This report compares the result with
`docs/runs/PRE_RUN_BASELINE.md`.

## Decision

**The repository is now a locally tested runtime release candidate, but it is
not deployment-ready yet.** The three runtime P0s have code-level corrections
and tests. The remaining gates are operational: apply the reviewed migrations
to an approved non-production database, run the dev-store journey, align the
Shopify installation with the stable origin, deploy the exact revision, and
verify production health and behavior.

No Railway deployment, Shopify release, remote database migration, paid LLM
request, commit, or push was performed.

## Identity and scope

| Field             | Value                                             |
| ----------------- | ------------------------------------------------- |
| Repository        | `shop-chat-agent`                                 |
| Branch            | `codex/intentcart-admin-freeze`                   |
| Starting HEAD     | `43ae66e4c5b9de4f3bbc74a043701d784febdb8d`        |
| Remote            | `https://github.com/0xplug75/shop-chat-agent.git` |
| Scope             | This repository only                              |
| Product principle | Sage recommends. Shopify transacts.               |

The pre-existing user changes in `docs/PROJECT_STATE.md`, `docs/Vision.md`, and
`docs/Positioning.md` were preserved and were not used as a place to store this
run's implementation.

## P0 comparison

| P0                     | Before                                                                      | Local result                                                                                                                                                  | Remaining external proof                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Offline Shopify tokens | Expiring offline token fields and refresh rotation absent                   | Encrypted storage, rotation fields, refresh lease, atomic compare-and-swap, typed failures, safe invalidation, and seven unit tests                           | Apply the migration to an approved database and complete an install/refresh/revoke test on the dev store                         |
| Live LLM provider      | Anthropic-only path; prior deployed call returned HTTP 400                  | Provider-neutral `execute`/`stream` port, OpenAI, Kimi, Anthropic, deterministic fake provider, capability matrix, normalized failures, and 16 contract tests | Perform one explicitly approved non-commerce completion with the selected production provider, then monitor the deployed service |
| Stale admin origin     | Installed Shopify iframe previously referenced an expired Cloudflare tunnel | One fail-fast URL resolver for development, test, preview, and production; stable HTTPS required outside development                                          | Update/release Shopify configuration and re-open the installed admin app after deployment                                        |

## Work completed

### Offline access tokens

- Replaced plain Prisma session storage with
  `app/services/shopify-session-storage.server.js`.
- Encrypts access and refresh tokens with the existing envelope encryption
  helper before persistence.
- Preserves compatibility with legacy plaintext rows on read and rewrites them
  through the encrypted storage path.
- Refreshes expiring offline sessions within a five-minute window.
- Uses a database lease, token version, and transactional writes so only one
  worker owns a refresh and stale workers cannot overwrite a newer token.
- Treats an expired refresh token, or Shopify's documented definitive
  `401 invalid_request` response requiring an active refresh token, as
  reauthorization-required and invalidates the session without logging
  credentials. Transient and non-definitive responses preserve the encrypted
  token pair and release the refresh lease.
- Enables Shopify's expiring offline-token future flag in
  `app/shopify.server.js`.

### Runtime origins

- Added `app/config/runtime-urls.js` as the canonical resolver.
- Requires `APP_URL` and `SHOPIFY_APP_URL`, when both are present, to identify
  the same origin.
- Rejects credentials, path-bearing app URLs, local hosts, non-HTTPS URLs, and
  `trycloudflare.com` hosts in preview and production.
- Derives admin OAuth, Customer Account OAuth, App Proxy, healthcheck, and
  widget allowlist values from one canonical origin.
- Connected the resolver to Shopify boot, auth, CORS, and Vite configuration.

### LLM provider registry

- Added a strict provider contract with messages, tools, structured output,
  streaming, token usage, timeout, abort, normalized errors, request IDs, and a
  logical idempotency key.
- Added OpenAI, Kimi/Moonshot, Anthropic, and fake adapters.
- Kept all tests independent from paid providers.
- Added `npm run llm:check-config`, which validates local provider selection
  without sending a network request or printing a key.
- Local configuration resolves to Anthropic through the legacy key alias; no
  live completion was sent, so provider availability is not claimed.

### Commerce side-effect barrier

- Added the exact lifecycle `no_side_effect`, `side_effect_requested`,
  `side_effect_started`, `side_effect_confirmed`, `side_effect_unknown`, and
  `side_effect_failed`.
- Added a `CommerceMutation` journal keyed by shop and a SHA-256 logical
  idempotency key.
- A provider fallback is allowed only before a side effect has started.
- A timeout or ambiguous error after start becomes `side_effect_unknown`; it is
  never retried blindly.
- Success is returned only after the provider result has been sanitized,
  bounded, and persisted.
- Repeated confirmed submissions replay the recorded result. A confirmation
  reused for another selection fails as a conflict.
- MCP transports receive the same logical idempotency key in the HTTP header
  and JSON-RPC request identifier.

### Contracts and deterministic E2E

- Added strict versioned Zod schemas for `IntentState`,
  `CatalogSearchRequest`, `PurchaseCandidate`, and `CartSnapshot`.
- Kept `IntentState` as a future component of `CommerceSession`; no lab code was
  imported.
- Added one deterministic end-to-end test from encrypted installation session
  through signed widget bootstrap, clarification, intent, fixture catalog,
  comparison, exact confirmation, one journaled cart mutation, and trusted
  Shopify checkout handoff.

## Local migrations prepared

1. `prisma/migrations/20260801090000_secure_expiring_offline_sessions/`
   adds encrypted token and rotation metadata to `Session`.
2. `prisma/migrations/20260801100000_commerce_mutation_journal/`
   adds the per-shop commerce mutation journal and state constraints.

The extended run adds a third migration,
`20260801120000_agentic_shopping_core`, for merchant settings, experiments,
recovery, events, provider metadata, and shared rate limits. All three candidate
directories include `rollback.sql`. All 11 repository migrations and all 3
candidate rollbacks passed on a disposable local PostgreSQL 16 container. No
migration was applied to Supabase or another remote database, and the container
was removed.

## Verification result

| Command                          | Result        | Evidence or limit                                                          |
| -------------------------------- | ------------- | -------------------------------------------------------------------------- |
| `npm test`                       | PASS          | 113 passed, including 8 PostgreSQL integration tests                       |
| `npm run test:e2e:deterministic` | PASS          | 1 complete fixture journey                                                 |
| `npm run typecheck`              | PASS          | React Router type generation and TypeScript                                |
| `npm run lint`                   | PASS          | ESLint                                                                     |
| `npm run build`                  | PASS          | 344 client and 87 SSR modules; React Router future warnings only           |
| `npm run db:generate`            | PASS          | Prisma Client 6.19.3 generated                                             |
| safe local `npm run db:validate` | PASS          | Validation used local placeholder URLs and made no connection              |
| `npm run llm:check-config`       | PASS          | Provider config resolved; `networkCallPerformed` was `false`               |
| `npm run format:check`           | Known backlog | 49 historical or unrelated files; run-owned files pass targeted formatting |
| PostgreSQL migrations/rollbacks  | PASS LOCAL    | 11 migrations and 3 candidate rollbacks on disposable PostgreSQL 16        |
| Built-runtime smoke              | PASS LOCAL    | `/health`, `/health/db`, and `/ucp/agent-profile` returned HTTP 200        |
| Dev-store E2E                    | NOT RUN       | No new authority or remote mutation was assumed                            |

## Release gates still open

1. Back up and apply all three candidate migrations to an approved preview
   database, then repeat the PostgreSQL integration suite.
2. Back up the production database and verify `TOKEN_ENCRYPTION_KEY` continuity
   before any production migration.
3. Select and test one real LLM provider with a non-commerce smoke request.
4. Deploy the exact reviewed revision to preview, never an uncommitted worktree.
5. Align Shopify application URL, App Proxy URL, admin OAuth callback, and
   Customer Account callback with the stable deployed origin.
6. Reinstall or reauthorize on the development shop and complete the runbook in
   `docs/runbooks/SHOPIFY_E2E.md`.
7. Verify that a repeated confirmation changes the Shopify cart only once and
   that an unknown journal entry is resolved manually rather than retried.
8. Only after those proofs, deploy to production and create a frozen RC tag.

## External state

- Railway: unchanged by this run. `/health` and `/health/db` returned HTTP 200,
  while `/ucp/agent-profile` returned HTTP 404. The exact deployed commit is
  unknown; `4f92c75257074a3e28ec3c0301043c93bf614933` remains historical evidence
  only.
- Shopify: no app configuration, extension release, installation, or cart was
  changed.
- Supabase: no schema or data mutation was performed.
- LLM providers: no paid or remote completion was sent.
- Git: no commit or push was created.
