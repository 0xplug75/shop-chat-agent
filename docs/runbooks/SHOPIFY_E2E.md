# Shopify commercial E2E runbook

This runbook has two distinct modes. A fixture journey is mandatory for local
CI. A development-store journey is optional and must never be represented as
passing unless it has actually been executed.

## Mode A: deterministic local journey

This mode performs no network request and no remote mutation. Shopify catalog,
cart, and checkout responses are fixture adapters; the LLM is deterministic.

```bash
npm ci
npm run db:generate
npm run test:e2e:deterministic
```

Expected proof:

```text
tests/commerce.e2e.test.js: 1 passed
```

The test covers:

```text
offline installation session stored encrypted
-> shop/origin/visitor-bound signed widget token
-> vague request
-> clarification
-> structured intent
-> two Shopify-shaped fixture products
-> comparison
-> exact product / variant / quantity confirmation
-> one idempotent journaled cart mutation
-> trusted Shopify checkout handoff
```

It proves orchestration and safety contracts, not Shopify connectivity.

## Mode B: authorized development-store journey

### Preconditions

- A Shopify development store explicitly authorized for this test.
- A reviewed preview deployment using one stable HTTPS origin.
- All three Prisma migrations applied to an approved preview database.
- A unique `TOKEN_ENCRYPTION_KEY` backed up before installation.
- Required environment variables configured by name:
  `APP_ENV`, `APP_URL`, `SHOPIFY_APP_URL`, `SHOPIFY_API_KEY`,
  `SHOPIFY_API_SECRET`, `SCOPES`, `DATABASE_URL`, `DIRECT_URL`,
  `TOKEN_ENCRYPTION_KEY`, `WIDGET_SIGNING_SECRET`,
  `WIDGET_ALLOWED_ORIGINS`, and one LLM provider key.
- Shopify application URL, admin callback, App Proxy URL, and Customer Account
  callback all match the preview origin.
- A low-risk test product with an available variant. Do not use a real customer
  or submit payment.

### Safety stop conditions

Stop immediately if:

- the shop domain is not the approved development store;
- the deployed commit does not match the reviewed revision;
- `/health` or `/health/db` is not healthy;
- an offline token appears in logs;
- the mutation journal cannot be queried;
- a prior mutation is in `started` or `unknown` for the same confirmation;
- checkout requires a real payment rather than stopping at the checkout page.

### Procedure

1. **Install and authenticate.** Install or reauthorize IntentCart from the
   approved app configuration. Open the embedded admin app and record the
   timestamp and reviewed commit.
2. **Verify encrypted offline session.** Confirm by metadata only that the
   offline session has token version and expiration/refresh metadata. Never
   print token columns.
3. **Exercise refresh when safe.** In a dedicated test window, confirm one
   expiring offline token refresh increments `tokenVersion`, clears the lease,
   and keeps one valid session. If forcing expiry would require unsupported
   mutation, mark this step blocked.
4. **Enable the widget.** Activate the Theme App Extension on the development
   theme and set the storefront origin allowlist. Do not publish a production
   theme.
5. **Bootstrap.** Open the development storefront. Verify the signed App Proxy
   request returns a short-lived shop/origin/visitor-bound widget token. Confirm
   that App Proxy POSTs put the token only in the JSON body, never in the URL,
   while direct backend calls use `Authorization: Bearer`. Verify replay from
   another shop, origin, or visitor is rejected.
6. **Clarify intent.** Send a deliberately vague product request. Sage must ask
   one useful question before searching.
7. **Search.** Answer the clarification. Verify the returned set has one to
   three products and that title, variant, price, availability, and URL match
   the current Shopify development catalog.
   Verify the response also contains a valid versioned `ExperienceDocument`
   without changing the existing storefront renderer.
8. **Compare.** Compare two results. Verify only products already present in
   the session are compared.
9. **Select.** Choose one exact available variant and quantity one. Sage must
   ask for explicit confirmation and must not change the cart yet.
10. **Confirm once.** Send the exact confirmation. Verify one mutation journal
    row progresses `requested -> started -> confirmed` and one cart line is
    present.
11. **Repeat confirmation.** Submit the same confirmation again. Verify the
    stored result is replayed and the cart quantity does not increase.
12. **Checkout handoff.** Request checkout. Verify the URL belongs to the
    approved Shopify shop and opens Shopify checkout. Stop before payment.
13. **Unknown-state exercise.** If a controlled transport timeout can be
    induced without risking another cart write, verify the state becomes
    `unknown` and no automatic provider fallback or cart retry occurs.
14. **Uninstall.** On a disposable installation only, uninstall and verify the
    webhook revokes/deletes shop credentials without exposing them. Otherwise
    leave this as a separately scheduled test.
15. **Proxy customization.** If the app proxy subpath or storefront primary
    domain differs from the defaults, verify bootstrap advertises the signed
    `path_prefix` endpoints and subsequent requests retain the persisted
    primary storefront origin.

### Required evidence

- Reviewed commit and deployment identifier.
- Store domain redacted to a non-secret identifier in reports.
- HTTP status for `/health` and `/health/db`.
- Session metadata only: token version, expiration presence, refresh timestamp,
  lease cleared, revocation status.
- Mutation journal metadata: operation, state transitions, confirmation ID,
  opaque idempotency key, timestamps. Exclude provider payloads and tokens.
- Cart line count before, after first confirmation, and after repeat.
- App Proxy path and credential transport shape, with the credential redacted.
- Checkout host and path shape, without customer data.
- Pass, fail, or blocked result for every step.

## Current run status

| Mode                | Status on 2026-08-01 | Reason                                                  |
| ------------------- | -------------------- | ------------------------------------------------------- |
| Deterministic local | PASS                 | One complete fixture journey passes                     |
| Development store   | NOT RUN              | No new remote mutation authority was assumed            |
| Production          | NOT RUN              | Production validation requires an approved deploy first |
