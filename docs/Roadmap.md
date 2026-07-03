# Roadmap

## Purpose

Each document in this set describes one layer's architecture and its current expression in code. This document sequences the evolution across all of them, so "what to build next" has one answer instead of several independent ones. Sequencing follows [Vision.md](./Vision.md)'s "progressive disclosure over parallel bets" principle: prove one narrow path converts before expanding surface area.

## Current Implementation

The following is live, running as the production `/chat` request path:

- Conversational chat over SSE, with a single agent persona (Sage) — [Agents.md](./Agents.md).
- MCP-backed catalog, policy, and checkout-URL-resolution adapters, wired into the live request path — [Architecture.md](./Architecture.md#request-flow-what-actually-happens-on-a-chat-message-today).
- A heuristic (keyword-based) intent router driving pre-fetch behavior — [CommerceSession.md](./CommerceSession.md#intent-classification).
- A `CommerceSession` object reconstructed per turn from persisted message history — [CommerceSession.md](./CommerceSession.md).
- A hard code-level guardrail against unconfirmed cart mutations (`isConfirmedCartMutation`) — [Agents.md](./Agents.md#the-cart-confirmation-guardrail).
- Customer Account MCP auth flow (OAuth-style token exchange, DB-cached), for tools that require shopper identity.
- One shopper-facing surface: the floating chat bubble theme extension.
- Request-level timeout/error instrumentation on MCP and Claude calls, the seed of the future Intelligence Layer's AI-analytics surface (see [Integrations.md](./Integrations.md)).
- A merchant configuration module (`app/merchant/`) — schema-validated, deep-merged, cached configuration consumed today by the system-instruction builder in `claude.server.js` for assistant persona parameters and shopping rules; widget, analytics, and integration sections are validated and reserved for their future consumers — see [MerchantConsole.md](./MerchantConsole.md#current-implementation).

## Near-Term Architecture

The next phase of work, in dependency order:

1. **Wire the cart adapter into the live request path.** `cart-adapter.server.js` and `business-message-interpreter.server.js` are fully implemented and follow the same pattern as the catalog, policy, and checkout adapters — see [CommerceSession.md](./CommerceSession.md#the-cart-adapter-path). Routing cart operations through them surfaces accurate business outcomes (`quantity_adjusted`, `not_found`, `unavailable`, `requires_selling_plan`, `requires_buyer_input`) to the shopper using code that already exists.
2. **Merchant Console: full prompt compiler and admin UI.** The merchant configuration module now feeds structured fields into the system instruction; the remaining work is generating the persona itself from configuration (rather than appending a config block after one of three fixed presets), a per-shop (not single-tenant) storage layer, and the Polaris admin UI to edit it without a deploy — see [MerchantConsole.md](./MerchantConsole.md#future-evolution).
3. **Basic funnel analytics**, generalizing the request-level instrumentation already in place (see [Integrations.md](./Integrations.md#current-implementation)) into merchant-facing funnels and KPIs, consuming the `analytics` section already defined in the merchant configuration schema. This is also the prerequisite for Tier 1 integrations.
4. **One working experimentation primitive**, reusing the analytics event stream from (3) — assign a shopper to a variant at session start, tag every event with it, report lift against a merchant-chosen metric.
5. **Klaviyo + GA4 integration** (Integration Tier 1), consuming the `integrations` section already defined in the merchant configuration schema, once (3) produces events worth forwarding.

## Mid-Term Architecture

- **Widget ecosystem beyond the floating bubble** — side panel, embedded/inline section, collection-page assistant, product-page assistant, cart-drawer assistant — see [Vision.md](./Vision.md#the-runtime-is-the-product). Each is a new renderer over the same Commerce Session and Conversational Engine.
- **Recommendations and bundles**, extending the Commerce Engine with a dedicated adapter and MCP surface.
- **LLM- or embedding-based intent classification**, with today's heuristic router retained as a fast-path — see [CommerceSession.md](./CommerceSession.md#intent-classification).
- **Agency multi-store console** — per-store scoping and permissions in the Merchant Console.
- **Make/n8n generic webhook fabric** (Integration Tier 2/3) — see [Integrations.md](./Integrations.md).
- **Multi-agent decomposition** (Shopping Agent, Product Expert, Cart Agent, Checkout Agent, Support Agent) — see [Agents.md](./Agents.md#future-evolution-multi-agent-orchestration). Sequenced after Merchant Console configurability: additional agents are most valuable once each one is configurable per merchant.
- **A formal internal commerce schema** (Product/Variant/Cart/Checkout as an explicit, validated contract) — see [Architecture.md](./Architecture.md#adapter-layer-design-intent). This earns its cost once a second commerce backend besides Shopify is on the roadmap.

## Long-Term Architecture

- **Assisted checkout**, as Shopify's own AI-checkout extensibility primitives mature — see [Vision.md](./Vision.md#what-we-will-not-build) on why this is sequenced deliberately late.
- **Commerce session portability beyond Shopify**, once the formal commerce schema exists and a second backend is real.
- **A marketplace of merchant-built prompt/rule templates**, downstream of the Merchant Console's Brand & Rules module maturing into something merchants build on.
- **The event-driven, Hydrogen-based reactive architecture** in full, as described in [EventSystem.md](./EventSystem.md): Commerce Session as a continuously-updated Observable consumer, the Business Interpreter as a standing event subscriber, a true multi-agent orchestrator, and Merchant Console supervision of live agent reasoning. This is the largest architectural shift in this roadmap — a change in how state flows through the entire system, not an incremental feature — and it is sequenced last deliberately, after the nearer-term architecture above is in place.

## What IntentCart Will Not Build

Restated here because roadmap pressure is exactly when these get relitigated — see [Vision.md](./Vision.md#what-we-will-not-build) for the full reasoning:

- A custom no-code workflow builder (Make/n8n's job).
- A general BI tool (GA4/PostHog's job).
- Owned payments or shipping rails (Shopify's job).
- Multi-platform (non-Shopify) commerce support, before Shopify dominance is proven.
- Fully autonomous checkout, before Shopify's AI-checkout primitives mature.
- Generic customer-support ticketing (not Zendesk).

## Related documents

- [Vision.md](./Vision.md) — the principles this sequencing is checked against
- [Architecture.md](./Architecture.md) — detail behind every Near-Term/Mid-Term item
- [CommerceSession.md](./CommerceSession.md), [Agents.md](./Agents.md), [MerchantConsole.md](./MerchantConsole.md), [Integrations.md](./Integrations.md), [EventSystem.md](./EventSystem.md) — per-layer detail
