# Commerce Session

## Purpose

Commerce Session is the single most important abstraction in IntentCart's architecture, per [Vision.md](./Vision.md): "context is the product." A `CommerceSession` is not a conversation transcript — a transcript is a list of things that were said. A `CommerceSession` is the state of an active buying journey: what the shopper wants, what they've seen, what's in their cart, and what Shopify has told the system about all of it.

This distinction matters because the Conversational Engine (see [Agents.md](./Agents.md)) is deliberately stateless between calls — it's handed a fresh reconstruction of "what's true right now" on every Claude invocation, rather than trusted to remember or infer it from raw chat history. Commerce state belongs to the Runtime, never to the LLM: the session object is assembled from Shopify tool results, not from what the model claims it did, so it can't drift the way an LLM's own memory of a conversation can.

## Responsibilities

The `CommerceSession` owns:

- `sessionId` — the identifier for the active buying journey
- `messages` — the full turn history
- `intent` — the current turn's classified intent
- `catalogResults` — the most recent product search result set
- `selectedProduct` / `selectedVariant` — the shopper's current focus, if established
- `cartId` / `cartSnapshot` — the last known Shopify cart state
- `checkoutUrl` — the last resolved checkout URL, if any
- `buyerContext` — buyer-identity signals passed to adapters
- `pendingBusinessMessages` — an internal queue of facts the Runtime wants the agent to know about before its next response

## Architecture

### State reconstruction, not state duplication

The Commerce Session is designed as a **read model over Shopify state plus conversation history**, not as an independent store of commerce facts. It is rebuilt from the message history and the current turn's tool results on every request. This keeps the architecture honest about who owns what: there is no `CommerceSession` table anywhere in `prisma/schema.prisma`, only `Conversation`/`Message` rows — the session is a lens onto those, not a second source of truth alongside them. Anything the session reports (cart contents, checkout URL, selected variant) is either sourced directly from a Shopify tool result in the current turn or preserved from the raw history of a prior one.

### Pending business messages

`pendingBusinessMessages` is the mechanism for telling the agent something happened without letting the model narrate it directly. It's a running list of `{ outcome, rawMessage, assistantMessage }` triples, appended when commerce facts are fetched or when tool results come back, and consumed by being serialized into the system instruction on the next agent call (`getCommerceContext()` → `buildSystemInstruction()`).

One deliberate behavior: a new `product_discovery` or `product_detail` intent **replaces** the entire queue rather than appending to it, so the agent doesn't re-surface a stale pending cart suggestion once the shopper has clearly moved on to a new product. Everywhere else, messages are pushed, so a policy lookup and a cart tool result can both be pending within the same turn.

### Intent classification

Every inbound shopper message is classified into one of six intent types before the agent is invoked, driving which commerce facts get pre-fetched:

| Intent | Triggers on (substring match, English + partial French) |
|---|---|
| `checkout_action` | "checkout", "check out", "pay", "payment" |
| `cart_action` | "add to cart", "cart", "basket", "remove", "quantity" |
| `policy_question` | "shipping", "return", "refund", "policy", "delivery", "faq" |
| `product_detail` | "variant", "size", "color", "available", "in stock", "details" |
| `product_discovery` | "find", "looking for", "recommend", "compare", "best", "need", "want", "show me" |
| `general_sales_question` | fallback |

Classification pre-fetches the right commerce facts before the agent's first response, so the agent grounds itself in real product or policy data immediately rather than guessing and correcting.

### The cart adapter path

Commerce facts reach the session through two coordinated paths, matched to when in the turn they're needed. The **intent pre-fetch** path (`runCommerceIntent()`) runs before the agent is invoked, routing `PRODUCT_DISCOVERY`/`PRODUCT_DETAIL` through the catalog adapter, `POLICY_QUESTION` through the policy adapter, and `CHECKOUT_ACTION` through the checkout adapter — grounding the agent's first response in real data. The **agent tool-use loop** handles cases where the agent itself decides mid-turn that it needs a commerce fact, most notably `get_cart` and `update_cart`.

The adapter pattern is uniform by design across catalog, policy, cart, and checkout — each adapter isolates its Shopify MCP calls and normalizes results the same way, so the Commerce Session and Conversational Engine never need to know which adapter they're talking to. `cart-adapter.server.js` and its collaborator `business-message-interpreter.server.js` implement the cart leg of this pattern in full: full-cart-state preservation semantics (`preserveAndUpdateCart`) and outcome classification (`quantity_adjusted`, `not_found`, `unavailable`, `requires_selling_plan`, `requires_buyer_input`) matching what catalog, policy, and checkout already do for their domains.

*Current implementation:* cart operations that originate from the agent's own tool-use decisions (rather than the intent pre-fetch) are handled inline in `chat.jsx`'s `onToolUse` handler today, which calls Shopify's cart tools directly and applies a lighter-weight outcome summary. Routing this path through `cart-adapter.server.js` and `business-message-interpreter.server.js` — bringing cart handling to parity with the other three adapters — is sequenced as near-term architecture work (see [Roadmap.md](./Roadmap.md#near-term-architecture)); the two concrete approaches (a `CART_ACTION` branch in `runCommerceIntent()`, or rerouting the `onToolUse` cart branch through the adapter pair) are recorded in `docs/architecture-notes/cart-adapter-wiring-gap.md`.

## Future Evolution

- **Continuous, event-driven session updates**, replacing per-request reconstruction with a session that subscribes to Hydrogen Observables and reflects Shopify state changes that originate outside the current conversation — see [EventSystem.md](./EventSystem.md).
- **LLM- or embedding-based intent classification**, with today's keyword router retained as a fast-path.
- **Cart-parity adapter routing**, described above.
- **A formal internal commerce schema** (Product, Variant, Cart, Checkout) that adapters validate MCP responses against — see [Architecture.md](./Architecture.md#adapter-layer-design-intent) for when this becomes worth building.
- **Session addressability across surfaces** — as the widget ecosystem in [Vision.md](./Vision.md) grows, a shopper's session needs to be resumable from any surface (a PDP assistant and a cart-drawer assistant reading the same session), not reconstructed independently per surface.

## Related documents

- [Architecture.md](./Architecture.md) — where the Commerce Session sits in the full request flow
- [Agents.md](./Agents.md) — how the session's state reaches the agent, and what the agent is instructed never to do with it
- [EventSystem.md](./EventSystem.md) — the reactive model this session's per-request design evolves into
