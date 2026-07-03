# Architecture note: cart-adapter / business-message-interpreter wiring gap

**Status:** open — documented, not scheduled. No code deleted or moved as part of this note.

## What's inconsistent

IntentCart's commerce flow has two separate paths that reach Shopify's MCP tools:

1. **Intent pre-fetch** (`runCommerceIntent()` in `chat.jsx`) — runs before Claude is called at all, keyed off `intent-router.server.js`'s heuristic classification. For `PRODUCT_DISCOVERY`/`PRODUCT_DETAIL` it calls `catalog-adapter.server.js`; for `POLICY_QUESTION` it calls `policy-adapter.server.js`; for `CHECKOUT_ACTION` it calls `checkout-adapter.server.js`. All three go through their adapter.
2. **Claude tool-use loop** (`onToolUse` in `chat.jsx`) — whenever Claude itself decides to call an MCP tool (including `get_cart` / `update_cart`), the handler calls `mcpClient.callTool()` **directly**, then hand-processes the result inline via `applyCommerceToolResult()`.

There is no `CART_ACTION` branch in `runCommerceIntent()`, so cart operations only ever happen via path 2 — which means `cart-adapter.server.js` (instantiated as `adapters.cart` in `chat.jsx` but never called) and, transitively, `business-message-interpreter.server.js` (cart-adapter's only caller) never execute today.

The practical consequence: `applyCommerceToolResult()`'s cart branch reimplements a thinner version of what the adapter pair already does — it extracts a checkout URL and pushes a single hardcoded "Shopify returned updated cart information" business message, instead of classifying the outcome (`quantity_adjusted`, `not_found`, `unavailable`, `requires_selling_plan`, `requires_buyer_input`) the way `business-message-interpreter.server.js` already can.

## Why this wasn't touched during the architecture cleanup pass

These are deliberately-designed modules matching the existing adapter pattern (parity with catalog/policy/checkout), not accidental leftovers. Removing or relocating them would delete a strategic piece of the commerce-runtime architecture on the assumption that "unused today" means "not needed" — which isn't the right call for a pattern the rest of the codebase is built around.

## What wiring it in would look like (not implemented — flagged here for a future, deliberate decision)

- Add a `CART_ACTION` branch to `runCommerceIntent()` that calls `adapters.cart.getCart`/`preserveAndUpdateCart` the same way the other three intents call their adapters, **or**
- Change `onToolUse`'s cart branch in `chat.jsx` to route `get_cart`/`update_cart` results through `cart-adapter.server.js` + `business-message-interpreter.server.js` instead of `mcpClient.callTool()` + the inline hand-rolled business message.

Either changes runtime behavior (richer/different business messages reach the model), so it's a product decision, not a pure refactor — out of scope for an "keep behavior identical" architecture pass.
