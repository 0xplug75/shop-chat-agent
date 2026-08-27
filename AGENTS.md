# AGENTS.md - IntentCart Shopify Distribution Lab

This repository is the Shopify distribution surface and production-runtime
candidate for IntentCart. Its job is to install and render Sage on Shopify
without moving intent, ranking, or commerce decisions into the theme.

> Sage recommends. Shopify transacts.

## Scope

- Work only in this repository unless the user explicitly requests a
  cross-repository promotion.
- Treat other labs and consolidation documents as read-only references.
- Preserve user changes and generated deployment evidence.
- Do not deploy, change OAuth scopes, rotate credentials, or mutate a remote
  Shopify store while following these instructions.
- Never read or print secret values. Environment audits list names and roles
  only.

## Required Reading

Read these files before changing a Shopify-facing boundary:

1. `docs/agent-system/LAB_ROLE.md`
2. `docs/agent-system/LAB_CAPABILITY_REPORT.md`
3. `docs/agent-system/LAB_PROMOTION_MANIFEST.md`
4. `docs/agent-system/VALIDATION_REPORT.md`
5. `shopify.app.toml`
6. `extensions/chat-bubble/blocks/chat-interface.liquid`
7. `extensions/chat-bubble/assets/chat.js`
8. `app/security/app-proxy-context.server.js`
9. `app/services/cart-adapter.server.js`

## Fixed Admin Navigation

The embedded Shopify Admin navigation is frozen to exactly:

- Home
- Assistant
- Widget
- Knowledge
- Commerce

Do not add another primary page. Put new detail behind these five surfaces.

## Authority Boundaries

| Concern | Authority | Surface responsibility |
|---|---|---|
| Intent, clarification, ranking, explanation | IntentCart runtime | Render server-owned outcomes |
| Product, variant, price, inventory | Shopify | Display current, attributed data |
| Cart and checkout | Shopify through server adapters | Ask for confirmation and render handoff |
| Placement and appearance | Shopify Theme Editor | Apply block settings without duplicating them in Admin |
| Merchant behavior and guardrails | IntentCart Admin/runtime | Persist tenant-scoped policy |
| Visitor context | Signed App Proxy plus short-lived widget token | Carry only the minimum context |

## Storefront Invariants

1. The Theme App Extension is a thin shell. Liquid contains no intent parser,
   ranker, recommendation engine, or catalog copy.
2. `autoOpen` is always false. The widget is closed on initial load and opens
   only after a shopper action. A contextual suggestion may render a passive
   launcher, but it must not open the assistant.
3. Theme Editor owns placement, layout, launcher copy, colors, radius, and
   storefront appearance. The Admin dashboard must not offer a second editor
   for the same settings.
4. Shopify remains authoritative for product, variant, price, stock, cart,
   checkout URL, and transaction outcome.
5. No cart mutation occurs without explicit confirmation of product, variant,
   and quantity.
6. Every public widget request is tied to a verified shop, origin, visitor,
   and short-lived credential. Tenant identity is never accepted from an
   unsigned request body alone.
7. Checkout URLs are validated as Shopify URLs before they are rendered or
   followed.
8. Fixtures are test-only and never silently replace a failed live response.
9. Errors fail closed for mutations and remain understandable to the shopper.
10. Keyboard, focus, reduced-motion, safe-area, mobile viewport, and theme CSS
    compatibility are release gates.

## Source Map

| Area | Canonical path |
|---|---|
| Shopify app configuration | `shopify.app.toml`, `shopify.web.toml` |
| Embedded Admin shell | `app/routes/app.jsx` |
| Merchant configuration | `app/merchant/` |
| App Proxy routes | `app/routes/widget.*.jsx` |
| Public trust boundary | `app/security/`, `app/security/widget-token.server.js` |
| Theme app embed | `extensions/chat-bubble/blocks/chat-interface.liquid` |
| Storefront behavior | `extensions/chat-bubble/assets/chat.js` |
| Storefront styles | `extensions/chat-bubble/assets/chat.css` |
| Cart and checkout adapters | `app/services/cart-adapter.server.js`, `app/services/checkout-adapter.server.js` |
| Shopify session storage | `app/services/shopify-session-storage.server.js` |
| Webhooks | `app/routes/api.webhooks.jsx`, `app/services/webhook.server.js` |
| Data model and migrations | `prisma/schema.prisma`, `prisma/migrations/` |
| Tests | `tests/`, `scripts/run-theme-extension-browser-tests.mjs` |

## Specialized Agents

- `shopify_surface_explorer`: read-only inventory of installation, app proxy,
  extension, available context, data ownership, and deployment evidence.
- `shopify_surface_builder`: small, tested adapter and Theme App Extension
  changes that preserve the runtime boundary.
- `shopify_surface_reviewer`: read-only security, scope, Liquid, accessibility,
  mobile, theme compatibility, and live-boundary review.

Agent configurations live in `.codex/agents/`.

## Local Skills

- `$theme-app-extension-workflow`: app embed, Liquid, JavaScript, Theme Editor,
  accessibility, and storefront validation workflow.
- `$shopify-live-boundary-check`: Shopify authority, signed context, sessions,
  cart confirmation, checkout handoff, and evidence classification.

## Working Method

1. Inspect the current branch, worktree, applicable instructions, and real
   files before relying on historical documentation.
2. Classify claims as observed, locally tested, remotely verified, documented,
   inferred, or unknown.
3. Run the live-boundary check before editing any OAuth, App Proxy, catalog,
   variant, cart, checkout, or webhook path.
4. Keep patches small and add tests proportional to the boundary changed.
5. Run the relevant local validation and record anything blocked by credentials,
   unavailable stores, a broken Shopify CLI, or unapproved remote access.

## Command Safety

- Shopify information commands may run locally.
- Local development commands require confirmation when they can apply
  migrations, create tunnels, or persist remote configuration.
- `shopify app deploy` always requires explicit user approval.
- Credential and environment-linking commands always require approval.
- Destructive commands are forbidden.

Project command policy is defined in `.codex/rules/default.rules`.

## Validation

For agent-system-only changes:

```bash
python3 -m json.tool docs/agent-system/LAB_MINI_ME.json
python3 -c 'import pathlib,tomllib; [tomllib.loads(p.read_text()) for p in pathlib.Path(".codex/agents").glob("*.toml")]'
python3 /path/to/skill-creator/scripts/quick_validate.py .agents/skills/theme-app-extension-workflow
python3 /path/to/skill-creator/scripts/quick_validate.py .agents/skills/shopify-live-boundary-check
codex execpolicy check --pretty --rules .codex/rules/default.rules -- shopify app deploy
```

For runtime changes, use the narrowest relevant test first, then run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Run browser and real-store checks only when their prerequisites are available
and the action is explicitly authorized. A local test is not proof of a live
Shopify installation or completed checkout.
