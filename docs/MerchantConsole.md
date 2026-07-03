# Merchant Console

## Purpose

Merchants configure business outcomes, not prompts. The Merchant Console is the architectural layer that translates a merchant's intent — "sound more formal," "never promise same-day shipping," "turn off the chat bubble on the checkout page" — into the system prompt, widget configuration, and rule set the Runtime actually consumes. It is the boundary that keeps prompt engineering an implementation detail rather than the product's primary interface, per [Vision.md](./Vision.md).

The Console is scoped strictly to configuration and observability of the Commerce Engine. It is not a general admin panel or BI tool, and per the architectural commitment in [Architecture.md](./Architecture.md#design-commitments-that-constrain-future-work), it never talks to Shopify directly for commerce actions — it only configures the Conversational Engine and the Widget layer, and it reads the Intelligence Layer rather than writing commerce state.

## Responsibilities

- **Brand** — voice, tone, colors, logo, sample phrases, forbidden words/claims.
- **Prompt & Rules** — system prompt template, guardrails, escalation rules (when to hand off to a human/email), what the AI is never allowed to promise (e.g. shipping dates it can't guarantee).
- **Widgets** — which surfaces are active, placement, style, per-surface copy.
- **Integrations** — connect/disconnect, field mapping, sync status (see [Integrations.md](./Integrations.md)).
- **Permissions** — team roles; for agencies, per-store scoping.
- **Analytics** — funnels and KPIs, a read surface over data the Intelligence Layer produces.
- **Experiments** — create, monitor, and conclude A/B tests, the write surface of the same Intelligence Layer.
- **Supervision** — observing live events, sessions, agent reasoning, tool calls, errors, and business decisions, so a merchant can audit what the AI is doing, not just configure it in advance. This is a distinct responsibility from Analytics, which reports aggregate outcomes rather than individual agent decisions — see [EventSystem.md](./EventSystem.md) for the event-driven architecture that makes supervision possible.

## Architecture

The Console sits between merchant intent and Runtime configuration as a **compiler, not a picker**: a function that takes structured merchant input (brand voice, tone parameters, forbidden claims, escalation rules) and generates the system instruction the Conversational Engine consumes, rather than offering a fixed menu of pre-written personas. This is the architectural distinction between "Prompt Studio" (which the product deliberately avoids — merchants should never write or select raw prompt text) and a proper Merchant Console (which compiles a prompt on the merchant's behalf from configuration they actually understand).

Config flows in one direction: **Merchant Console → Runtime → Widgets.** The Console owns the brand/voice/rules data model, persisted per shop, and exposes it through an admin UI built on Polaris Web Components. It never reaches into Shopify directly — every commerce action the Console might influence (a rule that blocks discounting below a threshold, for instance) is expressed as configuration the Conversational Engine and adapters respect, not as a direct mutation the Console performs itself.

## Current Implementation

Configuration today is expressed through three surfaces:

**The merchant configuration module** (`app/merchant/`) is the first working piece of the compiler architecture described above:

- `merchant.defaults.js` — the baseline configuration (assistant persona parameters, widget position/layout/colors/behavior, shopping rules, analytics event list, integration toggles).
- `merchant.config.json` — the editable override file, deep-merged over the defaults.
- `merchant.schema.js` — a dependency-free validator checked after merge, covering every top-level section (`assistant`, `widget`, `shopping`, `analytics`, `integrations`).
- `merchant.server.js` — exposes a single `getMerchantConfig()` function that merges, validates, freezes, and caches the result in memory. It is the only module that imports `merchant.config.json` directly; every consumer goes through the function, not the file. `merchant.server.js` names its own evolution path in comments — JSON today, Supabase later, same function signature throughout — and already exposes `clearMerchantConfigCache()` for a future admin save flow to call.

`app/services/claude.server.js` is the module's first consumer: `buildSystemInstruction()` calls `getMerchantConfig()` and appends an "authoritative" merchant block — assistant name, personality, brand voice, recommendation max products, bundle strategy, out-of-stock policy — after the selected static prompt preset and before the serialized `CommerceSession` context. This means the system instruction Sage receives today is layered from three sources: the persona text from `prompts.json`, the structured merchant block from `getMerchantConfig()`, and the commerce context — not a single static string.

The `widget`, `analytics`, and `integrations` sections of the schema are validated and populated with real defaults (e.g. `integrations.klaviyo.enabled`, `integrations.make.webhookUrl`) but have no runtime consumer yet — they're the reserved shape the Widget layer, the Intelligence Layer, and [Integrations.md](./Integrations.md)'s Tier 1 connectors will read once built.

**Theme-editor block settings** on the chat-bubble extension (`extensions/chat-bubble/blocks/chat-interface.liquid`) remain a separate, independent configuration surface — `chat_bubble_color`, `welcome_message`, the `system_prompt` persona dropdown, and `backend_url`. This predates the merchant configuration module and hasn't yet been unified with it: a merchant editing `merchant.config.json`'s `widget.colors.primary` today has no effect on the theme editor's `chat_bubble_color`, since nothing reads the former into the latter.

**`app/routes/app._index.jsx`**, the embedded Shopify admin route, remains the reserved location for the Polaris-based admin UI that will let a merchant edit `merchant.config.json`'s contents without a deploy; it currently renders the default Shopify app template scaffold.

Together, these realize a working slice of **Prompt & Rules** (structured, validated, mergeable configuration reaching the agent, rather than persona selection alone) and reserve the shape for **Widgets**, **Integrations**, and **Analytics**. Brand voice beyond the fields already in `assistant`, Permissions, Experiments, and Supervision remain architected above without a code counterpart. `merchant.config.json` is also single-tenant today — one file for the whole app, not one record per shop — which the Future Evolution section below addresses directly.

Environment configuration (`.env.example`: `CLAUDE_API_KEY`, `REDIRECT_URL`, `SHOPIFY_API_KEY`) remains infrastructure, not merchant-facing configuration, and stays out of scope for the Console.

## Future Evolution

1. **Per-shop persistence**, replacing the single repo-wide `merchant.config.json` with one configuration record per shop — the Supabase swap `merchant.server.js` is already designed for, behind the same `getMerchantConfig()` signature.
2. **A full prompt compiler**, generating the entire system instruction from structured configuration rather than appending a configuration block after a persona selected from `prompts.json`'s fixed three entries. Today's `agenticBuyingAssistant` persona is the natural zero-config default for the compiler's output, not something to migrate away from.
3. **A Polaris-based admin UI** built out under `app/routes/app._index.jsx`, reading and writing through `getMerchantConfig()` / a new `saveMerchantConfig()`, and calling `clearMerchantConfigCache()` on save.
4. **Widget management** consuming the `widget` section already defined in the schema — unifying it with the theme-editor block settings so a merchant configures bubble color and layout once, not twice — and spanning more than one surface as the widget ecosystem in [Vision.md](./Vision.md) grows.
5. **Permissions and roles**, for the agency persona described in `PRODUCT_ARCHITECTURE.md`.
6. **Analytics and Experiments surfaces**, consuming the `analytics` section already defined in the schema, downstream of the Intelligence Layer's event stream (see [Roadmap.md](./Roadmap.md) and [Integrations.md](./Integrations.md)).
7. **The Supervision surface**, downstream of the event-driven architecture in [EventSystem.md](./EventSystem.md).

## Sequencing note

Per [Vision.md](./Vision.md)'s "progressive disclosure over parallel bets" principle, this is not built as one large console. The Brand & Rules module is sequenced first because it unblocks the most value fastest, and the merchant configuration module in `app/merchant/` is that sequencing decision already underway — structured configuration reaching the agent before any admin UI exists to edit it. Widget management, permissions, analytics, experiments, and supervision are sequenced later, as more surfaces and more event volume make them worth building.

## Related documents

- [Agents.md](./Agents.md) — what the Prompt & Rules module compiles
- [Vision.md](./Vision.md) — "merchants configure business outcomes, not prompts"
- [Roadmap.md](./Roadmap.md) — sequencing
- [EventSystem.md](./EventSystem.md) — the event-driven foundation the Supervision module builds on
