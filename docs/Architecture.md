# Architecture

> Historical implementation note. The current hardened architecture is
> documented in `docs/architecture-target.md`; the flow below describes the
> earlier MVP before tenant, orchestration, and PostgreSQL hardening.

## Purpose

This is the map from the product vision ([Vision.md](./Vision.md)) to the system that implements it. It names every layer, states what owns what, and separates the architecture itself from its current expression in code. Six months from now, this document should be enough to know where a given piece of behavior lives and why it's shaped the way it is.

## Architecture

The system has four layers, each with a single, non-overlapping responsibility:

```
Customer
   │
   ▼
Customer Experience Layer      — interfaces only, no commerce logic
   │
   ▼
Commerce Runtime                — intent, conversation, session, context (UI-independent)
   │
   ▼
Commerce Orchestrator           — adapters that talk to Shopify
   │
   ▼
Shopify (MCP / Admin)           — source of truth for all commerce facts
```

Config flows down (Merchant Console → Runtime → Widgets); events flow sideways into an Intelligence Layer (see [Roadmap.md](./Roadmap.md)). Nothing bypasses the Commerce Session — every layer either reads from it or writes to it.

This four-layer view is the request-scoped realization of the architecture. [EventSystem.md](./EventSystem.md) describes the same system reframed as a seven-layer, reactive, event-driven model built around Shopify's Hydrogen runtime and Agent Skills — the direction this architecture extends toward as surfaces multiply beyond a single chat widget.

## Current Implementation

Each layer's architectural role, mapped to where it's realized in code today:

| Layer | Realized as |
|---|---|
| Customer Experience — chat bubble | `extensions/chat-bubble/` (Shopify theme app extension) |
| Customer Experience — other surfaces (PDP, collection, quiz, cart drawer, checkout) | Architected in [Vision.md](./Vision.md#the-runtime-is-the-product); additional renderers over the same Runtime |
| Commerce Runtime — conversational engine | `app/services/claude.server.js`, `app/prompts/prompts.json` |
| Commerce Runtime — intent classification | `app/services/intent-router.server.js` (heuristic keyword matching; see [CommerceSession.md](./CommerceSession.md#intent-classification) for the evolution path) |
| Commerce Runtime — commerce session | `app/services/commerce-session.server.js` |
| Commerce Orchestrator — catalog adapter | `app/services/catalog-adapter.server.js`, wired into the live request path |
| Commerce Orchestrator — policy adapter | `app/services/policy-adapter.server.js`, wired into the live request path |
| Commerce Orchestrator — checkout adapter | `app/services/checkout-adapter.server.js`, wired into the live request path (URL resolution) |
| Commerce Orchestrator — cart adapter | `app/services/cart-adapter.server.js`, implemented at parity with the other adapters — see [CommerceSession.md](./CommerceSession.md#the-cart-adapter-path) for its current routing and near-term integration |
| Commerce Orchestrator — business message interpreter | `app/services/business-message-interpreter.server.js`, implemented; integration into the live cart flow tracked in [Roadmap.md](./Roadmap.md#near-term-architecture) |
| Shopify layer — Storefront MCP | `app/mcp-client.js` |
| Shopify layer — Customer Account MCP | `app/mcp-client.js`, `app/auth.server.js` |
| Merchant Console | Theme-editor block settings + `prompts.json` presets + the `app/merchant/` configuration module (assistant/shopping fields consumed today; widget/analytics/integrations fields validated and reserved) — full architecture in [MerchantConsole.md](./MerchantConsole.md) |
| Intelligence Layer (analytics + experimentation) | Request-level instrumentation today, the seed for the layer described in [Roadmap.md](./Roadmap.md) |
| Integration Fabric (Klaviyo, GA4, etc.) | Shopify + Anthropic today (Tier 0); tiering and evolution in [Integrations.md](./Integrations.md) |

## Request flow (what actually happens on a chat message today)

This is the real, current control flow through `app/routes/chat.jsx`, the single entry point for all chat traffic:

1. The theme extension (`extensions/chat-bubble/assets/chat.js`) POSTs the shopper's message to `/chat` with `X-Shopify-Shop-Id` and `Origin` headers identifying the store.
2. `chat.jsx` resolves the shop's Customer Account MCP/auth URLs (from the DB cache, or via Shopify's `.well-known` discovery endpoints on first contact) and constructs an `MCPClient` (`app/mcp-client.js`) pointed at that shop's Storefront MCP (`{shop}/api/mcp`) and Customer Account MCP endpoints.
3. The client connects to both MCP servers and fetches their tool lists (`tools/list`). Tool availability is per-shop and per-session — nothing is hardcoded beyond `AppConfig.tools` name constants (`app/services/config.server.js`).
4. `loadOrCreateCommerceSession()` (`app/services/commerce-session.server.js`) rehydrates prior conversation turns from SQLite into an in-memory `CommerceSession` object for this turn.
5. `intent-router.server.js` classifies the shopper's message into one of six intent types using keyword matching (no LLM call at this stage).
6. `runCommerceIntent()` in `chat.jsx` pre-fetches commerce facts *before* Claude is invoked at all, based on that intent — e.g. `PRODUCT_DISCOVERY` triggers a catalog search via `catalog-adapter.server.js` so Claude's first response can already ground itself in real product data instead of guessing and then correcting.
7. Claude is called (`claude.server.js`) with the full conversation history, the shop's MCP tool list, the selected system prompt (`app/prompts/prompts.json`), and the current `CommerceSession` state serialized into the system instruction as read-only context (never as a conversation turn — the Messages API rejects consecutive same-role turns).
8. If Claude requests a tool call, `chat.jsx`'s `onToolUse` handler calls `mcpClient.callTool()` directly for cart operations today (see [CommerceSession.md](./CommerceSession.md#the-cart-adapter-path) for how this relates to the cart adapter), applies a hard guardrail for `update_cart` specifically (see [Agents.md](./Agents.md#the-cart-confirmation-guardrail)), and folds the result back into the `CommerceSession` via `applyCommerceToolResult()`.
9. This loop repeats until Claude returns `stop_reason: "end_turn"`. Every response chunk, tool-use notice, and completed message is streamed to the client over SSE (`app/services/streaming.server.js`).
10. Product results surfaced during the turn (from the pre-fetch, from Claude's own tool calls, or both) are de-duplicated by product ID and sent to the client as a single `product_results` event for card rendering.

## Adapter layer design intent

Every adapter (`catalog-adapter.server.js`, `policy-adapter.server.js`, `cart-adapter.server.js`, `checkout-adapter.server.js`) exists to isolate one thing: **the Commerce Session and the Conversational Engine should never need to know they're talking to Shopify specifically.** The adapter resolves to Shopify MCP today, but the shape of the interface — a function that takes a commerce-native request and returns a commerce-native result — is what makes a future non-Shopify backend a swap-in rather than a rewrite. This is what [Vision.md](./Vision.md) means by "UCP-ready, not Shopify-forever": the shape is portable independent of how many backends currently implement it.

Today this portability is expressed as tolerant normalization rather than a formal schema: `tool.server.js`'s `formatProductData()` and the option-value normalizers (`normalizeProductOptions`, `normalizeSelectedOptions`, `formatOptionValue`) already accept more than one wire shape for the same field — an option value can arrive as a plain string or as a structured `{label, name, value, title}` object, and both are handled. A canonical `Product`/`Cart`/`Checkout` schema with a validation layer and capability negotiation is the natural next step in this investment — see [Roadmap.md](./Roadmap.md#mid-term-architecture) for when it earns its cost, which is once a second commerce backend is actually on the roadmap.

## Design commitments that constrain future work

- **No commerce state duplication.** `prisma/schema.prisma` only ever grows session/auth-adjacent models (`Conversation`, `Message`, `CustomerToken`, `CustomerAccountUrls`). A `Product` or `Cart` table appearing here is a signal something violated the architecture, not a feature to build.
- **The Commerce Session is the only place commerce state lives across a turn.** `getCommerceContext()` (`commerce-session.server.js`) is the single object serialized into every Claude call. If a new piece of state needs to survive across turns or across adapters, it goes on the session, not into a new ad hoc variable threaded through `chat.jsx`.
- **The Merchant Console never talks to Shopify directly for commerce actions.** Per [Vision.md](./Vision.md), it only configures the Conversational Engine and the Widget layer. It reads the Intelligence Layer; it doesn't call `mcpClient.callTool()`.
- **Tool timeouts are non-negotiable.** Every MCP request (`app/mcp-client.js` `_makeJsonRpcRequest`) and every Claude stream (`claude.server.js`) runs against a hard timeout. This was added after a production incident (see `AppConfig.api.claudeStreamTimeoutMs` and `AppConfig.mcp.*TimeoutMs` in `app/services/config.server.js`) where an unreachable MCP endpoint or a stalled Claude stream hung the entire chat request indefinitely with no error surfaced to the shopper. Any new outbound call in this codebase needs a timeout by default, not as an afterthought.

## Related documents

- [Vision.md](./Vision.md) — why this architecture exists, what it will never become
- [CommerceSession.md](./CommerceSession.md) — the state object every layer reads/writes
- [Agents.md](./Agents.md) — the conversational engine and its guardrails
- [MerchantConsole.md](./MerchantConsole.md) — the configuration and supervision surface
- [Integrations.md](./Integrations.md) — the integration fabric and its tiering
- [EventSystem.md](./EventSystem.md) — the reactive, event-driven architecture this request/response model extends toward
- [Roadmap.md](./Roadmap.md) — sequencing across every layer above
- [PRODUCT_ARCHITECTURE.md](./PRODUCT_ARCHITECTURE.md) — the frozen v1 product-level reference this document implements
