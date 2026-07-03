# Agents

## Purpose

The agent is the part of IntentCart shoppers actually talk to, and the part most tempting to over-trust with commerce facts it hasn't verified. This document defines what the current agent (Sage) is designed to do, which of its constraints are enforced by code versus by instruction, and the multi-agent architecture it extends into as the Runtime covers more of the shopper journey.

## Sage

Sage is the conversational agent, defined by a system prompt and a tool-use loop: the Anthropic Messages API is called once per conversational turn, in a loop that continues until `stop_reason: "end_turn"`, handing the model the available MCP tool list and letting it decide when to call a tool versus respond in text (`app/services/claude.server.js`).

### Responsibilities

Sage is instructed to:

- Understand shopper intent and help them discover products, compare options, select variants, add to cart, and reach Shopify checkout.
- Ask one concise clarifying question when intent is ambiguous, rather than guessing.
- Recommend 2–3 products, not long lists, and explain why each fits.
- Confirm the exact product, variant, and quantity before any cart-changing action.
- Translate Shopify business outcomes (`unavailable`, `not_found`, `requires_selling_plan`, `quantity_adjusted`, `requires_buyer_input`) into shopper-safe language.
- Stay in the chat flow and surface checkout links only when Shopify has actually returned or confirmed one.

Sage is instructed to never invent price, stock, variants, shipping, policies, cart contents, checkout URLs, or order state — every commerce fact must come from a Shopify tool result or from the `CommerceSession` context injected into the system prompt (see [CommerceSession.md](./CommerceSession.md)).

## Architecture: enforcement model

Sage's constraints sit on a spectrum from code-enforced (a hard gate the model cannot bypass) to prompt-instructed (a rule the model is told to follow). This is a deliberate design choice, not an inconsistency: constraints that touch money or inventory get a hard gate; constraints that shape tone and presentation are expressed as instructions, because the cost of a false positive (blocking a valid response) is higher relative to the cost of an occasional prompt-adherence slip.

| Constraint | Enforcement |
|---|---|
| Never call `update_cart` without explicit shopper confirmation | **Code-enforced** — see "The cart confirmation guardrail" below |
| Never invent price/stock/variant/policy facts | **Prompt-instructed** |
| Recommend 2–3 products, not long lists | **Prompt-instructed for prose; code-enforced for card rendering.** Two independent sources currently express this number: `AppConfig.tools.maxProductsToDisplay` (`app/services/config.server.js`) caps rendered product cards, and `shopping.recommendationRules.maxProducts` (`app/merchant/merchant.defaults.js`, merchant-editable via `merchant.config.json`) is injected into the system instruction as a merchant-configurable instruction to the model. Both default to 3 and are not yet unified — changing one does not change the other. |
| Translate raw Shopify outcomes into shopper-safe language | **Prompt-instructed today, with a code-assisted path defined** — `business-message-interpreter.server.js` classifies cart outcomes into safe language; see [CommerceSession.md](./CommerceSession.md#the-cart-adapter-path) for how this reaches the live cart flow |
| Never show raw JSON or internal session state | **Prompt-instructed** — the commerce context is serialized into the system prompt with an instruction not to repeat it verbatim |

[Vision.md](./Vision.md)'s "AI orchestrates, it does not invent" principle is the standard every row above is measured against. The cart-mutation gate meets it fully today; the remaining rows are the reason [MerchantConsole.md](./MerchantConsole.md)'s prompt compiler and [EventSystem.md](./EventSystem.md)'s Business Interpreter are both architected as ways to move more of this table from the left column to the right.

### The cart confirmation guardrail

`isConfirmedCartMutation()` in `app/routes/chat.jsx` is the hard code-level gate protecting cart mutations. Before any `update_cart` tool call reaches Shopify, it checks two things:

1. The shopper's raw message contains an explicit confirmation phrase (`yes`, `confirmed`, `i confirm`, `confirm it`, `go ahead`, `add it`, `add this`, `add both`, `add to cart`, plus French equivalents `ajoute`, `ajouter`, `oui`, `je confirme`, `vas-y`).
2. The tool arguments the agent generated are exact — every `add_items` entry has a concrete `product_variant_id` and a positive quantity, or every `update_items` entry has a concrete `id` and an integer quantity.

If either check fails, the tool call is blocked before it reaches Shopify: the model receives a synthetic tool-result message telling it the cart update was blocked and to ask for explicit confirmation, and a `requires_buyer_confirmation` business message is queued for the next turn. This exists because an agent confidently calling a mutating tool on a vague "yeah that sounds good" is a real failure mode in agentic commerce — which is why it's a hard gate rather than a prompt instruction.

## System prompt architecture

Three prompt variants are defined in `app/prompts/prompts.json`, selectable per store:

- `standardAssistant` — a generic helpful-store-assistant persona, no commerce-specific guardrails.
- `agenticBuyingAssistant` — the Sage persona described above; the default.
- `enthusiasticAssistant` — an energetic "Zara" persona, generic framing.

Only `agenticBuyingAssistant` encodes the commerce guardrails — grounding rules, confirmation requirements, business-message translation. `standardAssistant` and `enthusiasticAssistant` are earlier personas from before the commerce-session architecture was introduced; a store configured with either gets a capable conversational assistant without Sage's commerce discipline, which is why `agenticBuyingAssistant` is the default rather than one option among three equals.

The system instruction the model actually receives is layered from three sources, assembled in `buildSystemInstruction()` (`claude.server.js`): the selected static persona above, a merchant configuration block from `getMerchantConfig()` (`app/merchant/merchant.server.js`) — assistant name, personality, brand voice, recommendation max products, bundle strategy, out-of-stock policy — and the serialized `CommerceSession` context. The merchant configuration block is genuinely structured and merchant-editable (deep-merged from `merchant.defaults.js` over `merchant.config.json`, schema-validated, cached), which moves brand voice and a handful of shopping rules out of raw prompt text and into configuration. It does not yet replace persona *selection*: a merchant still picks one of three fixed personas rather than having the persona's tone and structure compiled from their configuration. [Vision.md](./Vision.md)'s "prompt engineering is an implementation detail" principle names the fuller target — see [MerchantConsole.md](./MerchantConsole.md#current-implementation) for exactly what the merchant configuration module covers today and what a full compiler still needs to add.

## Agent Profiles (Internal Roster)

**This section is internal and developer-facing only.** It documents how Sage's single responsibility today is expected to decompose into a coordinated roster of specialist agents as the Runtime matures. **The MVP exposes exactly one assistant, Sage, to merchants and shoppers.** None of the profile names, boundaries, or statuses below are merchant-facing product language — per [Vision.md](./Vision.md) and the runtime-invisibility principle that governs every merchant-facing surface in this project, a merchant should never see "Cart Agent" or "Supervisor Agent" anywhere in the product. Today, every one of these responsibilities is either a hat Sage wears inside its single tool-use loop, or a capability with no live behavior behind it at all.

| Profile | MVP status | Primary mapping today |
|---|---|---|
| Shopping Agent | Live (as Sage) | `catalog-adapter.server.js`, `PRODUCT_DISCOVERY`/`PRODUCT_DETAIL` |
| Catalog Agent | Live (as an adapter) | `catalog-adapter.server.js`, `tool.server.js` |
| Cart Agent | Partial | Guardrail live in `chat.jsx`; adapter pair built, unwired |
| Checkout Agent | Live | `checkout-adapter.server.js` |
| Policy Support Agent | Live | `policy-adapter.server.js` |
| Merchandising Agent | Partial | Config reaches the prompt; no adapter/logic |
| Analytics Agent | Future | Schema only, no instrumentation |
| Integration Agent | Future | Schema only, no delivery mechanism |
| Supervisor Agent | Partial | `intent-router.server.js` routes to adapters, not agents |

**Shopping Agent**
- Responsibility: discover and compare products against shopper intent — the general "help me decide" capability.
- Tools/capabilities: `search_catalog` via `catalog-adapter.server.js`; the `CommerceSession`'s `catalogResults`/`selectedProduct`.
- Guardrails: recommend at most 2–3 products (prompt-instructed, code-capped for card rendering); never invent price/stock/variant.
- MVP status: **Live**, but undifferentiated — this is simply what Sage does today for `PRODUCT_DISCOVERY`/`PRODUCT_DETAIL` intents. There is no separate process; it's Sage wearing this hat.

**Catalog Agent**
- Responsibility: search, retrieve, and normalize product data from Shopify — the data-access specialist beneath the Shopping Agent's reasoning.
- Tools/capabilities: the `search_catalog` MCP tool; `tool.server.js`'s `formatProductData`/`processProductSearchResult` normalization (tolerant of multiple wire shapes for options and variants).
- Guardrails: never fabricate a product or variant absent from the MCP response; cap results at `maxProductsToDisplay`.
- MVP status: **Live**, but as a stateless adapter function, not an agent with its own reasoning loop — called by both the intent pre-fetch and Sage's own tool-use loop.

**Cart Agent**
- Responsibility: resolve cart state changes (add/update/remove) and translate Shopify's cart outcomes into safe, accurate language.
- Tools/capabilities: `get_cart`/`update_cart` MCP tools; designed to run through `cart-adapter.server.js`'s `preserveAndUpdateCart` (full-cart-state preservation) and `business-message-interpreter.server.js`'s outcome classification (`quantity_adjusted`, `not_found`, `unavailable`, `requires_selling_plan`, `requires_buyer_input`).
- Guardrails: `isConfirmedCartMutation()` — no mutation without explicit shopper confirmation and an exact variant/quantity.
- MVP status: **Partial** — the confirmation guardrail is fully live and code-enforced (`chat.jsx`); the adapter/interpreter pair meant to own this responsibility is fully implemented but not wired into the live path (see [CommerceSession.md](./CommerceSession.md#the-cart-adapter-path)). Live cart handling today is a thinner inline path in `applyCommerceToolResult()`.

**Checkout Agent**
- Responsibility: resolve and surface a valid Shopify checkout URL once a cart is ready, and hand the shopper to Shopify's native checkout.
- Tools/capabilities: `checkout-adapter.server.js`'s `getCheckoutUrlFromCartOrCheckout`/`createCheckoutFromCart` (tolerant parsing across response shapes).
- Guardrails: never attempts to complete a purchase itself — only ever resolves and formats a link Shopify already returned or confirmed, per [Vision.md](./Vision.md#what-we-will-not-build)'s boundary against autonomous checkout.
- MVP status: **Live**, deliberately narrow — wired into both the `CHECKOUT_ACTION` intent pre-fetch and the cart-tool-result path.

**Policy Support Agent**
- Responsibility: answer shipping, returns, FAQ, and store-policy questions.
- Tools/capabilities: the `search_shop_policies_and_faqs` MCP tool via `policy-adapter.server.js`.
- Guardrails: never answers a policy question from model knowledge alone — always grounded in the MCP tool result.
- MVP status: **Live** — wired into the `POLICY_QUESTION` intent pre-fetch.

**Merchandising Agent**
- Responsibility: proactive selling decisions beyond direct search — bundle suggestions, bestseller prioritization, out-of-stock alternatives.
- Tools/capabilities: intended to read `shopping.bundleStrategy`, `shopping.bestsellerPriority`, and `shopping.outOfStockPolicy` from merchant config and act on them through dedicated logic or tool calls.
- Guardrails: recommendations must still respect `preferAvailableInventory` and the recommendation-count cap; never overrides the Cart Agent's confirmation gate.
- MVP status: **Partial** — the configuration fields are real, validated, and already reach Claude as plain-text lines in the system instruction ("Bundle strategy: X," "Out-of-stock policy: Y," via `buildSystemInstruction()`), but no dedicated bundling/merchandising logic, adapter, or MCP tool exists behind them. Today this is an instruction the model may or may not act on well, not a grounded capability — matching the gap named in [Roadmap.md](./Roadmap.md#mid-term-architecture).

**Analytics Agent**
- Responsibility: turn runtime events into merchant-facing insight — funnels, conversion assists, attach rate.
- Tools/capabilities: intended to consume the Event System / Business Interpreter's classified outcomes (see [EventSystem.md](./EventSystem.md)).
- Guardrails: none yet — no live behavior to guard.
- MVP status: **Future** — the only real trace today is `merchant.config.json`'s `analytics.enabled`/`analytics.events` schema (validated, defaulted, never populated by real instrumentation) and the incidental request-level timeout/error logging on `mcp-client.js`/`claude.server.js`, the closest thing to a seed (see [Integrations.md](./Integrations.md#current-implementation)).

**Integration Agent**
- Responsibility: deliver approved commerce events to external tools (Klaviyo, GA4, Flow, Make, n8n).
- Tools/capabilities: intended outbound webhook/API delivery, keyed off `integrations.*` config.
- Guardrails: only forwards events a merchant has explicitly enabled; never a two-way sync.
- MVP status: **Future** — `merchant.config.json`'s `integrations.{klaviyo,posthog,ga4,make,n8n}` fields exist, validated, all `enabled: false` by default; zero outbound delivery mechanism exists anywhere in the codebase today.

**Supervisor Agent**
- Responsibility: route a shopper's request to the right specialist, and enforce that no agent ever reaches Shopify directly — the coordination layer a real multi-agent roster needs.
- Tools/capabilities: intended to sit above the roster, consuming Business Interpreter output, dispatching to whichever profile above owns the relevant capability.
- Guardrails: the "no direct Shopify access" rule is enforced structurally (every agent already routes through an adapter), not by the Supervisor's own judgment — it coordinates, it doesn't grant exceptions.
- MVP status: **Partial** — there is no multi-agent coordination today because there is only one agent and one code path (`claude.server.js`'s tool-use loop). The closest real analogue is `intent-router.server.js`'s heuristic classification, which already performs a primitive version of "route this request to the right specialist" — except today it routes to *adapters*, not to *other agents*.

**Summary:** of the nine profiles, four are fully live today as capabilities Sage already performs or calls into (Shopping, Catalog, Checkout, Policy Support); three are partial — a real guardrail or routing primitive exists, but the fuller adapter, logic, or coordination layer is either unwired or absent (Cart, Merchandising, Supervisor); two are future — schema exists, no runtime capability does (Analytics, Integration). This mirrors [EventSystem.md](./EventSystem.md#layer-6--agent-orchestrator)'s Agent Orchestrator layer, refined here into nine specific profiles rather than that document's earlier five-item sketch (Shopping Agent, Product Expert, Cart Agent, Checkout Agent, Support Agent) — the two lists should be read as the same target architecture at different levels of detail, not as competing plans; this document is now the more current and more granular of the two.

## Future Evolution: Multi-Agent Orchestration

The single-agent, single-prompt design is the right shape for one conversational surface. As the Runtime extends across more of the shopper journey (see [Vision.md](./Vision.md)'s "one brain, many surfaces"), the architecture decomposes into the nine specialist profiles above, sharing one `CommerceSession`.

Every agent in this roster inherits the same non-negotiable as Sage: no direct line to Shopify. Each one routes through Commerce Session → Business Interpreter → Hydrogen Skills, per the Agent Orchestrator layer in [EventSystem.md](./EventSystem.md). That discipline is easiest to state before a second agent exists and easiest to erode once several do, which is why it's recorded here ahead of the multi-agent build rather than after.

The prerequisite for this roster is not more agents — it's the Merchant Console's Prompt & Rules module (see [MerchantConsole.md](./MerchantConsole.md)), since additional agents are most valuable once each is configurable per merchant rather than hardcoded like today's three presets. And regardless of how many profiles above ever become real, independent agents versus remaining hats one agent wears, the rule at the top of this section holds without exception: none of this roster is ever named to a merchant.

## Related documents

- [CommerceSession.md](./CommerceSession.md) — the state Sage is grounded in on every turn
- [MerchantConsole.md](./MerchantConsole.md) — the prompt compiler this section's system-prompt architecture points toward
- [Vision.md](./Vision.md) — the "AI orchestrates, it does not invent" principle this document measures Sage against
- [EventSystem.md](./EventSystem.md) — the multi-agent orchestration model this document's agent roster is drawn from
