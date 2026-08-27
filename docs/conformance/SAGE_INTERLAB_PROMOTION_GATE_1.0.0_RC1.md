# Sage Inter-lab Promotion Gate 1.0.0-rc.1

Verification date: 2026-08-08.

## Decision

The three owner results are accepted for local integration against the exact
frozen protocol `1.0.0-rc.1`. The manifest SHA-256 is:

`2f97927faaed19ec42477b1c93de86d14b7786c1743e84417d59fbb9bfe0652b`

This gate allows the deterministic local Demo integration. It does not allow a
live catalog claim, live Commerce, a Vercel preview or production.

The historical `readiness` object in the Magpie release manifest remains
unchanged. This separate gate records later owner evidence without rewriting
the immutable release.

## Owner Evidence

| Owner               | Result                                             | Report and SHA-256                                                                                                                                                 | Evidence qualification                                                                                                       |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Catalog Kit         | `CATALOG_OWNER_CONFORMANT: true`                   | `../labs/catalog-kit-intent-card/docs/reviews/SAGE_INTERLAB_1_0_0_RC1_CATALOG_CONFORMANCE.md` — `514498a966e8daf604713d48f41fb8fd9bc317aef4a304c32eb566400c230969` | Report and machine result observed; local fixture only                                                                       |
| Hydrogen Experience | `EXPERIENCE_OWNER_CONFORMANT: PASS_LOCAL_CONSUMER` | `../labs/hydrogen-intent-card/docs/architecture/PROTOCOL_CONFORMANCE_1.0.0-RC.1.md` — `dd5545bc99de06151d6d069e86a76ec4b7ea6c31ca244339cfcaaea9592e3fbf`           | Supplied owner handoff correlated with the observed report; the literal handoff block was not present in the accessible file |
| Shopify Commerce    | `COMMERCE_OWNER_CONFORMANT: true`                  | `docs/conformance/SHOPIFY_COMMERCE_CONFORMANCE_1.0.0_RC1.md` — `da1799352e996ae2457d30c5f98a6b2eda24a051848e24da8abc945ebe1eb337`                                  | Current code and local tests observed                                                                                        |

Catalog Kit's machine report is additionally identified by:

- `../labs/catalog-kit-intent-card/artifacts/evaluations/CATALOG_INTERLAB_CONFORMANCE_REPORT.json`
- SHA-256:
  `cecb02d234f5ff9bc8ba87d60be33fcb944cdc3e55bcedaf198993c4acd635c1`

## Frozen Release Verification

| Check                      | Result                               |
| -------------------------- | ------------------------------------ |
| Manifest SHA               | Match                                |
| Normative artifacts        | `8/8` hashes match                   |
| Official fixture           | `45/45`: 30 positive and 15 negative |
| Commerce status set        | `13/13`                              |
| Contract drift             | None observed                        |
| Lab runtime dependency     | None                                 |
| Network or remote mutation | None                                 |

The product-owned canonical validator lives at
`app/services/sage-integration/protocol/1.0.0-rc.1.server.js`. The frozen JSON
snapshot remains byte-identical under
`app/protocol/sage-interlab/1.0.0-rc.1/`.

## Product Integration Evidence

The local integration now exercises:

```text
shopper intent
-> read-only CatalogRuntimePort
-> DecisionExperienceInput
-> shopper-safe projection
-> authorized ExperienceActionRequest
-> CommerceIntentHandoff
-> existing Commerce permission and confirmation boundary
-> authoritative CommerceResultEnvelope
-> shopper-safe projection
-> reduced CommerceOutcomeEvent
```

The deterministic Catalog and Decision adapters are labeled
`fixture_non_live` and fail closed in production. Commerce still requires exact
confirmation, fresh revalidation, durable idempotence and reconciliation. No
direct model mutation or `complete_checkout` path was added.

## Executed Checks

| Command             | Result                                 |
| ------------------- | -------------------------------------- |
| `npm test`          | 139 passed; 8 PostgreSQL tests skipped |
| `npm run lint`      | Pass                                   |
| `npm run typecheck` | Pass                                   |
| `npm run build`     | Pass; `widget.sage` compiled           |

`TEST_DATABASE_URL` was unset, so the disposable PostgreSQL suite could not be
executed safely. This is a named gate, not a silent pass.

## Gate State

```text
THREE_OWNER_CONFORMANCE: true
PROMOTION_GATE_CREATED: true
DEMO_LOCAL_INTEGRATION_ALLOWED: true
LIVE_CATALOG_ALLOWED: false
LIVE_COMMERCE_ALLOWED: false
VERCEL_PREVIEW_ALLOWED: false
PRODUCTION_ALLOWED: false
```

## Remaining Blockers

1. Persist the literal Hydrogen owner handoff in an owner-controlled artifact
   or retain the current evidence qualification.
2. Prove a live Noven or Shopify read-only catalog adapter.
3. Execute the disposable PostgreSQL suite.
4. Run an authorized Shopify flow through exact confirmation, one cart
   mutation and checkout handoff.
5. Verify a preview deployment and deployed SHA before changing any deployment
   gate.
