# Architecture note: conversation history IDOR fix (shop scoping)

**Status:** implemented on `fix/idor-history`, pending review/deploy.

## What was wrong

`GET /chat?history=true&conversation_id=X` returned any conversation's full
message history to any caller with no authorization check. The default
`conversation_id` was `Date.now().toString()` — a millisecond timestamp,
trivially guessable/enumerable — and `Conversation`/`Message` rows had no
`shop` column, so conversations were not even scoped per store. A caller could
enumerate timestamps and read another shopper's (on another store's) chat
history, including any cart/product context surfaced during that
conversation.

## What changed

- `Conversation.shopId` (nullable `String`) records which shop created the
  conversation, set once at creation from `X-Shopify-Shop-Id` (the numeric
  Shopify shop ID, rendered server-side by Shopify's Liquid engine into the
  theme block as `window.shopId` — not something the storefront visitor's own
  script invents).
- `db.server.js`'s `createOrUpdateConversation`, `saveMessage`, and
  `getConversationHistory` all take a `shopId` and throw
  `ConversationAccessDeniedError` if a conversation exists under a different
  (or absent) `shopId` than the one on the request.
- `chat.jsx`'s history loader and the main chat session both derive `shopId`
  from the request header (never from the request body/client-controlled
  input) and propagate that error into a safe response: a 404 for the
  explicit history endpoint, and a fresh conversation (new `crypto.randomUUID()`
  id) for the main chat turn, so a legacy/foreign `conversation_id` degrades
  gracefully instead of crashing the chat.
- `conversation_id` defaults to `crypto.randomUUID()` instead of
  `Date.now().toString()`.

## Migration strategy for existing conversations

Conversations created before this change have `shopId = NULL`. There is no
reliable way to reconstruct which shop they belonged to after the fact — no
shop identifier was ever recorded for them. Rather than guess (or worse,
silently let the first requester "claim" a null-shop row), this fix **fails
closed**: `assertShopOwnsConversation` treats a `NULL` `shopId` as never
matching any request, so pre-migration conversations become permanently
inaccessible through the history endpoint or as a resumed session, and are
never resumed. This costs existing site visitors the ability to resume the
one conversation thread they had in flight at deploy time; the code already
handles this in `loadOrCreateCommerceSession` by transparently issuing a new
conversation rather than surfacing an error. No backfill migration is run
because there is no ground truth to backfill from — recreating a plausible
`shopId` from log correlation was considered and rejected as guessing, which
would defeat the point of the fix.

## What this does and doesn't defend against

`X-Shopify-Shop-Id` is set by Shopify's Liquid renderer
(`window.shopId = {{ shop.id }}` in `chat-interface.liquid`), not invented by
the visitor's browser script — so on normal storefront traffic through the
widget, it reflects the real shop. It is **not cryptographically signed** in
the HTTP request the widget sends to this app's own backend: nothing today
verifies that a raw HTTP request claiming a given `X-Shopify-Shop-Id` actually
originated from that shop's storefront (there's no Shopify App Proxy
signature or session-token verification on this endpoint). This fix closes
the concrete IDOR described above (guessable IDs + zero scoping, exploitable
by casual enumeration through the normal widget/API surface) but does not by
itself make the endpoint immune to a fully adversarial caller who fabricates
both the shop header and a valid-looking UUID. Verifying shop identity
cryptographically (App Proxy signature or Storefront/Customer Account session
tokens) is a separate, larger piece of work, out of scope here — tracked as a
follow-up, not silently assumed solved by this patch.
