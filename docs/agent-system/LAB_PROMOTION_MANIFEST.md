# Lab Promotion Manifest

## Principle

IntentCart is the Shopify distribution boundary and production-runtime
candidate. Promotion means keeping proven security and commerce primitives,
adapting conflicting storefront ownership, and connecting future Sage Core
contracts through narrow ports. It does not mean copying theme code into the
core or rebuilding the app in another framework.

## Current Decisions

| Asset | Decision | Destination | Condition |
|---|---|---|---|
| Signed App Proxy context | PROMOTE AS-IS | Shopify public boundary | Keep official proxy authentication and normalized tenant/shop/origin context |
| Short-lived widget credential | PROMOTE AS-IS | Shopify storefront adapter | Preserve shop/origin/visitor binding, expiry, tamper checks, and secret rotation plan |
| Durable rate limiting | PROMOTE AS-IS | Shared runtime infrastructure | Verify production PostgreSQL capacity and alerting |
| Encrypted Shopify session storage | PROMOTE AS-IS | Shopify authentication layer | Complete authorized install/uninstall/reinstall and refresh-rotation proof |
| Webhook authentication and replay protection | PROMOTE AS-IS | Shopify lifecycle layer | Verify registered remote topics and operational alerting |
| Tenant-keyed Prisma model | PROMOTE AS-IS | IntentCart runtime | Keep tenant isolation tests and add backup/restore proof |
| Cart confirmation boundary | PROMOTE AS-IS | Commerce execution layer | Preserve exact product/variant/quantity confirmation |
| Durable mutation idempotence | PROMOTE AS-IS | Commerce execution layer | Rehearse ambiguous live failure and reconciliation |
| Checkout URL validation | PROMOTE AS-IS | Shopify handoff adapter | Never report completion from a handoff alone |
| Theme app embed shell | ADAPT | Shopify surface adapter | Keep Liquid thin and remove automatic opening controls |
| Storefront renderer | ADAPT | ExperienceDocument renderer | Enforce closed startup and consume only runtime-owned decisions |
| Extension CSS | ADAPT | Shopify surface adapter | Complete focus, zoom, mobile, and representative-theme verification |
| Theme schema | ADAPT | Shopify Theme Editor | Make it the sole owner of presentation settings |
| Admin Widget settings | ADAPT | Existing Widget page | Retain behavior/guardrails; remove duplicated presentation ownership |
| Shopify MCP/catalog boundary | NEEDS COMPARISON | Catalog provider port | Compare with the canonical Sage catalog contract and prove live reads |
| UCP provider boundary | KEEP FEATURE-FLAGGED | Commerce provider layer | Require capability discovery, schema validation, host allowlist, and canary proof |
| Deterministic fixtures | KEEP ISOLATED | Tests only | Never substitute them for a failed live provider |
| Generated `.shopify/` bundles | ARCHIVE AS EVIDENCE | Local deployment diagnostics | Regenerate after CLI repair; never treat as deployment proof |
| Secondary app configuration | NEEDS COMPARISON | Configuration cleanup | Select one canonical config before deployment; do not merge blindly |
| Agent and skill system | PROMOTE AS-IS IN LAB | Repository governance | Has no runtime or Shopify scope effect |

## Boundary With Sage Core

The stable integration direction is:

```text
Theme App Extension
-> signed Shopify surface adapter
-> Agentic Shopping Core
-> CatalogProvider / CommerceProvider
-> Shopify source of truth
-> ExperienceDocument
-> storefront renderer
```

The Shopify repository should continue owning installation, authentication,
tenant lifecycle, merchant persistence, App Proxy security, and Shopify
commerce execution. Generic intent, ranking, vertical packs, and experience
contracts may later be extracted only after a contract-by-contract comparison.

## Required Gates Before Production Promotion

1. Pin the validated Shopify CLI/Node runtime without changing the app identity
   or OAuth scopes.
2. Reconcile `shopify.app.toml` with any secondary configuration and regenerate
   local manifests from the selected canonical file.
3. Remove every automatic opening path and test closed startup across all four
   widget layouts.
4. Give Theme Editor sole ownership of placement and appearance.
5. Verify installation, token refresh, uninstall, reinstall, and webhook topics
   on two authorized development stores.
6. Verify tenant isolation, rate limits, and correlation IDs under both shops.
7. Run live product search, no-more-than-three recommendations, comparison,
   variant resolution, explicit confirmation, one idempotent cart mutation, and
   Shopify checkout handoff.
8. Verify mobile, desktop, keyboard, focus, reduced motion, 200% zoom, and a
   representative theme matrix.
9. Prove the deployed commit, migrations, rollback, healthchecks, logs,
   alerting, backup, and restore.
10. Keep UCP and alternate LLM providers behind explicit per-shop flags until
    their live capabilities and failure behavior are evidenced.

## Decision

Current decision: `PROMOTE SECURITY AND COMMERCE PRIMITIVES / ADAPT THE SHOPIFY
SURFACE / KEEP LIVE CLAIMS BLOCKED`.

The repository contains strong production-shaped foundations. The remaining
work is boundary correction and authorized live verification, not an
architectural rewrite.
