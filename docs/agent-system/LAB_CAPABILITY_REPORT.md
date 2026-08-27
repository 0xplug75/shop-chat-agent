# Lab Capability Report

Observation date: 2026-08-02.

## Evidence Scale

- **Working**: implemented and covered by current local tests or an equivalent
  deterministic check.
- **Working with limitations**: usable local implementation with a named gap.
- **Partial**: only part of the end-to-end capability exists.
- **Mocked**: exercised through fixtures or injected transports only.
- **Broken**: the current local path cannot execute.
- **Unknown**: accessible evidence does not establish the state.

Local proof does not imply a current Shopify installation, deployed revision,
or completed transaction.

## Capability Map

| Capability | Evidence | Status | Boundary or limitation |
|---|---|---|---|
| Embedded Shopify app | `shopify.app.toml`, `app/shopify.server.js` | Working with limitations | Configuration exists; current live installation was not mutated or reverified |
| Shopify CLI | local `shopify version` check | Working | Version 3.93.2 executed in the current validation environment; no dev tunnel or deployment was started |
| Admin navigation | `app/routes/app.jsx`, `tests/admin-navigation.test.js` | Working | Exactly Home, Assistant, Widget, Knowledge, Commerce |
| Merchant persistence | `app/merchant/`, Prisma schema and integration tests | Working | Remote database state and backup remain externally unverified |
| Theme App Extension | `extensions/chat-bubble/shopify.extension.toml` | Working with limitations | Extension source exists; live activation on the current theme is not proved here |
| App embed | `extensions/chat-bubble/blocks/chat-interface.liquid` | Working | Body target provides the global widget shell |
| App blocks | extension file inventory | Partial | No separate section-targeted app block was observed |
| Liquid boundary | `chat-interface.liquid` | Working | No intent parser, ranking engine, or cart mutation observed in Liquid |
| Storefront JavaScript | `extensions/chat-bubble/assets/chat.js` | Working with limitations | Thin renderer and runtime client, but automatic opening paths remain |
| Storefront CSS | `extensions/chat-bubble/assets/chat.css` | Working with limitations | Scoped responsive rules exist; representative third-party theme matrix is not live-verified |
| Closed initial experience | Liquid schema and `chat.js` entry behavior | Partial | `open_on_load` defaults false, but inline/configured/contextual paths can open without a direct shopper action |
| Theme Editor ownership | Liquid schema and `app/routes/app.widget.jsx` | Partial | Appearance and entry settings overlap between Theme Editor and Admin |
| App Proxy configuration | `shopify.app.toml` | Working with limitations | `/apps/intentcart` is configured; a generated manifest is not live route proof |
| App Proxy authentication | `app/security/app-proxy-context.server.js` | Working | Official proxy authentication and canonical shop/origin context are enforced locally |
| Visitor context | `chat.js`, bootstrap route, proxy context | Working with limitations | Session-scoped visitor ID and signed context exist; cross-browser recovery is not a visitor identity guarantee |
| Widget token | `app/security/widget-token.server.js` | Working | HMAC credential is short lived and bound to tenant/shop/origin/visitor context |
| Rate limiting | `app/security/rate-limit.server.js`, bootstrap/chat routes | Working | Durable tenant, visitor, network, and bootstrap limits exist outside tests |
| OAuth/session boundary | `app/shopify.server.js`, `app/services/shopify-session-storage.server.js` | Working | Local encryption, expiry, rotation, lease, and invalidation paths are test-covered |
| Install/reinstall lifecycle | OAuth/session services and tests | Working with limitations | Deterministic coverage exists; two authorized development-store runs remain unverified |
| Required webhooks | `shopify.app.toml`, `app/routes/api.webhooks.jsx` | Working | Authenticated, deduplicated uninstall and privacy handlers exist locally |
| Shopify catalog source | MCP/catalog services and tool allowlist | Working with limitations | Server boundary exists; current live product search was not executed in this setup |
| Product recommendation | runtime contracts and chat services | Mocked | Deterministic tests do not prove a live catalog/LLM recommendation |
| Cart confirmation | `app/services/cart-adapter.server.js` and mutation tests | Working | Server validation and explicit product/variant/quantity confirmation are required |
| Cart idempotence | commerce mutation service, Prisma journal, tests | Working | Durable key and replay/reconciliation logic are local/PostgreSQL proof |
| Live cart mutation | Shopify adapter with injected transports | Mocked | No authorized live cart was changed in this setup |
| Checkout handoff | `app/services/checkout-adapter.server.js` | Working with limitations | Shopify URL validation exists; checkout completion is not observed |
| Error handling | widget routes, renderer, adapter tests | Working with limitations | Server failure paths are normalized; full live outage UX is not verified |
| Mobile layout | `chat.css` responsive/safe-area rules | Working with limitations | Static and local browser evidence only in this setup |
| Accessibility | Liquid semantics, `chat.js`, `chat.css` | Working with limitations | Labels, live region, Escape, focus return, and reduced motion exist; no complete focus trap was observed |
| Theme compatibility | scoped extension selectors | Working with limitations | CSS isolation is designed; no current multi-theme Shopify run was performed |
| Development scripts | `package.json`, `shopify.web.toml` | Working with limitations | `npm run dev` invokes Shopify CLI and predev can deploy database migrations |
| Deployment scripts | `npm run deploy`, generated `.shopify/` bundles | Partial | Packaging/configuration exist; no deployment was authorized and generated files are not live proof |
| Railway health | non-mutating GET checks during this setup | Working with limitations | `/health` and `/health/db` returned 200; deployed revision is unknown |
| Deployed UCP profile | non-mutating GET during this setup | Partial | `/ucp/agent-profile` returned 404, so candidate UCP surface is not evidenced on that service |

## Configuration Drift

Three sources require deliberate reconciliation before release:

1. `shopify.app.toml` and `shopify.app.intentcart.toml` are parallel app
   configurations with small differences. Only `shopify.app.toml` is tracked by
   the current ignore policy as canonical.
2. `.shopify/dev-bundle/manifest.json` and
   `.shopify/deploy-bundle/manifest.json` are generated local artifacts and do
   not expose the same capability set. Neither proves the active remote version.
3. Theme presentation/entry settings are represented in both the Liquid schema
   and merchant Admin configuration.

## Environment Contract

Only names are recorded. Values were not read or copied.

| Group | Variable names | Role |
|---|---|---|
| Runtime | `NODE_ENV`, `APP_ENV`, `RAILWAY_ENVIRONMENT_NAME`, `APP_URL`, `PORT`, `LOG_LEVEL` | Process mode, URL, port, and logging |
| Shopify | `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `SHOP_CUSTOM_DOMAIN` | App identity, OAuth, scopes, and shop routing |
| Database | `DATABASE_URL`, `DIRECT_URL`, `TEST_DATABASE_URL` | Runtime, migration, and disposable-test PostgreSQL connections |
| LLM routing | `AI_PROVIDER`, `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`, `LLM_FALLBACK_PROVIDERS` | Provider selection and resilience |
| OpenAI compatible | `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_INPUT_COST_PER_MILLION_USD`, `OPENAI_OUTPUT_COST_PER_MILLION_USD` | Primary compatible provider and accounting |
| Kimi | `KIMI_API_KEY`, `KIMI_MODEL`, `KIMI_BASE_URL`, `KIMI_INPUT_COST_PER_MILLION_USD`, `KIMI_OUTPUT_COST_PER_MILLION_USD`, `MOONSHOT_API_KEY` | Secondary compatible provider and accounting |
| Compatibility | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `CLAUDE_API_KEY` | Optional/legacy provider compatibility |
| OAuth/security | `REDIRECT_URL`, `OAUTH_STATE_TTL_SECONDS`, `TOKEN_ENCRYPTION_KEY` | Callback, state expiry, and token encryption |
| Widget security | `WIDGET_SIGNING_SECRET`, `WIDGET_TOKEN_TTL_SECONDS`, `WIDGET_ALLOWED_ORIGINS` | Short-lived credential and origin policy |
| Rate limits | `WIDGET_RATE_LIMIT_PER_MINUTE`, `WIDGET_NETWORK_RATE_LIMIT_PER_MINUTE`, `WIDGET_SHOP_RATE_LIMIT_PER_MINUTE`, `WIDGET_BOOTSTRAP_RATE_LIMIT_PER_MINUTE` | Public request budgets |
| Commerce/UCP | `COMMERCE_SESSION_TTL_SECONDS`, `UCP_AGENT_PROFILE_URL`, `UCP_ACCESS_TOKEN`, `UCP_ALLOWED_BUSINESS_HOSTS`, `UCP_CHECKOUT_ENABLED` | Session expiry and gated UCP provider behavior |

## Immediate Boundary Work

1. Make closed startup an enforced runtime invariant, not only a default.
2. Remove Admin ownership of settings that already belong to Theme Editor.
3. Pin and document the working Shopify CLI/Node runtime before store verification.
4. Reconcile the canonical app configuration and ignore generated bundle drift.
5. Execute an authorized two-store install-to-checkout matrix before making a
   production-ready claim.
