# Environment variable inventory

Names and roles only. This document intentionally contains no values.

## Required production variables

| Name                    | Role                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `NODE_ENV`              | Must be `production` for deployed runtime safeguards        |
| `APP_ENV`               | Explicit runtime class: `preview` or `production`           |
| `APP_URL`               | Canonical public application origin                         |
| `SHOPIFY_APP_URL`       | Shopify runtime origin; must match `APP_URL`                |
| `SHOPIFY_API_KEY`       | Shopify application client identifier                       |
| `SHOPIFY_API_SECRET`    | Shopify application secret and signature verification input |
| `SCOPES`                | Granted Shopify scopes                                      |
| `DATABASE_URL`          | Pooled PostgreSQL runtime connection                        |
| `DIRECT_URL`            | Direct PostgreSQL migration connection                      |
| `TOKEN_ENCRYPTION_KEY`  | Encryption key for persisted access and refresh tokens      |
| `WIDGET_SIGNING_SECRET` | Dedicated short-lived widget credential signer              |

`WIDGET_SIGNING_SECRET` may fall back to the Shopify secret for compatibility,
but production should configure a dedicated key so the two trust domains can
rotate independently.

## LLM routing

| Name                                 | Role                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `AI_PROVIDER`                        | Primary provider identifier: `openai`, `kimi`, or approved optional adapter |
| `LLM_TIMEOUT_MS`                     | Per-provider request timeout                                                |
| `LLM_MAX_RETRIES`                    | Bounded retry count; runtime caps unsafe values                             |
| `LLM_FALLBACK_PROVIDERS`             | Ordered comma-separated fallback list                                       |
| `OPENAI_API_KEY`                     | OpenAI credential                                                           |
| `OPENAI_MODEL`                       | OpenAI model identifier                                                     |
| `OPENAI_BASE_URL`                    | Optional OpenAI-compatible endpoint override                                |
| `OPENAI_INPUT_COST_PER_MILLION_USD`  | Optional accounting rate, not billing authority                             |
| `OPENAI_OUTPUT_COST_PER_MILLION_USD` | Optional accounting rate, not billing authority                             |
| `KIMI_API_KEY`                       | Kimi/Moonshot credential                                                    |
| `KIMI_MODEL`                         | Kimi model identifier                                                       |
| `KIMI_BASE_URL`                      | Optional OpenAI-compatible Kimi endpoint                                    |
| `KIMI_INPUT_COST_PER_MILLION_USD`    | Optional accounting rate                                                    |
| `KIMI_OUTPUT_COST_PER_MILLION_USD`   | Optional accounting rate                                                    |
| `ANTHROPIC_API_KEY`                  | Compatibility adapter only; leave unset for the current release             |
| `ANTHROPIC_MODEL`                    | Compatibility adapter only; leave unset for the current release             |

Production acceptance requires `AI_PROVIDER=openai` or `AI_PROVIDER=kimi` and
at least one corresponding approved provider. Fallback must remain empty until
two providers pass a non-commerce smoke test. Provider keys must never be
exposed in merchant configuration or storefront responses.

## Widget and sessions

| Name                                     | Role                                                        |
| ---------------------------------------- | ----------------------------------------------------------- |
| `WIDGET_TOKEN_TTL_SECONDS`               | Short credential lifetime; runtime enforces bounds          |
| `WIDGET_ALLOWED_ORIGINS`                 | Additional explicit storefront origins when needed          |
| `WIDGET_RATE_LIMIT_PER_MINUTE`           | Per-visitor widget request limit                            |
| `WIDGET_NETWORK_RATE_LIMIT_PER_MINUTE`   | Per-shop trusted-network limit when App Proxy data exists   |
| `WIDGET_SHOP_RATE_LIMIT_PER_MINUTE`      | Aggregate per-shop widget request limit                     |
| `WIDGET_BOOTSTRAP_RATE_LIMIT_PER_MINUTE` | Per-shop bootstrap limit, keyed by trusted network if known |
| `COMMERCE_SESSION_TTL_SECONDS`           | Default commerce session lifetime                           |
| `OAUTH_STATE_TTL_SECONDS`                | Customer Account OAuth state lifetime                       |
| `REDIRECT_URL`                           | Customer Account OAuth callback override                    |
| `SHOP_CUSTOM_DOMAIN`                     | Optional custom admin shop domain support                   |

## UCP

| Name                         | Role                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `UCP_AGENT_PROFILE_URL`      | Public Sage agent profile URL sent to UCP services           |
| `UCP_ACCESS_TOKEN`           | Optional business authorization token                        |
| `UCP_ALLOWED_BUSINESS_HOSTS` | Exact external UCP hosts allowed in stable environments      |
| `UCP_CHECKOUT_ENABLED`       | Controls checkout capability advertised by the agent profile |

Merchant flags and discovered business capabilities still govern actual UCP
calls. `UCP_CHECKOUT_ENABLED` does not authorize checkout completion.

## Runtime and observability

| Name                       | Role                                                   |
| -------------------------- | ------------------------------------------------------ |
| `PORT`                     | HTTP listen port                                       |
| `LOG_LEVEL`                | Structured log threshold                               |
| `RAILWAY_ENVIRONMENT_NAME` | Railway-provided environment signal used by URL policy |

## Development and test only

| Name                | Role                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `TEST_DATABASE_URL` | Explicit isolated PostgreSQL integration-test URL; tests also require equality with `DATABASE_URL` |
| `HOST`              | Shopify CLI/Vite transitional development host                                                     |
| `FRONTEND_PORT`     | Development HMR port                                                                               |

## Compatibility aliases to retire

| Name               | Replacement         |
| ------------------ | ------------------- |
| `MOONSHOT_API_KEY` | `KIMI_API_KEY`      |
| `CLAUDE_API_KEY`   | `ANTHROPIC_API_KEY` |

## Secret handling gates

1. Store secrets only in the deployment platform and local ignored files.
2. Preserve `TOKEN_ENCRYPTION_KEY` across deployments and database restores.
3. Rotate provider credentials independently from Shopify and widget signing.
4. Never print environment values in healthchecks, logs, reports, or support
   screenshots.
5. Run `npm run llm:check-config` to verify names and routing without a paid
   provider call.
