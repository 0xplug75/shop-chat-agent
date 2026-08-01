# Shopify App Review test plan

Use only an approved development store and non-sensitive sample products. Do
not complete a paid order.

## Reviewer setup package

- Stable production application URL.
- Test store and reviewer credentials supplied through Shopify's secure review
  fields, never this repository.
- Exact installation steps.
- A published Theme App Extension release.
- One in-stock product with at least two variants.
- One out-of-stock product or variant.
- A short explanation: Sage recommends; Shopify owns product truth, cart, and
  checkout.

## Installation and authentication

1. Install from the Shopify review link.
2. Confirm the embedded app opens without leaving Shopify Admin.
3. Confirm navigation is exactly Home, Assistant, Widget, Knowledge, Commerce.
4. Close and reopen the embedded app to prove session-token authentication.
5. Reinstall after uninstall and confirm the shop returns to active state.
6. Confirm `APP_UNINSTALLED` invalidates admin sessions.
7. Verify privacy webhooks respond successfully for customer data request,
   customer redact, and shop redact fixtures.

Expected evidence: request IDs and webhook receipt IDs only. Do not capture
tokens or customer data.

## Merchant configuration

1. Home shows launch checklist and real integration health.
2. Assistant saves name, voice, welcome message, prompts, and approved provider
   preference.
3. Widget saves layout and behavior, then opens the Theme Editor for visual
   placement and appearance.
4. Knowledge identifies Shopify as catalog truth and distinguishes approved
   policies/documents from inactive sources.
5. Commerce saves recommendation cap, stock handling, mandatory confirmation,
   checkout strategy, and feature flags.
6. Refresh each page and confirm the saved value remains tenant-scoped.

## Theme App Extension

1. Activate the IntentCart app embed in Theme Editor and save the theme.
2. Verify the launcher on desktop and mobile.
3. Verify the widget uses the merchant's theme position/layout without layout
   overlap or horizontal overflow.
4. Confirm the browser calls the same-origin App Proxy by default.
5. Confirm an unsigned direct App Proxy request is rejected.
6. Confirm App Proxy POSTs carry the short credential in the JSON body, never
   in a URL, while direct backend calls use a bearer header.
7. Confirm expired widget credentials are refreshed without exposing a token.
8. Confirm a credential cannot read another anonymous visitor's conversation.

## Guided-selling journey

1. Enter an intentionally vague need and verify one useful clarification.
2. Answer with category, budget, or preference.
3. Verify one to three products from the current Shopify store.
4. Verify title, image, price, availability, variant, and canonical product URL
   match Shopify.
5. Request a comparison and verify only observed product facts are used.
6. Select a product, variant, and quantity.
7. Ask to add it to cart without confirming. Verify no cart mutation occurs.
8. Explicitly confirm the exact product, variant, and quantity.
9. Verify exactly one cart mutation and a Shopify-owned cart state.
10. Submit the same confirmation again and verify no duplicate line mutation.
11. Open the Shopify checkout handoff and stop before payment.

## Failure and safety cases

- Out-of-stock variant: explain and suggest current alternatives according to
  merchant policy.
- LLM timeout before tool execution: bounded retry/fallback may occur.
- Timeout after commerce side effect starts: no provider fallback or blind
  mutation retry; record `side_effect_unknown`.
- UCP capability absent: fail closed or hand back to Shopify; never invent the
  operation.
- Invalid UCP continuation URL: reject it.
- Cross-shop conversation, cart, or configuration identifier: return not found
  or forbidden without revealing existence.
- Same-shop, different-visitor conversation identifier: return not found or
  forbidden without revealing existence.
- Rate limit exceeded: return bounded public error and retry guidance.
- Database unavailable: readiness fails and widget writes fail closed.

## Privacy and data handling

1. Confirm logs do not contain Shopify access tokens, provider keys, cookies,
   customer email/address, or checkout URLs.
2. Confirm shopper messages and operational session state are isolated by
   shop.
3. Confirm recovery occurs only for the same anonymous visitor and never sends
   an external message without consent.
4. Confirm uninstall and shop-redact behavior match the documented retention
   policy before submission.

## Review completion criteria

- All installation and embedded navigation checks pass.
- Theme App Extension is visible and removable by the merchant.
- The full guided-selling flow reaches Shopify checkout without payment.
- No cart mutation occurs before exact confirmation.
- No fixture response appears in a non-test environment.
- Privacy webhooks and uninstall are verified.
- Screencast follows `docs/runbooks/SCREENCAST_CHECKLIST.md`.
- Any blocked item is disclosed in the review notes rather than described as
  functional.
