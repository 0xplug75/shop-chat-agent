# IntentCart

## Architecture baseline (2026-07-31)

The security and persistence foundation now uses a signed Shopify App Proxy
bootstrap, origin-bound widget credentials, a central merchant context,
PostgreSQL Prisma models, per-shop configuration, durable commerce sessions,
typed tools, an LLM gateway, tenant-filtered knowledge retrieval, append-only
events, encrypted customer tokens, one-shot OAuth state, and idempotent Shopify
webhooks. The authoritative implementation map is
`docs/architecture-target.md`; deployment and migration procedures are under
`docs/deployment/` and `docs/data/`.

The remaining sections preserve product and UI maturity context. Where older
storage/runtime statements conflict with the architecture baseline above, the
baseline and source code are authoritative.

## Current vision

IntentCart is an AI commerce layer for Shopify merchants.

The product turns a storefront chat experience into a guided commerce session: a shopper describes what they want, the assistant searches the real Shopify catalog, recommends relevant products, confirms variants and quantity, updates the Shopify cart, and hands the shopper back to Shopify checkout.

Shopify remains the source of truth for products, price, inventory, cart, checkout, policies, orders, and customer context. IntentCart owns the conversation, orchestration, merchant configuration, and assistant experience around that commerce state.

The long-term direction is an AI Commerce Operating System for Shopify: assistant behavior, storefront presentation, knowledge sources, commerce rules, analytics, and integrations become merchant-configurable without exposing internal runtime concepts to the merchant.

---

## Current architecture

### Merchant Configuration System

Responsibility:
- Provides the single runtime entry point for merchant-owned settings through `getMerchantConfig()`.
- Loads JSON configuration, merges defaults, validates the result, and returns a safe fallback if configuration is invalid.
- Keeps the rest of the app isolated from the current JSON storage source so Supabase can replace JSON later without changing runtime consumers.

Current maturity:
- Working foundation.
- Used by the Claude system instruction, the read-only merchant dashboard, and the public storefront config endpoint.
- Single-tenant JSON for now, not per-shop persistence.

Dependencies:
- `app/merchant/merchant.defaults.js`
- `app/merchant/merchant.config.json`
- `app/merchant/merchant.schema.js`
- `app/merchant/merchant.server.js`

### Commerce Session Engine

Responsibility:
- Tracks the active shopping conversation as a commerce session, not just a chat transcript.
- Owns session state such as messages, intent, catalog results, selected product, selected variant, cart ID, cart snapshot, checkout URL, buyer context, and pending business messages.
- Clears stale pending product context when a new product discovery intent is detected.

Current maturity:
- MVP-ready session orchestration layer.
- Request-scoped runtime object with message rehydration from persisted chat history.
- Prepared for richer per-session persistence later.

Dependencies:
- `app/services/commerce-session.server.js`
- `app/services/intent-router.server.js`
- `app/routes/chat.jsx`
- `app/db.server.js`

### Widget Runtime

Responsibility:
- Runs the shopper-facing storefront experience.
- Renders compact bubble, side-panel, inline, and fullscreen shopping modes, plus messages, quick actions, product cards, cart state, and checkout handoff.
- Resolves the backend URL from theme settings and loads storefront-safe merchant config from the public config endpoint.

Current maturity:
- MVP-ready and tested on a real Shopify dev store.
- Real catalog search, product cards, cart update, and checkout link handoff work.
- All four storefront layouts have browser-checked desktop and mobile states.
- The launcher, panels, composer, and close actions expose keyboard and screen-reader semantics.
- Shopper-facing progress hides internal tool names and arguments.
- Development backend tunnel still requires manual Theme Editor update when the Shopify CLI tunnel changes.

Dependencies:
- `extensions/chat-bubble/assets/chat.js`
- `extensions/chat-bubble/assets/chat.css`
- `extensions/chat-bubble/blocks/chat-interface.liquid`
- `app/routes/merchant.config.jsx`
- `app/routes/chat.jsx`

### Claude Runtime

Responsibility:
- Produces the assistant response using factual commerce context and tool results.
- Injects merchant assistant settings into the system instruction.
- Enforces assistant behavior such as using Shopify data as source of truth, asking clarifying questions, recommending a small set of products, and requiring confirmation before cart actions.

Current maturity:
- Live and MVP-ready.
- Uses Anthropic streaming with timeout protection.
- Still uses fixed prompt presets plus merchant configuration rather than a full prompt compiler.

Dependencies:
- `app/services/claude.server.js`
- `app/prompts/prompts.json`
- `app/merchant/merchant.server.js`
- `app/services/tool.server.js`

### MCP Layer

Responsibility:
- Connects IntentCart to Shopify commerce tools.
- Lists available tools and calls catalog, policy, cart, checkout, and customer account capabilities where available.
- Keeps commerce data grounded in Shopify instead of model-generated assumptions.

Current maturity:
- MVP-ready for catalog search, policy search, cart updates, and checkout URL extraction.
- Customer account functionality exists behind token availability.
- Cart adapter abstraction exists, but the live cart path still has some direct wiring in `chat.jsx`.

Dependencies:
- `app/mcp-client.js`
- `app/services/catalog-adapter.server.js`
- `app/services/policy-adapter.server.js`
- `app/services/cart-adapter.server.js`
- `app/services/checkout-adapter.server.js`
- `app/services/business-message-interpreter.server.js`
- `docs/architecture-notes/cart-adapter-wiring-gap.md`

### Merchant Dashboard

Responsibility:
- Provides the embedded Shopify admin surface for the merchant.
- Presents the current assistant, storefront, knowledge, and commerce configuration in merchant-friendly language.
- Establishes the information architecture for the future Merchant OS.

Current maturity:
- Read-only operational embedded app with real sub-routes.
- `/app` is the launch and status home.
- `/app/assistant`, `/app/widget`, `/app/knowledge`, and `/app/commerce` are focused domain pages.
- Shopify App Bridge owns primary navigation in the admin sidebar; page bodies do not repeat it.
- Links directly to the active theme's App embeds editor, the storefront preview, and Shopify products.
- The Widget page includes an interactive desktop/mobile preview of all four widget modes.
- Does not yet edit or persist settings from the UI.

Dependencies:
- `app/routes/app._index.jsx`
- `app/routes/app.{assistant,widget,knowledge,commerce}.jsx`
- `app/components/intentcart/dashboard-ui.jsx`
- `app/merchant/dashboard.server.js`
- `app/styles/intentcart-dashboard.module.css`
- `app/merchant/merchant.server.js`

### Theme Extension

Responsibility:
- Packages the storefront widget for Shopify themes.
- Exposes merchant-settable layout, position, launcher, appearance, welcome, and entry-behavior settings.
- Loads widget assets on the storefront.

Current maturity:
- Installable and visible in the Shopify Theme Editor.
- Works on the real dev storefront.
- Offers compact button, floating assistant, inline shopping block, and fullscreen shopping modes.
- Keeps the raw assistant prompt out of Theme Editor settings.
- Still depends on manual backend URL configuration during local Shopify CLI development.

Dependencies:
- `extensions/chat-bubble/shopify.extension.toml`
- `extensions/chat-bubble/blocks/chat-interface.liquid`
- `extensions/chat-bubble/assets/chat.js`
- `extensions/chat-bubble/assets/chat.css`

### Public Merchant Config Endpoint

Responsibility:
- Exposes only storefront-safe merchant configuration.
- Prevents private, internal, integration, analytics, and runtime configuration from leaking to the storefront.
- Provides CORS-safe access for the widget.

Current maturity:
- Implemented and validated.
- Read-only.

Dependencies:
- `app/routes/merchant.config.jsx`
- `app/merchant/merchant.server.js`
- `app/cors.js`

### App Routes

Responsibility:
- Host the Shopify embedded app, authentication, webhooks, public config, and chat endpoint.

Current maturity:
- MVP-ready for local development and dev-store testing.
- `chat.jsx` remains the main commerce request route and is intentionally kept as the integration point for the current MVP.

Dependencies:
- `app/routes/app.jsx`
- `app/routes/app._index.jsx`
- `app/routes/chat.jsx`
- `app/routes/merchant.config.jsx`
- `app/routes/auth.callback.jsx`
- `app/routes/auth.token-status.jsx`
- `app/routes/auth.$.jsx`
- `app/routes/api.webhooks.jsx`

---

## What is production-ready

- Shopify app project structure and extension packaging.
- Shopify CLI development and deployment flow.
- Merchant Configuration System boundary through `getMerchantConfig()`.
- Configuration validation, default merging, and fail-safe fallback.
- Public storefront-safe merchant config projection.
- CORS helper usage for public widget endpoints.
- Fetch and tool timeout helpers for avoiding infinite loading states.
- Read-only Merchant OS dashboard information architecture.
- Operational setup checklist and Theme Editor activation deep link.
- Theme extension installation path.
- Four responsive widget layouts with a shared runtime.
- Product architecture documentation direction.

This does not mean the full commercial product is production-ready. It means these foundations are stable enough to build on without rethinking the architecture.

---

## What is MVP-ready

- Storefront widget appears on a real Shopify dev store.
- Shopper can open the chat experience from the widget.
- Chat request reaches the backend through the Shopify CLI tunnel.
- Claude responds in the storefront chat.
- Shopify MCP tools are listed and called.
- Real Shopify catalog search works.
- Product cards render with real images, titles, prices, availability, variants, and readable options.
- Cart update works after explicit shopper confirmation.
- Checkout or cart URL is exposed after a successful cart update.
- Merchant public config endpoint is available.
- Embedded Shopify app pages display the current assistant, widget, knowledge, and commerce behavior.
- Theme Editor controls visual widget settings without exposing runtime concepts.

---

## What is intentionally incomplete

### Supabase

Deferred because the JSON-backed Merchant Configuration System is validating the configuration shape first. The runtime already goes through `getMerchantConfig()`, so storage can move to Supabase later without changing consumers.

### Analytics

Deferred because the MVP commerce flow needed to work before collecting or displaying event data. The next step is a real event contract and event sink, not fake dashboard metrics.

### Integrations

Deferred because integrations such as Klaviyo, PostHog, GA4, Make, and n8n need a stable event model first. Configuration placeholders exist, but no outbound delivery is implemented yet.

### Knowledge uploads

Deferred because current knowledge sources are the real Shopify product catalog and store policies or FAQs. Uploaded documents, help center imports, and custom knowledge require storage, permissions, indexing, and merchant controls.

### Activity

Deferred because there is not yet a persisted activity/event stream. Building an Activity page before the event contract would create fake or misleading product surface.

### AI Copilot

Deferred because the Merchant OS must first support validated editable configuration. A copilot should act on real merchant settings, not on a mock admin surface.

### Performance

Deferred because no production analytics pipeline exists yet. Performance insights should come from real collected events, not static sample data.

### Connections

Deferred because integrations need delivery contracts, authentication, retries, and logs. The current app should not show connection pages before those foundations exist.

### Advanced checkout and order flows

Deferred by MVP boundary. Embedded checkout, Shop Pay handlers, Order MCP, order webhooks, and post-purchase automation are later phases.

---

## Technical debt

### Critical

- None known at the architecture level after this pass.

### Medium

- Development backend URL is still manual in the Theme Editor. Every new Shopify CLI tunnel can require updating the `Backend URL` setting.
- Cart adapter and business-message interpreter exist, but the live cart path still has direct wiring in `chat.jsx`.
- Merchant configuration is single-tenant JSON, not per-shop persisted configuration.
- Fixed prompt presets still coexist with merchant configuration; there is no dedicated prompt compiler yet.
- Some debug logging remains intentionally verbose from live MVP validation.

### Future

- Canonical product, cart, and checkout response schemas should be formalized beyond tolerant normalization.
- Public config projection and widget config consumption need automated tests.
- The four widget modes need automated visual regression coverage in addition to the local browser preview.
- Analytics and integration event contracts are not defined yet.
- Dashboard is read-only and has no validation-backed save flow.

---

## Product debt

- Merchant dashboard does not yet let merchants edit assistant or storefront settings.
- Widget visual settings live in Theme Editor and are not yet mirrored as editable Merchant OS settings.
- Backend URL setup is too manual for a merchant-facing product.
- The launch checklist is present, but there is no persisted onboarding completion state.
- Knowledge and commerce sections explain behavior but do not yet provide controls.
- No merchant-facing activity history exists for conversations, recommendations, or cart actions.

---

## Next engineering priorities

### Sprint 4

1. Stabilize the backend URL story with app proxy or hosted backend configuration so merchants do not paste development tunnels.
2. Finish routing live cart behavior through the cart adapter and business-message interpreter, or keep the documented exception explicit.

### Sprint 5

3. Define a read-only event contract and minimal server-side event sink for existing MVP events.
4. Prepare per-shop merchant configuration persistence behind `getMerchantConfig()` without changing consumers.

### Sprint 6

5. Build the first editable Merchant Console slice for Assistant and Storefront settings only, with validation and cache invalidation.

---

## Architecture principles

- Merchant-facing surfaces must not expose runtime concepts such as MCP, UCP, Commerce Session, or orchestration internals.
- Merchant Configuration is the single source of truth for merchant-owned behavior.
- Runtime consumers must call `getMerchantConfig()` instead of reading config files directly.
- Shopify remains the source of truth for commerce state.
- The LLM communicates and reasons, but it does not own price, stock, cart, checkout, policies, or order state.
- Cart mutations require explicit shopper confirmation of item, variant, and quantity.
- Public storefront endpoints expose only storefront-safe data.
- The dashboard is a merchant control surface, not a runtime debugger.
- The widget is a presentation layer, not the owner of commerce logic.
- New storage, analytics, and integrations should fit behind existing boundaries instead of changing the runtime contract.

---

## Folder map

```text
app/
  merchant/
  routes/
  services/
  styles/
  db.server.js
  shopify.server.js

extensions/
  chat-bubble/
    assets/
    blocks/

docs/
  architecture-notes/

prisma/

preview/

public/
```

### `app/merchant/`

Merchant configuration layer. This is the only place that should know whether config currently comes from JSON, Supabase, cache, or another backing store.

### `app/routes/`

React Router routes for the embedded Shopify app, authentication, webhooks, public merchant config, and chat endpoint.

### `app/services/`

Runtime services for Claude, commerce session state, intent routing, Shopify MCP tools, catalog, policy, cart, checkout, streaming, and tool normalization.

### `app/styles/`

CSS modules for embedded app surfaces, including the Merchant OS dashboard.

### `extensions/chat-bubble/`

Shopify theme extension that injects the shopper-facing widget into storefront themes.

### `extensions/chat-bubble/assets/`

Browser runtime and CSS for the widget.

### `extensions/chat-bubble/blocks/`

Theme block definition and settings exposed in the Shopify Theme Editor.

### `docs/`

Product, architecture, roadmap, integration, agent, merchant console, commerce session, and implementation notes.

### `docs/architecture-notes/`

Focused notes for known architectural gaps or implementation decisions that should not be hidden in code comments.

### `prisma/`

Database schema and migrations for Shopify app/session persistence.

### `preview/`

Local static preview for widget iteration outside the Shopify storefront.

### `public/`

Static assets served by the app.

---

## Final repository status

IntentCart currently has a coherent Shopify AI commerce foundation:

- A storefront widget that works on a real Shopify dev store.
- A chat endpoint connected to Claude and Shopify MCP tools.
- A Commerce Session Engine that tracks shopping context.
- Product discovery, product cards, cart confirmation, cart update, and checkout handoff.
- A Merchant Configuration System with defaults, validation, public projection, and future storage isolation.
- A read-only Merchant OS dashboard inside the Shopify admin.
- Product and architecture documentation that matches the current direction.

What remains is not a rewrite. The next work should harden deployment, persistence, events, and merchant editing around the existing boundaries.

Do not change the core direction:

- Do not make the LLM the owner of commerce state.
- Do not bypass `getMerchantConfig()` for merchant-owned settings.
- Do not expose internal runtime language in merchant-facing UI.
- Do not build fake analytics or fake integrations.
- Do not redesign the MVP before stabilizing backend URL, cart adapter wiring, events, and per-shop configuration.
