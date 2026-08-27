# Validation Report

Date: 2026-08-02.

## Scope

This validation covers the lab agent system and safe local checks of the
existing Shopify runtime. It did not change product code, OAuth scopes,
environment variables, remote Shopify data, database data, or deployment state.

## Agent-System Checks

| Check | Result |
|---|---|
| Local `AGENTS.md` present | Passed |
| Three agent TOML files parse | Passed with bundled Python `tomllib` |
| Two skill frontmatters parse | Passed with local Ruby YAML parser |
| Two skill UI YAML files parse | Passed with local Ruby YAML parser |
| `LAB_MINI_ME.json` parses | Passed with `python3 -m json.tool` |
| Rules file parses | Passed with `codex execpolicy check` |
| Shopify information command | `shopify version` allowed; version 3.93.2 executed |
| Shopify local development command | `shopify app dev` resolves to `prompt` |
| Shopify deployment command | `shopify app deploy` resolves to `prompt` |
| Credential/environment command | `shopify app env pull` resolves to `prompt` |
| Destructive command | `rm -rf build` resolves to `forbidden` |

The official skill `quick_validate.py` was attempted with both available Python
runtimes and could not start because PyYAML is not installed. No dependency was
installed for a documentation-only run. Equivalent validation parsed the exact
frontmatter and UI YAML, checked required keys, and checked skill-name format.

## Runtime Checks

| Command | Result |
|---|---|
| `npm test` | Passed: 15 files and 105 tests; 1 PostgreSQL file and 8 tests skipped because the disposable database prerequisite was not provided |
| Focused Shopify/security suite | Passed: 4 files and 22 tests |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed: client and SSR production bundles built |

The build emitted React Router v8 future-flag warnings. These are upgrade
notices, not current build failures.

## Non-Mutating Remote Evidence

The configured Railway service was queried only with safe GET requests during
this setup:

- `/health`: HTTP 200.
- `/health/db`: HTTP 200.
- `/ucp/agent-profile`: HTTP 404.

This establishes endpoint health at the observation time, not the deployed Git
revision or full production readiness. The 404 means the candidate UCP profile
route is not evidenced on that deployed service.

## Boundary Review

Passed by current code/test evidence:

- fixed five-page Admin navigation;
- signed App Proxy context;
- short-lived widget credential binding;
- tenant-aware rate limiting;
- encrypted and rotating Shopify session storage;
- authenticated and idempotent webhook handling;
- explicit cart confirmation and durable mutation idempotence;
- validated Shopify checkout handoff;
- thin Liquid shell with no observed ranking or cart logic.

Open findings:

1. `extensions/chat-bubble/assets/chat.js` still contains inline, configured,
   and contextual opening paths. The required `autoOpen = false` invariant is
   not yet fully implemented.
2. `app/routes/app.widget.jsx` and the Liquid schema both own overlapping
   storefront presentation/entry settings.
3. Generated dev/deploy manifests differ and cannot identify the active remote
   application revision.
4. Accessibility has useful primitives but no complete focus-trap evidence.
5. No authorized two-store install-to-checkout or representative live-theme
   matrix was run.

## Checks Intentionally Not Run

- `shopify app dev` because it can create a tunnel and persist development
  configuration.
- `shopify app deploy` because deployment requires explicit approval.
- PostgreSQL integration tests because no disposable `TEST_DATABASE_URL` was
  provided for this run.
- Paid or credentialed LLM calls.
- Live Shopify product, cart, checkout, install, uninstall, or reinstall
  mutations.
- Remote database migration, rollback, backup, or restore.

## Conclusion

The agent system is structurally valid, its command policy is executable, the
local deterministic suite is green, and the production build succeeds. The lab
is correctly configured for disciplined Shopify surface work, but closed
startup, Theme Editor ownership, live two-store commerce proof, and deployed
revision evidence remain release gates.
