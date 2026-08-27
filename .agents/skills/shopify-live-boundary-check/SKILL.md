---
name: shopify-live-boundary-check
description: Audit or review any IntentCart change involving Shopify OAuth, session tokens, offline tokens, App Proxy, webhooks, catalog data, variants, cart, checkout, tenant isolation, or live-versus-fixture behavior. Use before approving a Shopify-facing change or claiming that a flow is production-ready.
---

# Shopify Live Boundary Check

## Goal

Prove that every Shopify-facing operation has a trusted tenant context, a
single source of truth, an explicit mutation boundary, and evidence matching
the strength of the claim.

## Gate 1: Installation And Session Trust

Verify:

- embedded Admin routes authenticate with the official Shopify boundary;
- OAuth state is one-time, scoped, and expires;
- session tokens are verified server-side;
- offline access tokens are encrypted at rest and rotate safely;
- refresh concurrency cannot overwrite a newer token;
- uninstall revokes or removes shop-owned sessions and configuration;
- reinstall does not inherit invalid credentials or another tenant's data;
- no OAuth scope changed as a side effect of unrelated work.

Treat live installation, uninstall, and reinstall as unverified until performed
on an authorized development store.

## Gate 2: Public Widget Trust

For App Proxy and direct widget requests, trace the full chain:

```text
signed Shopify request
-> normalized shop and storefront origin
-> tenant lookup
-> short-lived widget credential
-> shop/origin/visitor binding
-> rate limit
-> runtime operation
```

Reject the boundary if tenant identity comes only from query/body input, if the
origin is not normalized, if credentials are long-lived, or if a test fixture
can silently replace an unavailable live service.

Check request IDs/correlation IDs, structured logs, abuse limits, expiry,
tamper cases, and failure messages without logging tokens or personal data.

## Gate 3: Catalog Authority

- Shopify is authoritative for product, variant, price, currency, availability,
  image, handle, and canonical URL.
- Normalize at the server boundary and validate the normalized contract.
- Preserve provenance and retrieval time when the contract supports them.
- Do not cache buyer, market, price, stock, or cart data across incompatible
  tenant or market contexts.
- Fixtures are allowed only under explicit test configuration.
- A UCP or other provider is active only after capability discovery and schema
  validation; unsupported operations fall back through an explicit policy.

## Gate 4: Cart Mutation

Require all of the following before approving a cart write:

1. Server-resolved shop and tenant.
2. Current product and variant validated against Shopify truth.
3. Exact product, variant, and quantity shown to the shopper.
4. Explicit shopper confirmation recorded.
5. A server-issued candidate or equivalent anti-tamper artifact.
6. A durable idempotency key.
7. Reconciliation or authoritative reread after ambiguous failure.
8. No LLM retry capable of issuing the mutation twice.

UI text, a model tool call, or a client-side boolean is not sufficient proof of
confirmation.

## Gate 5: Checkout Handoff

- Checkout creation or retrieval runs through the configured commerce provider.
- The returned URL is parsed and matched to an approved Shopify host/origin.
- `continue_url`, warnings, disclosures, messages, and escalation are preserved
  when a negotiated protocol returns them.
- The app reports a handoff, not a completed transaction, unless completion is
  independently observed.
- Unsupported autonomous completion remains disabled.

## Gate 6: Webhooks And Data Lifecycle

Verify Shopify authentication, required compliance topics, replay protection,
tenant lookup, uninstall handling, and idempotent processing. Confirm that data
retention and deletion behavior match the current schema and documentation.
Do not send a webhook or mutate a remote store during a review.

## Gate 7: Evidence And Release Verdict

Classify each capability as:

- `Verified live`
- `Locally tested`
- `Implemented but externally blocked`
- `Simulated`
- `Documented only`
- `Unknown`

Before a production-ready verdict, require named evidence for installation,
session rotation, two-shop isolation, widget bootstrap, search, comparison,
variant confirmation, idempotent cart mutation, checkout handoff, uninstall,
healthchecks, migrations, rollback, and backup/restore. Missing authorization or
credentials is a blocker, not permission to infer success.

## Review Output

Lead with concrete findings and file references. For every failure state:

- identify the violated authority or trust boundary;
- describe the shopper or merchant impact;
- name the smallest safe remediation;
- name the test or live proof needed to close it.

Never include secret values, signed URLs, access tokens, personal data, or raw
customer payloads in the report.
