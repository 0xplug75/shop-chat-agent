# Vision

## Purpose

Every roadmap decision, every "should this feature exist" conversation, needs a fixed reference point that doesn't drift with whatever shipped last sprint. This document is that reference point. It answers *why IntentCart exists* and *what it refuses to become*, independent of implementation status — for the system's current expression in code, see [Architecture.md](./Architecture.md) and [Roadmap.md](./Roadmap.md).

The canonical market problem, entry category, validation ICP, brand promise, and
message hierarchy are frozen in [Positioning.md](./Positioning.md). This vision
describes the long-term system destination; the positioning document governs
how the current product is researched, described, and sold.

If a feature request can't be justified against this document, it doesn't ship, regardless of how easy it is to build.

## What IntentCart is not

IntentCart is not a chatbot. It is not a Shopify app that happens to have a chat widget bolted onto a theme. The chat widget calling Claude with Shopify MCP tools attached (see [Architecture.md](./Architecture.md#current-implementation)) is the correct entry point for the product — a single, well-scoped surface to prove the model on. It is not the ceiling of the product, and the architecture is deliberately built so it doesn't have to be.

## What IntentCart is

IntentCart is the **AI Commerce Operating System for Shopify**: the intelligence layer that sits between a shopper's intent and Shopify's commerce execution. Shopify remains the transactional engine — it owns products, inventory, variants, pricing, cart, checkout, orders, customers, markets, and policies, permanently. IntentCart never re-implements or shadows any of that state. It orchestrates it.

The chat widget is one interface into this system. It is not the system.

## The shift this product is betting on

Commerce is moving from navigation-based shopping to intent-based shopping.

**Old commerce** is a funnel the shopper has to walk themselves:

```
Customer → Navigation → Collections → Products → Cart → Checkout
```

**Intent-based commerce** collapses that funnel into a conversation the system drives on the shopper's behalf:

```
Customer Intent → IntentCart Runtime → Commerce Orchestration → Shopify → Checkout
```

The shopper states a goal — "I need a gift," "I need running shoes," "I want a sofa under €900" — and the Runtime is responsible for turning that goal into the right catalog query, the right comparison, the right variant, and eventually the right checkout link. The merchant's collection and navigation architecture becomes an input the Runtime can use, not something the shopper is forced to walk through by hand.

## Mission

Help every Shopify merchant deliver AI-native buying experiences without replacing Shopify — regardless of the merchant's engineering headcount. Concretely, that means:

1. Speak in the merchant's actual brand voice, not a generic bot voice.
2. Reason over the *live* catalog, inventory, and policies via MCP — never hallucinated product data.
3. Close sales through guided conversation instead of passive browsing.
4. Get measurably better over time, on data the merchant owns and can see.

(1) is realized by the Merchant Console's Prompt & Rules module (see [MerchantConsole.md](./MerchantConsole.md)); (4) is realized by the Intelligence Layer (see [Roadmap.md](./Roadmap.md)). Both are mission-critical, not nice-to-haves, which is why both are sequenced early in [Roadmap.md](./Roadmap.md) rather than left until later.

## First principles

### Shopify remains the source of truth

Products, inventory, variants, pricing, cart, checkout, orders, customers, markets, and policies always belong to Shopify. IntentCart orchestrates them; it never duplicates or forks that state into its own database. `prisma/schema.prisma` enforces this by construction — IntentCart's own database stores only session/auth plumbing (`Session`, `CustomerToken`, `CodeVerifier`, `Conversation`, `Message`, `CustomerAccountUrls`), never a product or cart table. This is a deliberate architectural constraint: a `Product` or `Cart` model appearing in `prisma/schema.prisma` is a signal to re-examine the design, not a milestone to reach.

### The Runtime is the product

IntentCart is not a chat application with commerce features. It's a Runtime shared across multiple interfaces. Today there is exactly one interface — the floating chat bubble theme extension (`extensions/chat-bubble/`). The architecture is built so that a Product Assistant, Collection Assistant, Search Assistant, Landing Assistant, Quiz, Cart Assistant, Checkout Assistant, or Email Assistant could all be added later as new *renderers* over the same Commerce Session and Conversational Engine — not as seven separate products with seven separate brains. One brain, many surfaces.

### Intent before interface

The Runtime is designed to understand what the shopper wants before it decides what to show them. Design decisions get evaluated against shopper goals ("I need a gift"), not against pages (a PDP, a collection grid). The intent classification layer (`app/services/intent-router.server.js`) is the current, deliberately narrow expression of this principle — see [CommerceSession.md](./CommerceSession.md) for how it works and its known limits.

### Context is the product

The competitive advantage is not the LLM — Claude, GPT, or any other frontier model can generate a plausible-sounding product recommendation. The advantage is **Commerce Context**: conversation history, products viewed, merchant rules, shopper preferences, selected variants, cart state, checkout state, customer identity, policies, and memory, accumulated per shopper and per merchant over time. The Runtime owns this context (`CommerceSession`, see [CommerceSession.md](./CommerceSession.md)). The LLM consumes it — it does not own it, and swapping the LLM out should never mean losing it.

### AI orchestrates, it does not invent

The LLM must never invent commerce facts — price, stock, variants, shipping, policies, cart contents, checkout URLs, or order state. Whenever a commerce fact is needed, the system delegates to Shopify through MCP, not to the model's own reasoning. Enforcement of this principle spans a spectrum from hard code gates (cart mutations) to prompt instructions (most other commerce facts) — see [Agents.md](./Agents.md#architecture-enforcement-model) for exactly where each constraint sits today and why that split is deliberate.

## Positioning

The focused entry category is **"Agentic guided selling for Shopify,"** not "AI
chatbot for Shopify." The initial product is a decision layer between shopper
intent and the Shopify catalog. Its locked promise is: **"Turn your Shopify store
into an agentic shopping experience."** See [Positioning.md](./Positioning.md) for
the complete canonical language and validation ICP.

The long-term category ambition remains **"AI Commerce Operating Layer."** An
operating layer is infrastructure a merchant's commerce operation runs through —
the same way Klaviyo isn't merely an email feature for merchants who depend on
it, but the retention system. IntentCart earns that status only after guided
selling proves measurable value and the Commerce Session becomes the substrate
that chat, quiz, PDP assistance, cart assistance, and future surfaces share.

## What we will not build

These aren't gaps to fill later — they're deliberately out of scope, because building them would compete with tools that already do this well, or would take on liability the category isn't ready for:

- A custom no-code workflow builder — Make/n8n already own this; integrate, don't compete.
- A general BI tool — integrate GA4/PostHog; don't build a data warehouse UI.
- Payments or shipping rails of our own — Shopify already owns this.
- Multi-platform support (WooCommerce, BigCommerce, etc.) before Shopify dominance is proven.
- Fully autonomous checkout before Shopify's own AI-checkout primitives mature — regulatory and liability risk outweighs the win today. This is why `checkout-adapter.server.js` only resolves a checkout URL for the shopper to complete manually, and does not attempt to place an order on the shopper's behalf.
- Generic customer-support ticketing — stay scoped to commerce intent; don't become Zendesk.
