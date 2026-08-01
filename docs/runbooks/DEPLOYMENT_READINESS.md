# IntentCart deployment readiness

The canonical step-by-step deployment and rollback procedure is now
`docs/runbooks/PRODUCTION_DEPLOYMENT.md`. This checklist remains the compact
gate view.

This is a checklist, not evidence that a deployment occurred. The stabilization
run did not change Railway, Shopify, Supabase, or Git remotes.

## Current verdict

| Environment       | Status            | Reason                                                          |
| ----------------- | ----------------- | --------------------------------------------------------------- |
| Local fixture     | Ready and tested  | Deterministic commercial E2E passes                             |
| Local PostgreSQL  | Ready and tested  | 11 migrations, 113 tests, and 3 rollbacks pass on PostgreSQL 16 |
| Preview           | Not prepared      | No distinct preview service/database was verified               |
| Development store | Not validated     | Remote installation/cart test not run                           |
| Production        | Do not deploy yet | Provider, Shopify config, preview, backup, and E2E gates remain |

## 1. Freeze an exact revision

- Review the complete diff and preserve unrelated user documents.
- Run all commands in the validation section below.
- Create a commit only after review; deploy a commit SHA, never a dirty
  worktree.
- Record the SHA in the release ticket and deployment evidence.

## 2. Configure a stable origin

For preview and production:

- set `APP_ENV` to `preview` or `production`;
- set `APP_URL` and `SHOPIFY_APP_URL` to the same stable HTTPS origin;
- set `REDIRECT_URL` to `<origin>/customer-auth/callback` or omit it to use the
  derived value;
- set `WIDGET_ALLOWED_ORIGINS` to explicit storefront origins;
- never use localhost or a `trycloudflare.com` host.

The runtime derives:

```text
Admin OAuth callback:       <origin>/auth/callback
Customer Account callback: <origin>/customer-auth/callback
App Proxy target:           <origin>/widget
Healthcheck:                <origin>/health
Database healthcheck:       <origin>/health/db
```

## 3. Prepare secrets and provider config

Required names, never values:

```text
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
DATABASE_URL
DIRECT_URL
TOKEN_ENCRYPTION_KEY
WIDGET_SIGNING_SECRET
AI_PROVIDER
LLM_TIMEOUT_MS
```

Configure one approved release provider:

```text
OPENAI_API_KEY + OPENAI_MODEL
KIMI_API_KEY + KIMI_MODEL + optional KIMI_BASE_URL
```

`CLAUDE_API_KEY` and `MOONSHOT_API_KEY` are compatibility aliases, not the
preferred production names. The Anthropic adapter is compatibility-only for
this release. Keep fallback providers empty until each approved provider has
passed the same contract and operational smoke checks.

Before migration, verify the existing `TOKEN_ENCRYPTION_KEY` is retained and
recoverable. Replacing it without a rotation plan makes stored tokens
undecryptable.

## 4. Database migration order

1. Create a database backup and record its restoration procedure.
2. Apply to an isolated preview database first:

   ```bash
   npm run db:generate
   npm run db:validate
   npm run migrate:deploy
   npm run test:integration
   ```

3. Inspect schema metadata and migration history; never print token values.
4. Run installation, refresh, concurrent refresh, mutation timeout, duplicate
   confirmation, and checkout tests in preview.
5. Schedule a production maintenance window and apply migrations before the new
   application revision starts accepting traffic.

Migration order is fixed:

```text
20260801090000_secure_expiring_offline_sessions
-> 20260801100000_commerce_mutation_journal
-> 20260801120000_agentic_shopping_core
```

All three migration directories contain `rollback.sql`, but rollback is manual
and potentially destructive. Prisma does not execute those files automatically.
Prefer application rollback plus forward repair when journal records or rotated
token metadata already exist. Use rollback SQL only after backup and explicit
database approval.

## 5. Shopify configuration alignment

After the preview deployment is healthy, align the authorized Shopify app
configuration with the same stable origin:

- application URL;
- admin OAuth callback `/auth/callback`;
- App Proxy URL `/widget` with prefix `apps` and subpath `intentcart`;
- Customer Account callback `/customer-auth/callback`;
- webhook endpoint `/api/webhooks`;
- Theme App Extension release used by the development theme.

Do not rely on `shopify app dev` URL rewriting: tracked configs set
`automatically_update_urls_on_dev = false`.

## 6. Validation commands

```bash
npm ci
npm run db:generate
npm run db:validate
npm run llm:check-config
npm test
npm run test:e2e:deterministic
npm run typecheck
npm run lint
npm run build
```

The repository-wide format check has a known pre-existing backlog. It must be
reported separately from newly introduced formatting changes.

## 7. Preview gates

- `/health` and `/health/db` return success.
- Installed admin iframe uses the stable preview origin.
- Offline session is encrypted and refresh metadata advances atomically.
- One real, non-commerce LLM smoke response succeeds with timeout and request
  ID visible in sanitized logs.
- The full development-store runbook passes.
- Duplicate confirmation creates no duplicate cart line.
- A post-start timeout stays `unknown` and produces no provider fallback.
- Webhook delivery and uninstall revocation are verified on a disposable
  installation.

## 8. Production rollout

1. Back up production PostgreSQL.
2. Apply migrations with the pre-deploy command and verify migration history.
3. Deploy the frozen SHA with one primary provider and no unproven fallback.
4. Verify `/health`, `/health/db`, admin embed, widget bootstrap, and a read-only
   catalog query.
5. Canary one explicitly authorized test-shop cart journey; stop before
   payment.
6. Monitor LLM errors, token refresh failures, `unknown` mutations, webhook
   failures, and request latency.
7. Expand only after a clean observation window.

## 9. Recovery plan

Application rollback:

- restore the previously healthy application SHA;
- keep the additive database schema unless incompatibility is proven;
- disable the widget or provider at configuration level if checkout safety is
  uncertain;
- do not retry `unknown` mutations; reconcile them against Shopify cart state.

Token incident:

- preserve encryption keys and database backup;
- invalidate affected sessions and require Shopify reauthorization;
- never copy token values into tickets or logs.

Provider incident:

- fallback is permitted only before commerce side effects start;
- after start, return a recoverable status to the shopper and reconcile the
  mutation journal;
- disable the failing provider only after checking in-flight journal states.

## 10. Post-deploy evidence

Record without secrets:

- deployed commit SHA and migration IDs;
- Railway deployment identifier and region;
- Shopify config release identifier;
- healthcheck timestamps/statuses;
- selected LLM provider/model and smoke result;
- dev-store E2E report;
- count of token refresh failures and unknown mutations;
- rollback owner and decision window.
