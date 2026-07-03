# IntentCart — Product Architecture Document

**Status:** Frozen v1 — this is the reference document for what IntentCart is, and just as importantly, what it is not. Every future feature request gets tested against this before it gets built.

---

## 1. Product Vision

IntentCart is the **AI Commerce Layer for Shopify** — the orchestration layer that sits between a shopper's intent and Shopify's commerce primitives (catalog, cart, checkout, customer).

It is not a chat widget with a Shopify integration bolted on. It is a merchant-configurable commerce agent that becomes the primary interface for high-intent moments — discovery, comparison, guided buying, cart resolution — while deliberately deferring to Shopify's native UX for what Shopify already does best (browsing, payment, fulfillment).

The test for "is this IntentCart": *does this feature move a shopper closer to checkout with less friction than the store's default experience?* If not, it doesn't belong here, regardless of how interesting it is.

## 2. Mission

Give every Shopify merchant — regardless of engineering headcount — an AI-native shopping assistant that:

1. Speaks in the merchant's actual brand voice, not a generic bot voice.
2. Reasons over the *live* catalog, inventory, and policies via MCP — never hallucinated product data.
3. Closes sales through guided conversation instead of passive browsing.
4. Gets measurably better over time, on data the merchant owns and can see.

## 3. Core Principles

These are the six rules every roadmap decision gets checked against.

1. **Commerce-native, not chat-native.** IntentCart is not a general-purpose chatbot toolkit. Every feature must have a commerce outcome (conversion, AOV, retention) — not just "engagement."
2. **One brain, many surfaces.** The conversational engine and commerce session are singular. Floating bubble, side panel, inline widget, quiz, embedded section — these are *rendering choices* on top of one engine, not seven separate products.
3. **UCP-ready adapter architecture, not Shopify-forever.** Anchor on Shopify today via Storefront MCP + Customer Account MCP. But the adapter layer (catalog/cart/checkout/policy) must stay platform-agnostic in shape, because portability is the long-term moat (see §9a, §16).
4. **The merchant owns the brain.** Brand voice, tone, escalation rules, upsell policy — all configurable without code, in the Merchant Console. IntentCart should never sound like a generic AI.
5. **Every conversation is measurable.** No feature ships without an analytics event attached. Experimentation is a first-class primitive from day one, not a bolt-on after the fact.
6. **Progressive disclosure over parallel bets.** Prove one narrow path — conversational product discovery → cart — converts, before expanding the surface area. Do not run five half-built surfaces at once.

## 4. Personas

| Persona | Wants | Fears |
|---|---|---|
| **Merchant** (DTC owner/marketer) | Configure brand voice and rules without a developer. See ROI (conversion lift, AOV lift). Control what the AI can say/promise. | An AI that goes off-brand, over-promises, or can't be reasoned with. |
| **Shopper** | A fast, low-friction answer. Trust that recommendations map to real inventory and pricing. | Another popup competing for attention; a bot that wastes their time. |
| **Agency** (implements for a portfolio of stores) | Templated configs, multi-store management, white-label reporting. | Reconfiguring everything by hand for every client store. |
| **Shopify Plus** (enterprise merchant) | Segment-level control, checkout extensibility, integration with existing MarTech stack, security/compliance sign-off. | Vendor lock-in without an escape hatch; a black box the compliance team can't audit. |

## 5. Core Product Pillars

The brainstormed list ("dashboard, analytics, UCP, integrations, widgets, A/B testing...") collapses into **five pillars**. Two merges are deliberate:

- *Analytics* and *Experimentation* are **one pillar**, not two — you cannot experiment without analytics, and analytics without experimentation is just a BI dashboard nobody acts on.
- *"AI Configuration"* is **not a separate pillar** — it's a module inside the Merchant Console, same as brand/widget config.

| Pillar | Answers |
|---|---|
| **Shopper Experience** | How does the shopper encounter and use IntentCart? (widget ecosystem + conversational engine) |
| **Commerce Engine** | How does IntentCart transact against Shopify? (catalog/search/cart/checkout/customer via MCP, through a UCP-ready adapter layer — see §9a) |
| **Merchant Console** | How does the merchant shape and control IntentCart? (brand, prompts, rules, widgets, integrations, permissions) |
| **Intelligence Layer** | How do we know it's working, and how do we make it work better? (analytics + experimentation, unified) |
| **Integration Fabric** | How does IntentCart plug into the merchant's existing stack? (Klaviyo, GA4, Make/n8n, Flow, etc.) |

## 6. System Architecture

```
                     ┌─────────────────────────────┐
Shopper  ───────────▶│  Shopper Experience Layer    │
                     │  (widget renderers: bubble,  │
                     │   panel, inline, quiz, PDP…) │
                     └──────────────┬───────────────┘
                                    ▼
                     ┌─────────────────────────────┐
                     │   Conversational Engine      │
                     │   (Claude + system prompt +   │
                     │    brand/rules injection)     │
                     └──────────────┬───────────────┘
                                    ▼
                     ┌─────────────────────────────┐
                     │     Commerce Session          │
                     │  (intent, cart state, checkout │
                     │   context — stateful, per-shopper)│
                     └──────────────┬───────────────┘
                                    ▼
                     ┌─────────────────────────────┐
                     │      Adapter Layer            │
                     │ catalog / policy / cart /      │
                     │ checkout / customer            │
                     └──────────────┬───────────────┘
                                    ▼
                     ┌─────────────────────────────┐
                     │  Shopify (Storefront MCP,      │
                     │  Customer Account MCP, Admin)  │
                     └─────────────────────────────┘

Every layer emits events sideways into:

                     ┌─────────────────────────────┐
                     │   Intelligence Layer          │
                     │ (analytics + experimentation) │
                     └──────────────┬───────────────┘
                                    ▼
              ┌───────────────────┴───────────────────┐
              ▼                                        ▼
     ┌─────────────────┐                    ┌─────────────────────┐
     │ Merchant Console  │◀──config writes──│  Integration Fabric   │
     │ (reads back into   │                   │ (Klaviyo, GA4, Make,  │
     │  Conversational     │                   │  n8n, Flow, …)        │
     │  Engine + Widgets)  │                   └─────────────────────┘
     └─────────────────┘
```

The key architectural commitment: **config flows down, events flow sideways.** The Merchant Console never talks to Shopify directly for commerce actions — it only configures the Conversational Engine and Widget layer. The Commerce Session is the single source of truth for "what is happening in this shopper's session," and every pillar either reads from it or writes to it — nothing bypasses it.

## 7. User Journeys

**Merchant Journey:** Install app → theme extension auto-embeds → onboarding configures brand voice + initial rules → choose widget surfaces to activate → launch → watch funnel analytics → launch first experiment (e.g. widget copy A/B) → iterate based on lift.

**Shopper Journey:** Browsing → intent signal (search, scroll trigger, PDP visit) → conversational discovery → guided narrowing (variant/bundle) → cart → *(future)* assisted checkout → *(future)* post-purchase order status via MCP.

**AI Journey** (what the engine does per turn): intent classification → tool selection (search / policy / cart / checkout) → grounded response generation against real MCP data → action execution → outcome logged to Intelligence Layer → *(async)* scored against any active experiment's success metric.

## 8. Merchant Console

Everything a merchant can configure, no code required:

- **Brand** — voice, tone, colors, logo, sample phrases, forbidden words/claims.
- **Prompt & Rules** — system prompt template, guardrails, escalation rules (when to hand off to a human/email), what the AI is never allowed to promise (e.g. shipping dates it can't guarantee).
- **Widgets** — which surfaces are active, placement, style, per-surface copy.
- **Integrations** — connect/disconnect, field mapping, sync status.
- **Permissions** — team roles; for agencies, per-store scoping.
- **Analytics** — funnels and KPIs (read surface of the Intelligence Layer).
- **Experiments** — create, monitor, and conclude A/B tests (write surface of the Intelligence Layer).

This *is* "the dashboard" — but it is scoped strictly to configuration and observability of the Commerce Engine, not a general admin panel or BI tool.

## 9. Commerce Engine

| Capability | Status | Note |
|---|---|---|
| Catalog / Search | ✅ Built | via Storefront MCP `search_shop_catalog` |
| Cart | ✅ Built | `get_cart` / `update_cart` adapters |
| Checkout | 🟡 Stubbed | Shopify's AI-checkout extensibility is still early — deliberate "not yet," see §14 |
| Customer | ✅ Built | Customer Account MCP, token-gated |
| Policies / FAQ | ✅ Built | `search_shop_policies_and_faqs` |
| Variant selection | ✅ Built | via product card UI + tool args |
| **Recommendations** | ❌ Gap | not yet built — see §14 |
| **Bundles** | ❌ Gap | not yet built — see §14 |
| Orders (post-purchase) | ❌ Gap | future MCP surface, low priority until purchase-loop closes |

Everything above sits behind the adapter layer, which is what makes the proto-UCP normalization shape valuable: the Commerce Session doesn't know or care that it's talking to Shopify specifically — it knows it's talking to "the adapter," which today happens to be Shopify.

## 9a. Current UCP Status

MCP is implemented today as the tool-calling layer.

UCP is **not yet implemented as a dedicated abstraction**. Today, IntentCart only normalizes Shopify/MCP responses into internal commerce objects — Product, Variant, Cart, Checkout — inside the adapter layer (`tool.server.js`'s `formatProductData`, and the option-value normalizer in `chat.js`). That normalization already tolerates more than one wire shape for the same field (e.g. an option value arriving as a plain string vs. a structured `{label, name, value, title}` object), which is what "UCP-ready" means here — not a built abstraction, just adapters that aren't locked to one exact schema.

This makes the system **UCP-ready**, but **not fully UCP-native** yet.

**Future UCP layer** (not built now):

- Define internal canonical commerce schemas (Product, Variant, Cart, Checkout) as an explicit contract, not an implicit shape inferred from adapter code.
- Validate MCP responses against those schemas at the adapter boundary.
- Expose Agent Profile metadata (what this agent/store supports).
- Support capability negotiation (what the connected commerce backend can/can't do).
- Support future non-Shopify commerce adapters against the same canonical schemas.

**Do not build this now.** It only earns its cost once a second commerce backend (beyond Shopify) is actually on the roadmap — see §15.

## 10. Widget Ecosystem

One conversational engine, one commerce session, **pluggable surface renderers**:

- Floating bubble *(built)*
- Side panel
- Embedded/inline section — the "quiz that continues the scroll flow" idea: a widget that lives *in the page flow*, not interrupting it
- Landing-page takeover
- Collection-page assistant (contextual to the collection being browsed)
- Product-page assistant (contextual to the PDP)
- Cart-drawer assistant
- *(future)* Checkout assistant

Each is a template around the same session/engine — a merchant should be able to enable three of these on three different pages without reconfiguring brand voice or rules three times.

## 11. Analytics

Part of the unified Intelligence Layer:

- **Funnels** — discovery → cart → checkout drop-off, sliced by widget/surface.
- **Conversation analytics** — topic distribution, deflection vs. conversion rate, tool-call success rate.
- **Commerce analytics** — AOV, attach rate, bundle uptake (once bundles exist).
- **AI analytics** — latency, guardrail-trigger rate, tool-error rate. *(This is directly downstream of the timeout/error instrumentation already added to the MCP client and Claude service — that instrumentation is the seed of this analytics surface, not throwaway debug code.)*
- **Merchant KPIs** — revenue attributed to IntentCart, conversion lift vs. baseline.

## 12. Experimentation

One experiment primitive, four applications:

- **A/B testing** — widget placement/copy variants.
- **Prompt testing** — system prompt variants.
- **Widget testing** — surface type (bubble vs. inline vs. panel) for the same intent.
- **Conversion testing** — checkout-nudge copy/timing variants.

Mechanically: assign a shopper to a variant at session start → tag every Intelligence Layer event with that variant → report lift against the merchant's chosen success metric. This is the same primitive reused four ways — not four separate systems.

## 13. Integrations

Tiered by when they earn their build cost:

- **Tier 0 (launch-blocking):** Shopify. Nothing else blocks MVP.
- **Tier 1 (next, revenue-adjacent):** Klaviyo (retention loop), GA4 or PostHog (analytics parity merchants already trust), Shopify Flow (native automation hook merchants expect).
- **Tier 2 (agency / power-user):** Make, n8n, HubSpot, generic outbound webhooks.
- **Tier 3 (commodity, don't special-case):** Reviews, shipping, payments-specific integrations — build one generic webhook fabric, don't hand-build bespoke connectors for each.

## 14. Roadmap

- **Now (MVP — already built):** conversational chat, MCP-backed catalog/cart/checkout adapters, streaming responses, product cards, commerce session.
- **Next (V1):** Merchant Console for brand/prompt/widget config without code; basic funnel analytics; one working experimentation primitive; Klaviyo + GA4 integration.
- **Later (V2):** widget ecosystem beyond the floating bubble; recommendations + bundles; agency multi-store console; Make/n8n generic webhook fabric.
- **Vision (long-term platform):** assisted checkout as Shopify's AI-checkout primitives mature; commerce session portable beyond Shopify; a marketplace of merchant-built prompt/rule templates.

## 15. What NOT to Build

- A custom no-code workflow builder — Make/n8n already own this; integrate, don't compete.
- A general BI tool — integrate GA4/PostHog; don't build a data warehouse UI.
- Own payments or shipping rails — Shopify already owns this; stay an orchestration layer on top.
- Multi-platform support (WooCommerce, BigCommerce, etc.) before Shopify dominance is proven.
- Fully autonomous checkout before Shopify's own AI-checkout primitives mature — regulatory and liability risk outweighs the win today.
- Generic customer-support ticketing — stay scoped to commerce intent; don't become Zendesk.

## 16. Where This Becomes Defensible

1. **The MCP-grounded commerce session is the moat.** Structured, replayable data about shopper intent matched against *real* live inventory/pricing, accumulated over every conversation — competitors without a live MCP-grounded conversation loop can't replicate this data shape.
2. **Brand-voice data compounds per merchant.** Every correction/configuration a merchant makes differentiates their instance further, raising switching cost the longer they stay.
3. **Attributed revenue creates soft lock-in.** Once a merchant's dashboard shows "$X attributed to IntentCart," removing it carries a revenue-loss argument — the same mechanic that makes Segment/Klaviyo sticky, without needing a contract to enforce it.

## 17. Category-Defining Potential

The category is **"AI Commerce Operating Layer,"** not "AI chatbot for Shopify." If IntentCart becomes the substrate every commerce interaction flows through — and the Merchant Console becomes as indispensable as Klaviyo is for email — it graduates from feature to infrastructure. The long-term wedge: become the reference implementation for MCP-native commerce as Shopify's own MCP standard matures, the way Stripe became synonymous with "the API for payments."
