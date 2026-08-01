# Shopify runtime stabilization baseline

Captured on 2026-08-01 at 01:28 CEST, before runtime changes in this run.

## Scope and safety

- Repository: `shop-chat-agent`
- Branch: `codex/intentcart-admin-freeze`
- HEAD: `43ae66e4c5b9de4f3bbc74a043701d784febdb8d`
- Remote: `https://github.com/0xplug75/shop-chat-agent.git`
- No deployment, remote migration, Shopify mutation, commit, push, or paid LLM
  request was performed during the baseline.
- The product-foundation documents in the parent workspace were read only.

## Existing worktree state

The following changes existed before this stabilization run and must remain
untouched unless they directly block the work:

- modified: `docs/PROJECT_STATE.md`
- modified: `docs/Vision.md`
- untracked: `docs/Positioning.md`
- untracked: `docs/audits/`

## Deployed revision delta

- Railway revision observed by the prior read-only audit:
  `4f92c75257074a3e28ec3c0301043c93bf614933`
- Local HEAD is one commit ahead:
  `43ae66e chore(shopify): remove obsolete deploy flag`
- The tracked delta is one deleted obsolete line in `shopify.app.toml`.
- No deployment state was changed or re-queried during this baseline.

## Runtime and toolchain

| Tool                        | Observed version/status                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| Node.js                     | `v22.14.0`                                                                    |
| npm                         | `10.9.2`                                                                      |
| Prisma CLI/client           | `6.19.3`                                                                      |
| React Router                | `7.18.2` from `package.json`                                                  |
| Shopify app session storage | `7.0.0` from `package.json`                                                   |
| Shopify CLI                 | Installed command is broken because its configured Node path no longer exists |
| Docker                      | `29.6.1`                                                                      |
| Docker Compose              | Standalone `docker-compose` `5.3.1`; `docker compose` unavailable             |
| Docker daemon               | Not accessible inside the initial sandbox; integration tests not started      |

Package management uses npm with `package-lock.json`. The application requires
Node.js `>=20.10`.

## Environment inventory

Names only were inspected. No value was printed.

```text
AI_PROVIDER
ANTHROPIC_API_KEY
ANTHROPIC_MODEL
APP_URL
CLAUDE_API_KEY
COMMERCE_SESSION_TTL_SECONDS
DATABASE_URL
DIRECT_URL
LLM_TIMEOUT_MS
LOG_LEVEL
NODE_ENV
OAUTH_STATE_TTL_SECONDS
OPENAI_API_KEY
OPENAI_MODEL
PORT
REDIRECT_URL
SCOPES
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_APP_URL
SHOP_CUSTOM_DOMAIN
TOKEN_ENCRYPTION_KEY
WIDGET_ALLOWED_ORIGINS
WIDGET_RATE_LIMIT_PER_MINUTE
WIDGET_SIGNING_SECRET
WIDGET_TOKEN_TTL_SECONDS
```

Only `CLAUDE_API_KEY`, the legacy Anthropic alias, was non-empty in the local
`.env`. Provider availability was not tested against a paid remote API.

## Validation before changes

| Command                                                       | Result             | Evidence/limit                                        |
| ------------------------------------------------------------- | ------------------ | ----------------------------------------------------- |
| `npm test`                                                    | PASS               | 35 passed, 4 PostgreSQL integration tests skipped     |
| `npm run typecheck`                                           | PASS               | React Router type generation and TypeScript completed |
| `npm run lint`                                                | PASS               | ESLint completed without errors                       |
| `npm run build`                                               | PASS               | 338 client modules and 70 SSR modules transformed     |
| `npm run db:generate`                                         | PASS               | Prisma client generated                               |
| `npm run db:validate`                                         | FAIL as configured | `DIRECT_URL` is absent locally                        |
| `DATABASE_URL=<local> DIRECT_URL=<local> npm run db:validate` | PASS               | Schema validation does not connect to the database    |
| `npm run format:check`                                        | FAIL, pre-existing | 86 files reported by Prettier                         |

The build also reports React Router 8 future-flag warnings. No existing test
proves offline-token rotation, provider parity, a side-effect-aware fallback,
or the complete shopper-to-checkout journey.

## Initial P0 state

1. Shopify offline access-token refresh fields and rotation behavior are not
   represented in the Prisma `Session` model.
2. The runtime LLM gateway is Anthropic-only; prior production evidence showed
   an HTTP 400 and no provider contract suite exists.
3. Tracked Shopify configuration points to Railway, but the installed embedded
   app was previously observed using an expired Cloudflare tunnel. No remote
   configuration will be changed in this run.

This file is the comparison point for `docs/runs/NEXT_RUN_REPORT.md`.
