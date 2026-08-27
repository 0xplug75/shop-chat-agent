# Shopify Commerce Conformance 1.0.0-rc.1

Verification date: 2026-08-08.

## Scope

This report records the local conformance of the product-owned Shopify Commerce
boundary to the frozen Sage inter-lab protocol. It does not establish a live
Shopify mutation, a deployed revision, or production readiness.

- Protocol: `1.0.0-rc.1`
- Manifest SHA-256:
  `2f97927faaed19ec42477b1c93de86d14b7786c1743e84417d59fbb9bfe0652b`
- Local frozen snapshot: `app/protocol/sage-interlab/1.0.0-rc.1/`
- Product-owned validator:
  `app/services/sage-integration/protocol/1.0.0-rc.1.server.js`
- Commerce boundary:
  `app/services/commerce/commerce-boundary.server.js`

The frozen Magpie release was read only. No lab runtime code is imported by the
application.

## Observed Pipeline

```text
CommerceIntentHandoff
-> exact version, expiry and state-revision validation
-> tenant-scoped permission check
-> fresh variant, quantity, price, stock and cart validation
-> exact expiring single-use confirmation receipt
-> second fresh revalidation
-> durable idempotency reservation
-> deterministic Shopify provider mutation
-> fresh authoritative read
-> CommerceResultEnvelope
-> mandatory reconciliation for ambiguous outcomes
-> reduced CommerceOutcomeEvent
```

`complete_checkout` is not executable in V1. Model-visible tools exclude cart
and checkout mutations. Fixtures are restricted to non-production local test
execution.

## Ownership Checks

| Requirement                                          | Evidence                                                   | Local result  |
| ---------------------------------------------------- | ---------------------------------------------------------- | ------------- |
| Frozen manifest and eight artifacts                  | `tests/sage-interlab-conformance.test.js`                  | Pass          |
| Official cross-owner fixture                         | 30 positive + 15 negative cases                            | Pass, `45/45` |
| Thirteen Commerce statuses                           | `tests/sage-commerce-protocol.test.js`                     | Pass, `13/13` |
| Permission before confirmation                       | `commerce-permission.server.js`, boundary tests            | Pass          |
| Exact, expiring, single-use confirmation             | `commerce-confirmation.server.js`, boundary tests          | Pass          |
| Product binding on receipt                           | `commerce-boundary.server.js`, tamper regression           | Pass          |
| Fresh price, stock, variant, quantity and cart reads | `commerce-authority.server.js`, boundary tests             | Pass          |
| Durable idempotence and concurrency                  | `commerce-mutation.server.js`, mutation and boundary tests | Pass          |
| Ambiguous outcome reconciliation                     | boundary and idempotency tests                             | Pass          |
| Authoritative success only                           | `commerce-authority.server.js`, result schema tests        | Pass          |
| Reduced PII-free outcome                             | canonical protocol module and analytics sanitizer          | Pass          |
| Direct LLM mutation excluded                         | `tool-registry.server.js`, boundary tests                  | Pass          |

## Executed Evidence

| Command             | Result                                                                   |
| ------------------- | ------------------------------------------------------------------------ |
| `npm test`          | 22 files passed, 1 skipped; 139 tests passed, 8 PostgreSQL tests skipped |
| `npm run lint`      | Pass                                                                     |
| `npm run typecheck` | Pass                                                                     |
| `npm run build`     | Pass; `widget.sage` present in client and SSR build                      |

The PostgreSQL suite was not executed because `TEST_DATABASE_URL` was unset.
All Commerce test providers were deterministic and local. No network request,
remote Shopify mutation, deployment, migration, commit or push occurred.

## Limits

- Live Shopify catalog reads are not proved by this run.
- Live cart mutation and checkout handoff are not proved by this run.
- Durable PostgreSQL confirmation, idempotency and concurrency paths remain
  covered by code and existing integration tests, but were not re-executed
  without a disposable database.
- Preview and production promotion remain blocked.

## Verdict

The Shopify Commerce owner is conformant for the local protocol boundary. This
verdict authorizes local integration testing only; it does not authorize live
Commerce, preview deployment or production.

```text
SHOPIFY_COMMERCE_CONFORMANCE_HANDOFF
PROTOCOL_VERSION: 1.0.0-rc.1
MANIFEST_HASH_MATCH: true
HANDOFF_CONSUMER_PASS: true
PERMISSION_AND_CONFIRMATION_PASS: true
FRESH_REVALIDATION_PASS: true
IDEMPOTENCY_PASS: true
RECONCILIATION_PASS: true
FROZEN_FIXTURE_PASS: true
COMMERCE_OWNER_CONFORMANT: true
P0_DEFECT: false
BLOCKERS: live Shopify proof; disposable PostgreSQL integration test environment
END_SHOPIFY_COMMERCE_CONFORMANCE_HANDOFF
```
