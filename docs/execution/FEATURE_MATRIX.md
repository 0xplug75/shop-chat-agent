# IntentCart production feature matrix

Date: 2026-08-01

State vocabulary:

- `Live`: observed on the currently deployed service.
- `Feature flag`: implemented locally and explicitly gated per merchant.
- `Simulated`: proven only with deterministic adapters or fixtures.
- `Blocked`: not proven in the target environment or missing an operational
  dependency.

Because the candidate is not deployed, a locally passing implementation is not
called live.

| Capability                          | State        | Local implementation                           | Deployment proof                 | Limitation or gate                                  |
| ----------------------------------- | ------------ | ---------------------------------------------- | -------------------------------- | --------------------------------------------------- |
| Railway HTTP health                 | Live         | `app/routes/health.jsx`                        | HTTP 200 on 2026-08-01           | Does not identify deployed commit                   |
| Railway PostgreSQL readiness        | Live         | `app/routes/health.db.jsx`                     | HTTP 200 on 2026-08-01           | Does not prove new migrations                       |
| Embedded five-page navigation       | Blocked      | Exact five-label invariant test passes         | Candidate not deployed           | Verify exact labels in Shopify iframe after deploy  |
| Offline token encryption            | Blocked      | Unit-tested                                    | Candidate not deployed           | Migration and dev-store refresh required            |
| Offline token rotation lease        | Blocked      | Unit-tested                                    | Candidate not deployed           | Concurrent live refresh not exercised               |
| Install/uninstall/reinstall         | Blocked      | Webhook/OAuth tests                            | No live run                      | Requires authorized dev stores                      |
| Signed App Proxy                    | Blocked      | Security tests                                 | No post-run live proof           | Shopify proxy call required                         |
| Short-lived widget token            | Blocked      | Shop/origin/visitor binding tested             | No post-run live proof           | Signed live App Proxy replay test required          |
| App Proxy credential transport      | Blocked      | Signed tenant + JSON-body token path tested    | Candidate not deployed           | Verify Shopify strips no required query parameters  |
| Shared PostgreSQL rate limit        | Blocked      | Visitor/network/shop/bootstrap layers tested   | Migration only applied locally   | Repeat on preview PostgreSQL                        |
| Catalog search                      | Blocked      | Provider boundary tested                       | No live candidate proof          | Current deployed revision differs                   |
| Maximum three recommendations       | Blocked      | Contract and E2E tested                        | No live candidate proof          | Needs dev-store catalog                             |
| Product comparison                  | Simulated    | Deterministic E2E passes                       | None                             | Live Shopify products not exercised                 |
| Exact cart confirmation             | Simulated    | Registry and E2E pass                          | None                             | Live App Proxy flow not exercised                   |
| Idempotent cart mutation            | Simulated    | Mutation journal tests pass                    | None                             | Preview migration and duplicate live call required  |
| Shopify checkout handoff            | Simulated    | Deterministic E2E passes                       | None                             | No real checkout URL generated in this run          |
| UCP discovery and schema validation | Blocked      | 13 contract tests pass                         | `/ucp/agent-profile` is 404 live | Deploy candidate and test advertised business       |
| UCP cart                            | Feature flag | `ucpCart`, default true                        | Candidate not deployed           | Depends on live Shopify UCP discovery               |
| UCP checkout handoff                | Feature flag | `ucpCheckout`, default false                   | Candidate not deployed           | Requires advertised checkout capability             |
| UCP checkout completion             | Blocked      | Hard-disabled                                  | None                             | Deliberate release safety gate                      |
| OpenAI provider                     | Blocked      | Contract-tested                                | No live call                     | Configure approved key/model                        |
| Kimi provider                       | Blocked      | Contract-tested                                | No live call                     | Configure approved key/model                        |
| Anthropic provider                  | Blocked      | Contract-tested, hidden from merchant selector | No live call                     | Retained as optional adapter only                   |
| Provider fallback                   | Blocked      | Unit-tested                                    | No live call                     | Enable only after two providers pass smoke tests    |
| ExperienceDocument                  | Blocked      | Built, persisted, emitted, tested              | Candidate not deployed           | Current widget keeps legacy renderer                |
| Session recovery                    | Feature flag | `sessionRecovery`, default true                | Candidate not deployed           | Preview DB and consent UX proof required            |
| Contextual launcher                 | Feature flag | `contextualLauncher`, default false            | Candidate not deployed           | Requires launcher experiment enablement             |
| Stable launcher experiment          | Feature flag | Assignment, exposure, kill switch implemented  | Candidate not deployed           | Analytics outcome query not yet exposed in admin    |
| Merchant configuration saves        | Blocked      | Five pages persist; PostgreSQL locking tested  | Candidate not deployed           | Preview migration and Shopify iframe proof required |
| Knowledge policy retrieval          | Blocked      | Local and Shopify fallback paths exist         | No live candidate proof          | Approved source/indexing lifecycle is partial       |
| Vertical packs                      | Blocked      | Generic `VerticalPack` contract only           | None                             | No lab pack promoted                                |
| Hydrogen surface                    | Blocked      | `ExperienceDocument` boundary only             | None                             | Future renderer, no runtime dependency              |
| Two-shop E2E                        | Blocked      | Cross-tenant PostgreSQL tests pass locally     | None                             | Two authorized dev stores unavailable               |
| Alerts and reconciliation           | Blocked      | Structured logs and unknown state exist        | No alert proof                   | External monitor/owner required                     |
| Backup and restore                  | Blocked      | Runbook prepared                               | No restore proof                 | Platform backup must be tested                      |
| Pull-request CI                     | Blocked      | PostgreSQL 16 workflow versioned               | Workflow has not run remotely    | Push branch and observe first green run             |
