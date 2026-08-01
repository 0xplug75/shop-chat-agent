# Sage consolidation recovery handoff

Date: 2026-08-01

This handoff reflects the extended production stabilization run. No code was
copied from neighboring labs and no lab became a runtime dependency.

## Runtime ownership

IntentCart owns:

- Shopify installation identity and tenant isolation;
- encrypted offline credentials and refresh rotation;
- `CommerceSession`, recovery, experiments, and behavior events;
- provider-neutral LLM execution;
- provider-neutral commerce discovery and execution;
- exact purchase confirmation and mutation idempotence;
- the canonical data-to-surface `ExperienceDocument` projection;
- Liquid/App Proxy storefront trust boundaries.

Shopify remains authoritative for product, variant, price, availability, cart,
checkout, and transaction.

## Promote as-is after preview proof

| Asset                   | Entry point                                                                                  | Invariant                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Runtime URL policy      | `app/config/runtime-urls.js`                                                                 | Stable validated origin; no tunnel dependency               |
| Offline session storage | `app/services/shopify-session-storage.server.js`                                             | Encrypted, leased, atomic rotation                          |
| LLM provider port       | `app/services/llm/provider-contract.server.js`                                               | One normalized execution/stream contract                    |
| Commerce provider port  | `app/services/commerce/provider-contract.server.js`                                          | Capability discovery before use                             |
| UCP client/provider     | `app/services/commerce/ucp-client.server.js`, `app/services/commerce/ucp-provider.server.js` | Advertised schemas, safe URLs, no assumed operation         |
| Mutation barrier        | `app/services/commerce-mutation.server.js`                                                   | No fallback/retry after uncertain side effect               |
| Confirmation guard      | `app/services/tool-registry.server.js`                                                       | Exact product, variant, quantity, revision, confirmation ID |
| Recovery state          | `app/services/recovery.server.js`                                                            | Same shop and visitor, bounded lifetime                     |
| Experiment assignment   | `app/services/experiment.server.js`                                                          | Stable assignment, one atomic exposure, kill switch         |

Promotion preserves behavior and tests. Remote migration, two-store Shopify
E2E, and live provider proof are still required.

## Contracts ready or adapted

Canonical source: `app/contracts/commerce.schemas.server.js`.

| Contract               | Current state                                     | Consolidation decision                           |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `MerchantContext`      | Used                                              | Promote as-is                                    |
| `BuyerContext`         | Strict boundary                                   | Adapt when customer consent model is finalized   |
| `IntentState`          | Versioned boundary over current structured intent | Compare with Magpie before field freeze          |
| `VerticalPack`         | Generic schema only                               | Import no skincare logic; compare with Magpie    |
| `CatalogSearchInput`   | Used with compatibility alias                     | Compare filters/pagination with Catalog Kit      |
| `CatalogSearchRequest` | Strict future provider request                    | Extract contract                                 |
| `NormalizedProduct`    | Used by experience projection                     | Compare with Catalog Kit result shape            |
| `ProductTrust`         | Used                                              | Promote provenance invariant                     |
| `RecommendationSet`    | Built at runtime                                  | Compare ranking evidence with Magpie             |
| `CartCandidate`        | Used through `PurchaseCandidate` alias            | Promote exact confirmation invariant             |
| `CartSnapshot`         | Defined boundary                                  | Adapt provider persistence progressively         |
| `CommerceSession`      | Persistent source of workflow state               | Promote as container; intent remains a component |
| `ExperienceDocument`   | Built, persisted, and emitted                     | Compare renderer semantics with Intent Card Demo |
| `ExperimentAssignment` | Persistent                                        | Promote after outcome query exists               |
| `BehaviorSignal`       | Runtime-validated before persistence              | Adapt event taxonomy only through versioning     |
| `RecoveryState`        | Persistent                                        | Promote after consent UX review                  |

## Provider topology

```text
Storefront Liquid
Hydrogen renderer (future)
External UCP agent
        |
        v
Agentic Shopping Core
        |
        +-- LlmProvider: OpenAI / Kimi / optional Anthropic / fake test
        |
        +-- CommerceProvider
            +-- ShopifyProvider
            +-- UcpProvider
            +-- FixtureProvider (test only)
```

The `ShopifyProvider` currently uses Shopify's catalog/policy path and UCP cart
path. The independent `UcpProvider` can use a merchant-configured business URL.
Both fail closed when discovery or a required operation is absent.

## ExperienceDocument handoff

Entry point: `app/services/experience-document.server.js`.

The projection includes:

- bounded assistant message;
- one to three normalized product recommendations with trust provenance;
- comparison data;
- exact cart confirmation;
- cart state and safe checkout action;
- a surface hint for widget, inline, or fullscreen rendering.

It does not contain hidden prompts, provider keys, or vertical-specific rules.
The current Liquid widget still renders legacy SSE product events. A future
Intent Card Demo or Hydrogen renderer can consume the document after contract
comparison without changing commerce execution.

## UCP handoff

UCP is implemented locally against the official discovery and MCP boundaries:

- business discovery through `/.well-known/ucp`;
- operation introspection through `tools/list`;
- JSON Schema validation before every call;
- catalog search/lookup/product;
- cart create/get/full update;
- optional checkout create/get/update;
- hard-disabled checkout completion;
- preserved escalation, continuation, messages, warnings, and disclosures.

It is not live. The deployed service returned 404 for the candidate's agent
profile on 2026-08-01.

## Required comparisons

```text
IntentState
<-> Magpie intent/belief state
<-> decide evidence ownership and revision semantics

VerticalPack
<-> Magpie vertical configuration
<-> extract generic capabilities without skincare coupling

CatalogSearchRequest / NormalizedProduct
<-> Catalog Kit contracts
<-> settle filters, cursor, trust, and availability semantics

ExperienceDocument
<-> Intent Card Demo visual document
<-> separate canonical blocks/actions from renderer layout

CommerceProvider UCP projection
<-> Intent Card Demo UCP work
<-> retain IntentCart confirmation and mutation journal as authority

ExperienceDocument renderer
<-> Hydrogen lab
<-> add a surface adapter without forking Sage Core
```

## Consolidation sequence

1. Back up an isolated preview database, apply the three locally validated
   migrations, and repeat the eight PostgreSQL integration tests.
2. Validate one OpenAI or Kimi smoke request with commerce tools disabled.
3. Deploy an immutable candidate and verify App Proxy and UCP profile.
4. Pass install, reinstall, exact cart, duplicate confirmation, and checkout on
   two development stores.
5. Compare and freeze minimum catalog and intent contracts.
6. Promote one vertical pack behind a per-shop flag.
7. Connect the current widget to `ExperienceDocument` incrementally.
8. Run UCP in canary with observability before broader activation.
9. Add the Hydrogen renderer only after the shared contract is stable.

## Non-negotiable invariants

- `IntentState` is part of `CommerceSession`.
- A vertical pack cannot mutate Shopify.
- A catalog provider does not own cart or checkout state.
- Every mutation requires a confirmed `CartCandidate` and journal reservation.
- No provider fallback occurs after `side_effect_started`.
- `side_effect_unknown` is reconciled, never blindly retried.
- An experience renderer cannot rewrite commerce state.
- No fixture is used outside tests or as silent live fallback.
- No uncalibrated score is shown to shoppers.

## Remaining blockers

- Candidate migrations and rollbacks pass on disposable PostgreSQL 16 but are
  not applied to a persistent preview database.
- PostgreSQL integration tests pass locally and must be repeated in preview.
- No live OpenAI or Kimi request is proven.
- No dev-store or two-store E2E is proven.
- The current Railway deployment is healthy but does not include this code.
- Alerts, mutation reconciliation ownership, backup restore, and dependency
  advisory acceptance remain operational gates.
