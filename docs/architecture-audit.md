# IntentCart architecture audit

Audit date: 2026-07-31

This document records the application state before the architecture hardening work. It intentionally describes the code that exists, not the target product narrative.

## Current runtime map

```text
Shopify Admin
  -> React Router embedded app
  -> authenticate.admin()
  -> /app, /app/assistant, /app/widget, /app/knowledge, /app/commerce
  -> loadIntentCartDashboard()
  -> global merchant.config.json

Shopify storefront
  -> Theme App Extension (Liquid + chat.js + chat.css)
  -> window.shopId and a merchant-entered backend URL
  -> GET /merchant/config
  -> POST /chat (SSE) and GET /chat?history=true

Chat route
  -> trusts X-Shopify-Shop-Id and Origin
  -> rebuilds an in-memory commerce object from message history
  -> heuristic intent router
  -> catalog/policy/checkout adapter pre-processing
  -> Claude SDK tool loop
  -> direct MCP tool calls
  -> Prisma Conversation and Message persistence

Shopify services
  -> storefront MCP for products and cart
  -> customer MCP for customer-authorized operations
  -> Shopify checkout handoff
```

## Dependencies and platform

- Node.js 20+ target; the existing Dockerfile still uses Node 18.
- React Router 7.9 and React 18.
- Shopify App Bridge and Shopify React Router integration.
- Prisma 6.2 with SQLite (`prisma/dev.sqlite`).
- Anthropic SDK 0.40, imported directly by the chat service.
- Shopify Storefront and Customer MCP endpoints.
- No request-validation library and no application test suite in this subproject.
- Shopify CLI starts the app and applies local Prisma migrations during development.

## Existing data ownership

- Shopify admin sessions are persisted by `PrismaSessionStorage`.
- `Conversation.shopId` was recently added and legacy conversations fail closed.
- `Message` belongs to `Conversation`, but does not carry a direct shop foreign key.
- `CustomerToken`, `CodeVerifier`, and `CustomerAccountUrls` are not related to a Shop.
- Customer access tokens are stored in plaintext.
- Commerce state is not persisted as a dedicated model. It is recreated with empty product, selection, cart, and checkout fields on every request.
- Merchant configuration is process-global JSON plus an in-memory global cache.

## Main execution paths

### Merchant dashboard

`app/routes/app.jsx` authenticates Shopify Admin and renders native `s-app-nav`. Each page calls `app/merchant/dashboard.server.js`, which authenticates again and reads the same global JSON configuration.

### Storefront conversation

`extensions/chat-bubble/assets/chat.js` sends the Liquid-rendered shop ID as `X-Shopify-Shop-Id`. `app/routes/chat.jsx` treats that header and `Origin` as authoritative, connects to MCP, pre-runs selected adapters, then allows Claude to call the same MCP tools directly.

### Customer OAuth

`app/auth.server.js` concatenates conversation and shop identifiers into one OAuth state. `app/routes/auth.callback.jsx` parses it with `split("-")`, retrieves a separately stored verifier, exchanges the code, and stores the customer token in plaintext.

## Confirmed risks

1. **Store impersonation:** a browser can choose `X-Shopify-Shop-Id`; Liquid output is not a server-side proof of identity.
2. **Open CORS reflection:** arbitrary origins are reflected, including credential-capable responses.
3. **SSRF:** `Origin` is used to construct storefront, customer-account discovery, and MCP URLs without validating an installed Shopify domain.
4. **OAuth state ambiguity and replay:** UUIDs contain dashes, state is predictable, and verifier retrieval is not an atomic single-use state transaction.
5. **Plaintext customer tokens:** tokens have no application-level encryption or Shop foreign key.
6. **Cross-tenant support records:** customer-account URLs and token-status checks are scoped only by conversation ID.
7. **Unvalidated public input:** message length, identifiers, prompt type, and tool arguments have no schema boundary.
8. **XSS:** assistant Markdown is converted with string replacement and assigned to `innerHTML`; link schemes and text are not safely constructed.
9. **Information disclosure:** raw internal errors, MCP endpoints, tool arguments, and provider details are logged or returned.
10. **Duplicate commerce execution:** catalog pre-processing and Claude's tool loop can perform the same search twice; the cart adapter is bypassed.
11. **Non-persistent commerce state:** selected products, constraints, journey stage, cart, and checkout handoff disappear between turns.
12. **No concurrency control:** simultaneous turns can overwrite or duplicate state.
13. **Development-only database:** SQLite has no target Supabase schema, JSONB fields, or multi-tenant foreign-key structure.
14. **Incomplete webhooks:** only `APP_UNINSTALLED` is handled; compliance webhooks and idempotency are absent.
15. **Deployment drift:** runtime Node version conflicts with `package.json`, health checks are missing, and the Theme Editor can depend on a changing tunnel URL.

## Gaps to the target architecture

- No `Shop`, `MerchantConfig`, `CommerceSession`, `CommerceEvent`, knowledge, or durable OAuth state models.
- No central `MerchantRequestContext`.
- No signed public-widget bootstrap or short-lived widget token.
- No merchant configuration repository/service backed by Prisma.
- No explicit commerce state machine or optimistic locking.
- No typed tool registry with one controlled execution path.
- No LLM gateway abstraction.
- No structured analytics or logger contract.
- No PostgreSQL Full-Text Search strategy.
- No Railway/Supabase runbook.

## Incremental implementation plan

1. Establish request context, strict Shopify-domain validation, signed App Proxy bootstrap, short-lived widget tokens, restrictive CORS, input limits, neutral errors, request IDs, rate limiting, and safe client rendering.
2. Replace the SQLite Prisma schema with a PostgreSQL multi-tenant schema and a clean baseline migration. Keep remote migration execution manual.
3. Add Shop, merchant configuration, encrypted customer tokens, single-use OAuth state, conversation, and persistent commerce-session services.
4. Add a structured multilingual intent schema, explicit journey transitions, a validated tool registry, and a provider-independent commerce orchestrator. Remove duplicate pre-fetch/tool execution.
5. Add knowledge storage and PostgreSQL FTS retrieval behind a retriever contract.
6. Add an LLM gateway and migrate the current Claude stream without changing the SSE client contract.
7. Add append-only events and structured observability.
8. Add Railway/Supabase deployment documentation and production checks without deploying.

## Preserved boundaries

- Shopify remains the source of truth for catalog, prices, variants, inventory, cart, and checkout.
- Theme Editor remains responsible for storefront appearance.
- The existing dashboard and widget design are not part of this work.
- The separate Intent Card Demo is not part of this application and must not be modified.
