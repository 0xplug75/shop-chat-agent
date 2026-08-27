---
name: theme-app-extension-workflow
description: Inspect, build, or review IntentCart Shopify Theme App Extension work involving app embeds, blocks, Liquid, storefront JavaScript, CSS, Theme Editor settings, widget mounting, mobile behavior, accessibility, or runtime calls. Use this whenever a change touches extensions/chat-bubble or the storefront rendering boundary.
---

# Theme App Extension Workflow

## Goal

Keep the Shopify surface thin and portable. The extension mounts and renders
Sage; the server runtime decides; Shopify remains the commerce authority.

## 1. Establish The Real Surface

Read, at minimum:

- `shopify.app.toml`
- `shopify.web.toml`
- `extensions/chat-bubble/shopify.extension.toml`
- `extensions/chat-bubble/blocks/chat-interface.liquid`
- `extensions/chat-bubble/assets/chat.js`
- `extensions/chat-bubble/assets/chat.css`
- `app/routes/widget.bootstrap.jsx`
- `app/routes/widget.chat.jsx`
- `app/merchant/public-config.server.js`

Record whether each storefront surface is an app embed, app block, generated
asset, runtime endpoint, or documentation-only claim. Do not infer deployment
from the existence of a manifest or extension folder.

## 2. Apply The Ownership Matrix

| Concern | Owner |
|---|---|
| Placement, layout, launcher copy, colors, radius | Theme Editor |
| Intent, clarification, ranking, explanations | IntentCart runtime |
| Merchant behavior and commerce guardrails | IntentCart Admin/runtime |
| Products, variants, prices, inventory | Shopify |
| Cart, checkout, transaction outcome | Shopify through server adapters |

Reject a change when it creates a second owner. In particular, do not add a
storefront appearance editor to the Admin page or business decisions to Liquid.

## 3. Review Liquid As A Shell

Liquid may:

- declare Theme Editor settings;
- emit semantic widget markup and data attributes;
- load extension-owned CSS and JavaScript;
- expose non-secret shop and page context already available to the theme.

Liquid must not:

- parse intent or rank products;
- copy or persist a product catalog;
- choose variants or calculate authoritative prices;
- mutate cart or invent checkout state;
- embed secrets, long-lived tokens, or tenant identifiers supplied by a user;
- open the assistant on page load.

Keep schema labels clear, defaults conservative, and settings scoped to
presentation. Remove or deprecate any setting whose only effect is auto-open.

## 4. Review Storefront JavaScript

The storefront client may collect a shopper message, render a server-owned
experience, request explicit confirmation, and present a validated handoff.
It must not become a second agent or commerce engine.

Check these gates:

1. Bootstrap through the signed App Proxy boundary.
2. Bind short-lived credentials to shop, origin, visitor, and tenant context.
3. Never trust a shop or origin taken only from an unsigned body.
4. Use safe DOM APIs; avoid untrusted HTML insertion.
5. Keep the widget closed until the shopper opens it.
6. Treat contextual suggestions as passive launchers, not auto-open triggers.
7. Render no more than three recommendations when the runtime provides them.
8. Require exact product, variant, and quantity confirmation before mutation.
9. Validate checkout and product links against approved Shopify origins.
10. Fail visibly and safely; do not fall back silently to fixtures.

## 5. Preserve Theme Compatibility

- Scope selectors to the extension root.
- Avoid global resets and assumptions about theme typography or z-index.
- Use stable dimensions for launcher, panel, toolbar, and composer.
- Support 320, 390, 430, 768, and desktop widths where browser tooling exists.
- Respect safe-area insets and dynamic viewport height on mobile.
- Verify 200% zoom, reduced motion, visible focus, Escape, focus return, and
  screen-reader labels.
- Do not let hidden or loading content resize the storefront unexpectedly.

## 6. Validate In Increasing Cost Order

Run the narrowest local checks first:

```bash
npm test -- tests/contracts-and-streams.test.js
npm run lint
npm run typecheck
```

For a runtime or extension change, add the relevant broader checks:

```bash
npm test
npm run build
node scripts/run-theme-extension-browser-tests.mjs
```

Do not start `shopify app dev`, create a tunnel, link an app, or deploy without
the confirmation required by `.codex/rules/default.rules`. If Shopify CLI is
unavailable, record the exact local blocker instead of treating generated
bundles as live proof.

## 7. Report Evidence

For every conclusion use one of:

- **Observed**: present in current files.
- **Locally tested**: exercised by a named command in this run.
- **Remotely verified**: checked against an authorized live endpoint/store.
- **Documented**: stated in a file but not independently verified.
- **Inferred**: reasonable interpretation, explicitly labeled.
- **Unknown**: no accessible evidence.

Never upgrade local or generated evidence to a live deployment claim.
