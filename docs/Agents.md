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

## Future Evolution: Multi-Agent Orchestration

The single-agent, single-prompt design is the right shape for one conversational surface. As the Runtime extends across more of the shopper journey (see [Vision.md](./Vision.md)'s "one brain, many surfaces"), the architecture decomposes into specialized agents sharing one `CommerceSession`:

- **Shopping Agent** — discovery and comparison, the direct extension of today's Sage.
- **Product Expert** — deep single-product Q&A, the likely brain behind a future PDP Assistant.
- **Cart Agent** — cart resolution and upsell/attach logic, built on the cart adapter path described in [CommerceSession.md](./CommerceSession.md#the-cart-adapter-path).
- **Checkout Agent** — as Shopify's AI-checkout extensibility matures (see [Vision.md](./Vision.md#what-we-will-not-build)).
- **Support Agent** — policy/FAQ/order-status, separating "answer a question" from "drive a sale."

Every agent in this roster inherits the same non-negotiable as Sage: no direct line to Shopify. Each one routes through Commerce Session → Business Interpreter → Hydrogen Skills, per the Agent Orchestrator layer in [EventSystem.md](./EventSystem.md). That discipline is easiest to state before a second agent exists and easiest to erode once several do, which is why it's recorded here ahead of the multi-agent build rather than after.

The prerequisite for this roster is not more agents — it's the Merchant Console's Prompt & Rules module (see [MerchantConsole.md](./MerchantConsole.md)), since additional agents are most valuable once each is configurable per merchant rather than hardcoded like today's three presets.

## Related documents

- [CommerceSession.md](./CommerceSession.md) — the state Sage is grounded in on every turn
- [MerchantConsole.md](./MerchantConsole.md) — the prompt compiler this section's system-prompt architecture points toward
- [Vision.md](./Vision.md) — the "AI orchestrates, it does not invent" principle this document measures Sage against
- [EventSystem.md](./EventSystem.md) — the multi-agent orchestration model this document's agent roster is drawn from
