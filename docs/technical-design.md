# Technical Design

## Database

PostgreSQL stores trades and their transaction records; Prisma owns queries and
migrations. Start with the [schema](../database/prisma/schema.prisma). SQL-only
checks and triggers live in the [migrations](../database/prisma/migrations).

### Schema and relationships

| Table | Purpose and relationship |
| --- | --- |
| `Instrument` | Seeded USD equity catalogue; one instrument has many trades and at most one summary row. |
| `User` | Individual account and role; owns trades, sessions and idempotency requests, and acts on audit/outbox records. |
| `Session` | Belongs to one user; stores a token hash, last activity and maximum expiry. |
| `Trade` | Current trade state; belongs to one user and instrument; has many versioned audit/outbox records. |
| `IdempotencyRequest` | Saves one creation response and fingerprint per user/key for safe retries. |
| `TradeAudit` | Append-only creation/amendment/cancellation snapshots, linked to the trade and actor. |
| `SymbolSummary` | Current ACTIVE-trade totals per instrument across all traders/books and dates. |
| `OutboxEvent` | Durable delivery intent linked to a trade version and actor; publication/retry state remains mutable. |

IDs are UUID primary keys. Foreign keys prevent orphan records. Referenced trades,
users and instruments generally cannot be deleted while dependent business records
exist. User-to-session deletion cascades; the other deletion relationships restrict.

### Stored values and constraints

- Trade quantity is `Decimal(20,6)`; price is `Decimal(18,4)`. Summary quantities use
  `Decimal(28,6)` and executed values use `Decimal(38,10)`. API/snapshot amounts are
  decimal strings. Summary net quantity is derived as bought minus sold.
- Timestamps use `timestamptz(3)` and serialize to UTC. `tradeDate` is execution
  time; `createdAt` is insertion time. Prisma manages `@updatedAt`; raw SQL updates
  must set it explicitly.
- Enums restrict side, status, role and action/event types. Book/counterparty are
  optional text fields; neither has a separate reference table.
- SQL checks enforce `0 < Trade.price <= 1,000,000`, nonnegative/non-NaN summary
  totals, and nonnegative summary versions. Quantity bounds and trade ownership,
  status and expected-version checks currently live in API/repository logic.
- Audit checks require creation at version 1 with no reason, later actions above
  version 1, and snapshot ID/version matching its row. A statement-level trigger
  rejects UPDATE, DELETE and TRUNCATE. This protects ordinary database operations;
  privileged administrators can change enforcement. See the
  [audit migration](../database/prisma/migrations/20261114105141_add_trade_audit/migration.sql).

### Indexes and their query paths

Primary keys and unique declarations create indexes as well as enforcing identity.
The `Trade.id` index narrows mutation checks to one candidate row; a separate
`(id, userId, status, version)` index is unnecessary for that lookup.

| Unique index | Correctness rule and code path |
| --- | --- |
| `Instrument(symbol)` | One catalogue entry per ticker; creation resolves its instrument. |
| `User(email)` | One account per email; login lookup. |
| `Session(tokenHash)` | Unique token hash; session validation, activity updates and logout. |
| `SymbolSummary(instrumentId)` | One desk summary per instrument; atomic update/upsert target. |
| `IdempotencyRequest(userId, key)` | One saved creation per user/key, including concurrent requests. |
| `TradeAudit(tradeId, tradeVersion)` | One audit entry per revision; also supports per-trade history ordered by version. |
| `OutboxEvent(tradeId, tradeVersion)` | One saved event per revision; this does not prevent duplicate delivery of that event. |

Code: [authentication queries](../backend/src/auth/auth-repository.ts) and
[trade/history/summary/idempotency queries](../backend/src/trades/trade-repository.ts).

| Ordinary index | Query justification |
| --- | --- |
| `Trade(userId)` | Trader-ID filtering. |
| `Trade(instrumentId)` | Instrument filtering/joins, including ticker filtering and the seed summary join. |
| `Trade(tradeDate, id)` | Default newest-first ordering and cursor tie-breaker; a backward scan supplies both descending. |
| `Session(userId)` | User-to-session relationship/cascade lookup; no direct user-session listing endpoint currently uses it. |
| `OutboxEvent(status, nextAttemptAt, createdAt)` | Pending-event eligibility and earliest-attempt ordering. The final ID tie-breaker is outside this index. |

Code: [list query helpers](../backend/src/trades/listing/trade-list-query.ts),
[outbox reads/writes](../backend/src/trades/outbox/outbox-repository.ts), and
[seed summary join](../database/prisma/seed-symbol-summaries.ts).
Index availability does not guarantee planner selection.

To inspect the default first page (100 rows plus one to detect a next page):

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT t.*
FROM "Trade" AS t
ORDER BY t."tradeDate" DESC, t."id" DESC
LIMIT 101;
```

A local 503-row plan changed from sequential scan plus top-N sort to a backward
`Trade_tradeDate_id_idx` scan producing 101 rows with no separate sort. This is
query-plan evidence, not a load benchmark; Prisma relation loading adds other work.

### Transaction boundaries

Successful creation commits trade, audit, summary, outbox and idempotency response
together. Amend/cancel commit trade, audit, any summary change and outbox together.
A failed write rolls back its transaction. Publication occurs after commit.
Versions identify revisions; atomic conditional updates provide concurrency safety.

### Migrations

The [Prisma configuration](../database/prisma.config.ts) reads `database/.env` for
CLI commands; the API reads `backend/.env`. Point both at the intended database.
Run from the repository root:

```sh
pnpm db:validate
pnpm db:migrate:create --name change_name
# Review generated SQL, including existing custom checks/triggers.
pnpm db:migrate:dev
```

Migration history contains the SQL protections absent from the Prisma model.
Apply that history when initializing a database. Seeding is a separate step.

### Seed

Run `pnpm db:seed`. A fresh database receives 10 instruments, 4 demo accounts,
500 synthetic trades, 649 audit entries and 10 symbol summaries. Demo credentials
are in the [README](../README.md#demo-accounts).

[seed.ts](../database/prisma/seed.ts) hashes passwords with individual salts before
opening the seed transaction. Catalogue/accounts are upserted; fixed-ID trades and
histories are inserted together. Summaries are initialized from ACTIVE trades,
including zero rows for unused instruments. Sessions, outbox and idempotency rows
are not seeded.

Reruns preserve existing accounts, trades, history and summary rows, reporting only
newly inserted records. The seed is not a repair/rebuild command for changed or
missing historical data. See [trade fixtures](../database/prisma/seed-trades.ts)
and [summary initialization](../database/prisma/seed-symbol-summaries.ts).
