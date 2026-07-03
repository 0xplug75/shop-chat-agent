# Integrations

## Purpose

IntentCart orchestrates; other platforms execute. The Integration Fabric is the architectural boundary that defines which systems IntentCart connects to versus rebuilds — feeding commerce-intent data to the tools a merchant already trusts (Klaviyo for retention, GA4/PostHog for analytics, Make/n8n for automation) rather than becoming a competing CRM, marketing platform, or BI tool. See [Vision.md](./Vision.md#what-we-will-not-build) for the permanent boundary this rules out.

## Responsibilities

- **Connection management** — connect/disconnect a third-party service per shop, with credentials scoped to that shop.
- **Field mapping** — translate IntentCart's commerce-intent events into the shape each destination expects.
- **Sync status** — surface whether a connector is healthy, lagging, or failing, to the Merchant Console.
- **Delivery** — an outbound webhook/event dispatcher that fans events out to connected services without embedding every third-party SDK into the commerce runtime's hot path.

## Architecture: integration tiers

Integrations are tiered by when they earn their build cost, not by request order:

| Tier | Services | Rationale |
|---|---|---|
| **Tier 0 — launch-blocking** | Shopify, Anthropic | Nothing else blocks the core product. |
| **Tier 1 — revenue-adjacent** | Klaviyo (retention), GA4 / PostHog (analytics parity), Shopify Flow (native automation) | A merchant can point to attributed lift from these. |
| **Tier 2 — agency / power-user** | Make, n8n, HubSpot, generic outbound webhooks | Serves operators managing multiple stores or complex automations. |
| **Tier 3 — commodity** | Reviews, shipping, payment-specific connectors | Served by one generic webhook fabric, not bespoke per-vendor connectors. |

The ordering is deliberate: Tier 1 is prioritized because it's revenue-adjacent, not because it's technically easiest — a generic webhook (Tier 2/3) may well be simpler to build than a Klaviyo integration, but it doesn't move the needle on attributed revenue the way Tier 1 does. This follows [Vision.md](./Vision.md)'s "progressive disclosure over parallel bets" principle.

**Tier 1 depends on the Intelligence Layer.** Integrations consume an event stream; they don't generate one. Klaviyo, GA4, and Flow are all reached by forwarding events the Runtime already produces — which means the event/analytics architecture in [EventSystem.md](./EventSystem.md) and the Intelligence Layer in [Roadmap.md](./Roadmap.md) are the prerequisite, not the integrations themselves.

## Current Implementation

IntentCart's active integrations today are exactly Tier 0: **Shopify**, via the Storefront and Customer Account MCP endpoints (`app/mcp-client.js`), and **Anthropic**, via the Claude API (`app/services/claude.server.js`). This is confirmed by the dependency and configuration surface — `package.json` lists only the Anthropic SDK and Shopify app/session-storage packages, and `.env.example` declares exactly `CLAUDE_API_KEY`, `REDIRECT_URL`, and `SHOPIFY_API_KEY`.

The timeout/error instrumentation already in place on `app/mcp-client.js` (MCP request timing and outcome logging) and `app/services/claude.server.js` (Claude stream timing, timeout, and stop-reason logging) is a useful head start for Tier 1: it was added to make hung requests visible rather than to seed analytics, but it already has the shape — latency, error rate, timeout rate, per-call outcome — that the Intelligence Layer's AI-analytics surface will need. Tier 1 connectors and the generic Tier 2/3 webhook fabric are architected above and build on this foundation as the Intelligence Layer comes online.

The merchant configuration module (`app/merchant/`, see [MerchantConsole.md](./MerchantConsole.md#current-implementation)) has also staked out the connection-configuration shape ahead of any working connector: `merchant.config.json`'s `integrations` section declares `klaviyo`, `posthog`, `ga4`, `make`, and `n8n`, each validated with an `enabled` flag (`make`/`n8n` also carry a `webhookUrl` field), all currently `false`/empty. This is schema and defaults only — no outbound call reads these fields yet — but it's the per-shop connection state Tier 1 needs once the delivery mechanism below exists.

## Future Evolution

Building out Tier 1 requires three things in sequence:

1. **An event stream** — the Intelligence Layer (funnels, conversation analytics, commerce analytics; see `PRODUCT_ARCHITECTURE.md` §11) generating the events integrations will forward.
2. **Per-shop connection configuration** — API keys, field mappings, sync status — as a Merchant Console module (see [MerchantConsole.md](./MerchantConsole.md)).
3. **An outbound delivery mechanism** — a generic webhook/event dispatcher, since Klaviyo, GA4, and Flow are all reached via webhook or API call rather than by embedding their SDKs directly into the commerce runtime.

Tier 2 and Tier 3 follow the same pattern once Tier 1 is live: one generic webhook fabric serving Make, n8n, HubSpot, and commodity connectors, rather than bespoke integrations hand-built per vendor.

## Related documents

- [Vision.md](./Vision.md) — the permanent boundary on what IntentCart will not build
- [MerchantConsole.md](./MerchantConsole.md) — where per-shop integration configuration lives
- [EventSystem.md](./EventSystem.md) — the event architecture Tier 1+ integrations consume
- [Roadmap.md](./Roadmap.md) — sequencing relative to the Intelligence Layer and Merchant Console
