# IntentCart contract crosswalk — Phase 1

Date: 2026-08-01  
Scope: read-only starting audit and promotion decisions; no runtime or design integration performed.

## Baseline and preservation

- Repository: `shop-chat-agent-work`
- Branch: `codex/intentcart-admin-freeze`
- HEAD: `ff99924c26bb1da08c43451852fee1c618dddfc6` (`chore(rc): preserve IntentCart integration candidate`)
- Upstream: `origin/codex/intentcart-admin-freeze` at `43ae66e`; local branch is one commit ahead.
- Worktrees: one, rooted at the repository.
- Preservation evidence exists in `docs/runs/PRE_RUN_BASELINE.md`, `docs/runs/NEXT_RUN_REPORT.md`, `docs/runs/RECOVERY_HANDOFF.md`, `docs/audits/LAB_MANIFEST_POST_RUN.json`, and `PROMOTION_MANIFEST.json`.
- Pre-existing user changes are preserved and were not edited: modified `docs/PROJECT_STATE.md`, modified `docs/Vision.md`, untracked `docs/Positioning.md`, `docs/audits/LAB_AUDIT.md`, and `docs/audits/LAB_MANIFEST.json`.
- `.env` exists locally but is untracked. Its contents were not inspected or copied.
- No remote action, paid provider call, Shopify mutation, deployment, database migration, or design change was performed.

## Promotion manifest comparison

| Source | Manifest position | Candidate assets | Must remain isolated / blocked |
|---|---|---|---|
| Catalog Kit | 20 public catalogue v2 contracts; JSON Schema is the manual source of truth; promote selectively | schemas, generated contracts, `CatalogClient`, hard-filter enforcement, money, provider errors, conformance | fixtures, workbench UI, v1 snapshot; providers require adaptation and live Shopify/UCP proof |
| Magpie | local contract and engine candidate with no runtime dependencies | `VerticalPack`, `IntentProfile`, `StructuredIntentCandidate`, `BehaviorEvent`, `TriggerDecision`, skincare pack | coffee is portability proof only; ranking and triggers remain heuristic and uncalibrated |
| Intent Card Demo | shopper experience reference | `ExperienceDocumentV1`, shopper state machine, view models, renderers, tokens, PII-free analytics | Next.js host, fixtures, gallery copy, Commerce Brain inspector, Noven heuristics |
| Hydrogen | `ready_to_promote: false`; compatibility reference only | request/market shapes, variant-resolution states, checkout handoff and document-adapter seams | all Hydrogen UI/runtime bindings, local cart, simulated checkout and UCP adapter |

## Canonical ownership decision

The ownership hypothesis is confirmed with two qualifications:

1. IntentCart remains canonical for tenant/security/session/mutation contracts, but its catalogue and experience placeholders must not remain competing public contracts.
2. `BuyerContext`, `MarketContext`, `ProductReference`, `VariantResolver`, and `CheckoutHandoff` need compatibility projections, not Hydrogen ownership or a Hydrogen dependency.

Decision vocabulary: **keep** preserves the IntentCart contract; **adapt** promotes a source contract through an IntentCart-specific boundary; **replace** retires a competing public shape after migration; **reject** keeps the asset out of production.

## Contract crosswalk

| Concept | Canonical owner | Source | Contract already in IntentCart | Divergence | Decision | Migration necessary | Tests required |
|---|---|---|---|---|---|---|---|
| `MerchantContext` | IntentCart | IntentCart security boundary | Zod schema plus frozen request context | Runtime shape has more trusted fields than public schema | keep | Align schema/projection without weakening App Proxy or widget-token checks | schema, App Proxy, tenant mismatch, IDOR |
| Shopify security | IntentCart | IntentCart | App Proxy verification, widget token, canonical shop domain, origin checks | No source offers a stronger production boundary | keep | None beyond regression coverage | signature, origin, token expiry, tenant mismatch |
| Multitenant isolation | IntentCart | IntentCart | `shopId`-scoped Prisma models/services; visitor-bound tokens | Some imported contracts omit shop scope by design | keep | Require `MerchantContext` envelope at every promoted runtime port | cross-shop reads/writes, visitor isolation |
| `BuyerContext` | IntentCart | IntentCart + Catalog Kit; Hydrogen reference | strict v1 with visitor/customer, country/language/currency and consent | Catalog adds region/postal/market; Hydrogen hard-codes two markets and adds analytics consent | adapt | Extend optional market fields; keep identity/consent in the IntentCart envelope; add Hydrogen projection later | schema, locale/market combinations, consent minimization |
| `MarketContext` | IntentCart projection | Hydrogen reference | embedded fields in `BuyerContext` and search request | No explicit market contract | adapt | Add a generic optional projection without Hydrogen imports | projection and unsupported-market tests |
| `CommerceSession` | IntentCart | IntentCart | persisted state, revision, expiry, recovery, experiment | Shopper state is coarser than demo state machine | keep | Store/project shopper state separately; do not replace transaction session | transitions, expiry, recovery, optimistic concurrency, tenant isolation |
| `CartCandidate` | IntentCart | IntentCart; Catalog Kit invariants | `PurchaseCandidate` compatibility alias with exact product/variant/quantity and confirmation | Missing provider, canonical selection snapshot, fingerprint and public idempotency key from Catalog v2 | adapt | Keep IntentCart ownership; enrich prepared candidate and bind it to mutation journal/revalidation | exact confirmation, changed variant/price/stock, fingerprint, replay |
| `CartSnapshot` | IntentCart | IntentCart | v1 provider/cart/lines/cost snapshot | Cost uses floating numbers; no line price/availability revision | adapt | Move money to minor units and add provider revision/freshness without UI recomputation | schema, rounding, revalidation, provider parity |
| Mutation journal | IntentCart | IntentCart | durable side-effect lifecycle and per-shop idempotency | Catalog lab only proves in-memory idempotence | keep | Preserve journal as sole execution barrier | concurrency, retry, unknown side effect, cross-shop key reuse |
| Commerce prepare → confirm → execute | IntentCart | IntentCart + Catalog Kit learning | confirmation-required tool flow then mutation coordinator | Preparation is implicit and candidate contract is thin | adapt | Make prepare explicit while preserving exact confirmation and durable execute barrier | mismatch, stale confirmation, duplicate execute, no-executor failure |
| `CatalogProvider` port | Catalog Kit | Catalog Kit | one combined `CommerceProvider` with catalogue, policy, cart and checkout methods | Read and mutation capabilities are coupled; method/result shapes differ | replace | Introduce catalogue-only port; retain a separate IntentCart commerce provider for mutations | provider conformance, capability accuracy, boundary validation |
| `CatalogClient` | Catalog Kit | Catalog Kit | legacy MCP catalogue adapter and provider registry | No provider-neutral validating client | adapt | Port client behavior around the canonical provider; no lab runtime dependency | input/output validation, timeout/error mapping |
| Shopify Storefront catalogue provider | Catalog Kit contract, IntentCart production adapter | Catalog Kit + IntentCart | legacy MCP-backed read adapter inside Shopify provider | Not the canonical v2 port; production path is not clearly Storefront GraphQL-owned | adapt | Implement v2 read adapter using tenant/market context; keep Shopify authoritative | offline GraphQL conformance, publication/market, live opt-in |
| UCP catalogue provider | Catalog Kit contract, IntentCart production adapter | Catalog Kit + IntentCart | real UCP discovery/client and combined provider | Coupled to cart/checkout flags; no Shopify-vs-UCP shadow result contract | adapt | Separate read adapter; keep sensitive actions flagged off; add shadow comparison | discovery, schema validation, SSRF, capability, shadow parity |
| Fixture catalogue provider | Test-only | Catalog Kit/IntentCart | test-only combined fixture provider | Exposes commerce mutations in tests and different result shapes | replace | Add catalogue-only fixture harness under `NODE_ENV=test`; retain mutation fixture only for deterministic commerce tests | environment guard, common conformance |
| `CatalogSearchInput` / request | Catalog Kit | Catalog Kit | IntentCart `CatalogSearchRequest` v1 | IntentCart uses record-shaped hard/soft filters and lacks request/intent IDs, query and referral | replace | Adopt v2 request as the only public catalogue request; create temporary internal adapter | JSON Schema/Zod parity, negative examples, pagination |
| Hard filters | Catalog Kit | Catalog Kit | opaque `filters.hard` record | No typed operators, source, currency or proof that filters remain blocking | replace | Promote typed `CatalogFilter[]` and local post-provider enforcement | every operator, currency mismatch, provider ignores filter, zero match |
| Soft signals | Catalog Kit | Catalog Kit | opaque record plus generic signal array | Facts, preferences and inferred signals can be conflated | replace | Promote typed signals with origin, reason and evidence | origin/evidence, ranking-only behavior, no silent hardening |
| `Money` | Catalog Kit | Catalog Kit | decimal strings on variants; floating numbers on cart; demo uses numbers/formatted strings | Multiple incompatible representations and rounding risk | replace | Canonical integer minor units + ISO currency; formatting only at presentation edge | zero/minor units, currencies with 0/3 decimals, conversion rejection |
| `NormalizedProduct` / variant | Catalog Kit | Catalog Kit | compact v1 product/variant used by experience projection | Missing canonical reference, seller, category, media, range, explicit availability and normalized attributes | replace | Adopt v2 canonical model; provide a temporary projection for existing widget code | schema, Shopify/UCP normalization, unknown data, provenance |
| `ProductTrust` / provenance | Catalog Kit | Catalog Kit + IntentCart | compact source/sourceId/evidence shape | Catalog v2 separates richer evidence, verified facts and missing data | adapt | Promote v2 trust data and map existing source records | unsupported claims, missing evidence, freshness |
| `ProviderCapability` | Catalog Kit | Catalog Kit | commerce capability object | Catalogue capability advertisement is not independently validated | replace | Use catalogue capabilities on catalogue port; retain commerce capabilities separately | false capability, unsupported operation |
| `ProviderError` | Catalog Kit | Catalog Kit | generic `CommerceProviderError` | Missing catalogue operation/path/severity/handoff fields; public message is Shopify-specific | replace | Promote structured catalogue error and map provider/network errors at boundary | retryability, status, safe public message, provider mapping |
| Provider conformance | Catalog Kit | Catalog Kit | provider-specific unit tests only | No common catalogue harness | adapt | Port harness and valid/invalid examples without fixture data becoming runtime truth | Shopify, UCP, fixture common suite |
| Clarification decision | Catalog Kit | Catalog Kit | `missingInformation` plus heuristic intent flow | No explicit abstain/relaxation contract | adapt | Promote decision contract; never auto-relax hard filters | insufficient evidence, suggested relaxation, no silent relaxation |
| `ShoppingIntent` / `IntentState` | Magpie intent semantics + Catalog Kit search projection | Magpie + Catalog Kit | narrow IntentCart taxonomy and deterministic extraction | Loses confirmed facts vs assumptions, contradictions, scope and vertical structure | replace | Make `IntentProfile` canonical in intelligence core; derive Catalog v2 search intent and keep an API compatibility adapter | extraction, correction, contradiction, provenance, multilingual fallback |
| `StructuredIntentCandidate` | Magpie | Magpie | absent | No structured adapter candidate boundary | adapt | Promote schema and validate before merging into profile | invalid adapter output, confidence threshold, merge provenance |
| `VerticalPack` | Magpie | Magpie | generic placeholder with free-form configuration | Placeholder does not express taxonomy, constraints, clarification, ranking, trust or claims policy | replace | Promote Magpie schema/compiler boundary; remove competing placeholder after migration | schema, portability, override allowlist, max three results |
| Skincare pack | Magpie | Magpie | absent; only `activeVerticals` config exists | No validated concerns, sensitivity, texture, fragrance, actives, exclusions, frequency, budget, routine or escalation rules | adapt | Promote configuration, not engine-specific lab code; fill any coverage gaps in the pack | pack validation, medical escalation, exclusions, routine, evaluation dataset |
| Other verticals | Magpie architecture | Magpie coffee proof | absent | Portability is unproven in IntentCart | reject for runtime now | Keep coffee isolated; use it only as a generic-core regression fixture later | portability test with a non-skincare pack |
| `BehaviorEvent` | Magpie | Magpie | `BehaviorSignal` includes shop/visitor/experiment and arbitrary payload | Names and shapes differ; IntentCart sanitizer blocks obvious secrets but not a strict per-event payload taxonomy | replace | Promote anonymous event schema inside an IntentCart tenant envelope; whitelist payloads per event | PII rejection, tenant/visitor, event schema, retention |
| `TriggerDecision` | Magpie | Magpie | absent; widget contains local contextual suggestion checks | No recorded reason/suppression contract or central engine | adapt | Promote decision contract and persist reason; force `autoOpen=false` | frequency, kill switch, consent, dismissal, reason logging, A/B |
| Behavioral assistance engine | Magpie | Magpie | launcher assignment plus client-side count | No candidate-signal engine; `openOnLoad` remains configurable | adapt | Build server decision port, disable automatic opening, keep suggestion discreet | all signals, cooldown, disabled shop, no auto-open |
| `ExperienceDocumentV1` | Intent Card Demo | Intent Card Demo | minimal generic block/action document | Missing locale/currency, commerce state, provenance, freshness, warnings and shopper-state projection; surface enum differs | replace | Adopt demo document semantics with catalogue v2 products and IntentCart cart projection; one runtime source of truth | Zod, compatibility fallback, max three, provenance/freshness |
| Shopper state machine | Intent Card Demo | Intent Card Demo | only persisted commerce journey stages | Missing UI lifecycle, rejected transitions and replay | adapt | Port reducer/state contract to runtime-neutral JS; map to, but do not merge with, `CommerceSession` stages | transition matrix, replay, invalid event, recovery |
| `RecommendationViewModel` | Intent Card Demo | Intent Card Demo | absent; product rendering consumes provider-shaped objects | Demo money/provider names conflict with canonical catalogue model; useful reasons/tradeoffs/evidence are missing | adapt | Build presenter from catalogue recommendation to view model; never expose internal scores | reasons/evidence, stale/unavailable, no score rendering |
| Conversation blocks/actions | Intent Card Demo | Intent Card Demo | free-form block and action records | No discriminated validation or unsupported-block fallback | replace | Promote discriminated schemas and compatibility fallback; bind actions to server commands | every block/action, unsupported block, unsafe URL/action |
| Four shopper surfaces | Intent Card Demo semantics | Demo + existing Theme App Extension | bubble, side-panel, inline, fullscreen already implemented | Required names are compact, floating, inline, full-screen; current render path does not consume one document | adapt | Define exact mapping and make all four render the same document; do not copy Next.js host | shared fixtures, desktop/mobile, keyboard, theme isolation |
| Brand tokens | Intent Card Demo | Demo + IntentCart merchant config | four colors and Theme Editor variables | No typed token contract or complete projection | adapt | Promote token resolver/projection with merchant-safe defaults | invalid tokens, contrast, CSS isolation |
| Experience analytics | IntentCart event storage + Demo UX taxonomy | IntentCart + Demo | persisted allowlist and payload sanitizer | Event names differ from required taxonomy; arbitrary payload can still contain non-key PII strings | replace | Adopt required names and strict event payload schemas; preserve tenant/exposure attribution | exact taxonomy, PII denial, exposure once, payload bounds |
| Experiment assignment | IntentCart | IntentCart | stable SHA-256 assignment by shop/visitor/experiment and exposure persistence | Only launcher experiment is modeled | keep | Generalize configuration without adding bandits | stability, shop separation, kill switch, exposure once |
| Recovery | IntentCart | IntentCart + Demo projection | persisted recovery state and events | Experience recovery block/state not yet projected | adapt | Keep storage canonical; add document/state-machine projection | expired/disabled/consumed, restore, no cross-visitor access |
| `ProductReference` | Catalog Kit; compatibility projection for Hydrogen | Catalog Kit + Hydrogen reference | raw provider product IDs | Hydrogen reference is fixture-only; Catalog v2 has canonical reference | adapt | Use Catalog v2 reference; later Hydrogen adapter maps it | provider identity, stable mapping |
| `VariantResolver` | IntentCart commerce verification informed by Hydrogen | Hydrogen reference | confirmation matching and provider revalidation are distributed | No explicit resolved/clarify/unavailable/changed result contract | adapt | Promote the result-state seam without Hydrogen code/dependency | missing options, unavailable, revision/price change, resolved |
| `CheckoutHandoff` | IntentCart | IntentCart; Hydrogen reference | provider handoff result and checkout URL | Hydrogen contract is explicitly simulated; target contract is not formalized | keep | Define an IntentCart handoff contract backed only by verified provider result | URL trust, no false success, buyer intervention, disabled provider |
| `ExperienceDocumentAdapter` | Future adapter only | Hydrogen reference | absent | Hydrogen document is a competing surface-specific shape | reject for runtime now | Reserve adapter boundary and compatibility fixtures only | future adapter contract test, no current dependency |
| Hydrogen UI/runtime | none in this release | Hydrogen lab | absent | Deferred by product decision and manifest not ready | reject | None | Ensure dependency/package scan stays Hydrogen-free |

## Existing admin and product invariants

- The five primary Shopify Admin links are already exactly `Home`, `Assistant`, `Widget`, `Knowledge`, and `Commerce`, in that order, with a dedicated regression test.
- Sage is already the visible assistant name in merchant defaults and product copy.
- Recommendation limits and exact confirmation are present, but catalogue normalization and experience rendering do not yet meet the promoted contracts.
- Automatic opening remains configurable through `openOnLoad`; this conflicts with the target product rule and must be removed or made permanently false in the behavioral-assistance phase.
- UCP is a real client/provider capability, but Shopify's current provider delegates cart and checkout to UCP when flags are enabled. This needs explicit product review in Phase 3 so Shopify remains the transaction authority unless a separately authorized UCP handoff is proven.

## Phase 1 gate

The contract crosswalk is complete enough to permit implementation planning. The gate is **GREEN for Phase 1**.

Offline verification executed on 2026-08-01:

| Scope | Command | Result |
|---|---|---|
| IntentCart | targeted Vitest contract, experience, navigation, security and mutation suites | 29/29 passed |
| Catalog Kit | `npm run contracts:check` and `npm test` | contract generation/check passed; 108 passed, 1 opt-in live UCP test skipped |
| Magpie | `npm test` | 59/59 passed; the local server-security tests required permission to bind an ephemeral `127.0.0.1` listener |
| Intent Card Demo | `npm test` | 63/63 passed |
| Hydrogen compatibility reference | `npm test` | 20/20 passed |

This gate does not authorize deployment, live providers, remote stores, paid LLMs, database changes, or runtime promotion before the relevant later-phase gate. Phase 2 must first establish the canonical contract package/schema locations and explicit compatibility adapters from this crosswalk.
