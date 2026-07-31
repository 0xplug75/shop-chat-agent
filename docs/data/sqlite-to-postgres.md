# SQLite to PostgreSQL development-data migration

The Prisma provider is now PostgreSQL. The migration chain creates the legacy
tables first and then applies the multi-tenant foundation. It is safe for a fresh
empty PostgreSQL database. It does not infer tenant ownership for existing
SQLite rows.

## Default recommendation

Treat the current SQLite file as development-only. Start a fresh PostgreSQL
database, reinstall the app on the development shop, and allow IntentCart to
create canonical `Shop`, configuration, and conversation records. This avoids
carrying plaintext legacy customer tokens and expired OAuth state forward.

## Preserve development records only when needed

1. Stop writes to the SQLite application.
2. Copy `prisma/dev.sqlite` to an encrypted backup outside version control.
3. Export each legacy table to JSON or CSV with `sqlite3`.
4. Apply all Prisma migrations to an empty PostgreSQL database.
5. Create one canonical `Shop` row per verified `*.myshopify.com` domain.
6. Transform and import records in dependency order.
7. Verify row counts and tenant ownership before switching the app URL.

Suggested import order:

```text
Shop
Session
MerchantConfig (normally seeded instead of imported)
Conversation
Message
CustomerAccountUrls (or rediscover)
KnowledgeSource -> KnowledgeDocument -> KnowledgeChunk
CommerceSession -> CommerceEvent
```

## Required transformations

| Legacy data | PostgreSQL treatment |
|---|---|
| `Conversation.shopId` | Resolve only a verified canonical domain to the new internal `Shop.id` |
| `Message` | Copy the parent conversation's internal `shopId` into `Message.shopId` |
| `CustomerToken` | Do not import plaintext tokens; delete them and require reauthorization |
| `CodeVerifier` | Do not import; OAuth state is short-lived and must be recreated |
| `CustomerAccountUrls` | Attach to the verified shop/conversation or rediscover from Shopify |
| JSON-like text | Parse, validate with current Zod contracts, then insert as JSONB |
| Unknown/null tenant | Quarantine the row; never assign a default merchant silently |

Do not insert rows with disabled foreign keys and do not invent a shop mapping.

## Local PostgreSQL

Start the repository's disposable PostgreSQL service:

```bash
docker compose -f infra/docker-compose.postgres.yml up -d
```

Use these local-only values in an untracked `.env`:

```env
DATABASE_URL=postgresql://intentcart:intentcart@localhost:5433/intentcart
DIRECT_URL=postgresql://intentcart:intentcart@localhost:5433/intentcart
```

Apply and verify:

```bash
npm run migrate:deploy
npm run db:validate
TEST_DATABASE_URL="$DATABASE_URL" npm run test:integration
```

Stop the container without deleting its volume:

```bash
docker compose -f infra/docker-compose.postgres.yml down
```

Deleting the local volume is destructive and is intentionally not part of this
runbook.

## Acceptance checks

- Every merchant-owned row has a valid `shopId` foreign key.
- A shop A context cannot retrieve shop B configuration, conversations, chunks,
  sessions, cart IDs, tokens, or events.
- No plaintext customer token or OAuth verifier exists in PostgreSQL.
- Knowledge `searchVector` and its GIN index exist.
- Prisma reports every migration applied.
- Unit, integration, typecheck, lint, and production build pass.

No remote data migration was executed as part of the architecture work.
