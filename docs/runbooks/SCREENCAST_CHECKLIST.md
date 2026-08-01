# IntentCart screencast checklist

Target length: 5 to 8 minutes. Record on an authorized development store with
sample data. Hide browser extensions, credentials, environment variables,
request headers, customer information, and deployment consoles.

## Before recording

- [ ] Use the exact candidate commit recorded in the release ticket.
- [ ] Confirm `/health` and `/health/db` return 200.
- [ ] Confirm `/ucp/agent-profile` advertises only the intended capabilities.
- [ ] Confirm the Theme App Extension release is active.
- [ ] Reset the test visitor session and test cart.
- [ ] Prepare one in-stock multi-variant product and one out-of-stock case.
- [ ] Disable payment completion; the recording stops at Shopify checkout.
- [ ] Keep experimental flags at the values shown in the narration.

## Recording sequence

- [ ] Show the app embedded in Shopify Admin.
- [ ] Show exactly five navigation items: Home, Assistant, Widget, Knowledge,
      Commerce.
- [ ] Home: show launch state, integration health, and essential metrics.
- [ ] Assistant: change one harmless field, save, refresh, and show persistence.
- [ ] Widget: show the selected surface and open Theme Editor.
- [ ] Theme Editor: show the app embed enabled and its storefront placement.
- [ ] Knowledge: show Shopify catalog truth, policies/documents, provenance, and
      indexing/source status.
- [ ] Commerce: show maximum three recommendations, mandatory confirmation,
      provider/checkout choice, UCP flags, recovery, and kill switch.
- [ ] Storefront desktop: open the launcher and ask a vague shopping question.
- [ ] Answer the clarification and show no more than three current products.
- [ ] Compare two products and explain a concrete tradeoff.
- [ ] Select an exact product, variant, and quantity.
- [ ] Show that the first add-to-cart request asks for confirmation and does
      not mutate the cart.
- [ ] Confirm explicitly and show the resulting Shopify cart once.
- [ ] Open Shopify checkout and stop before payment.
- [ ] Repeat the critical viewport check on mobile.
- [ ] Verify in sanitized network tooling that App Proxy credentials never
      appear in URLs; do not reveal the credential value in the recording.

## Optional controlled experiment segment

- [ ] State that the contextual launcher is behind a per-shop flag.
- [ ] Show control and treatment in separate anonymous sessions.
- [ ] Show the per-session frequency cap.
- [ ] Show the kill switch returning all traffic to non-experimental behavior.
- [ ] Do not claim conversion uplift without a measured result.

## Safety segment

- [ ] Show an out-of-stock response and alternative.
- [ ] Show a rejected/changed confirmation returning to comparison.
- [ ] Explain that Shopify remains authoritative for price, stock, cart, and
      checkout.
- [ ] Do not show tokens, provider prompts, raw logs, or private customer data.

## Evidence to retain

- [ ] Recording date and candidate commit.
- [ ] Shopify app configuration/release version.
- [ ] Development store identifier in the private release ticket only.
- [ ] Desktop and mobile viewport sizes.
- [ ] Request IDs for the test journey.
- [ ] Test cart identifier in the private release ticket only.
- [ ] Result of duplicate-confirmation and uninstall tests.
