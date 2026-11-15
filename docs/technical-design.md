# Technical Design

## Database

PostgreSQL stores trades and their transaction records; Prisma owns queries and
migrations. Start with the [schema](../database/prisma/schema.prisma). SQL-only
checks and triggers live in the [migrations](../database/prisma/migrations).

### Schema and relationships

| Table | Purpose and relationship |
| --- | --- |
| [Instrument](../database/prisma/schema.prisma) | Seeded USD equity catalogue; one instrument has many trades and at most one summary row. |
| [User](../database/prisma/schema.prisma) | Individual account and role; owns trades, sessions and idempotency requests, and acts on audit/outbox records. |
| [Session](../database/prisma/schema.prisma) | Belongs to one user; stores a token hash, last activity and maximum expiry. |
| [Trade](../database/prisma/schema.prisma) | Current trade state; belongs to one user and instrument; has many versioned audit/outbox records. |
| [IdempotencyRequest](../database/prisma/schema.prisma) | Saves one creation response and fingerprint per user/key for safe retries. |
| [TradeAudit](../database/prisma/schema.prisma) | Append-only creation/amendment/cancellation snapshots, linked to the trade and actor. |
| [SymbolSummary](../database/prisma/schema.prisma) | Current ACTIVE-trade totals per instrument across all traders/books and dates. |
| [OutboxEvent](../database/prisma/schema.prisma) | Durable delivery intent linked to a trade version and actor; publication/retry state remains mutable. |

IDs are UUID primary keys. Foreign keys prevent orphan records. Referenced trades,
users and instruments generally cannot be deleted while dependent business records
exist. User-to-session deletion cascades; the other deletion relationships restrict.

### Stored values and constraints

- Trade quantity is `Decimal(20,6)`; price is `Decimal(18,4)`. Summary quantities use
  `Decimal(28,6)` and executed values use `Decimal(38,10)`. API/snapshot amounts are
  decimal strings. Summary net quantity is derived in
  [toSymbolSummary](../backend/src/trades/summaries/trade-summary-mapper.ts) as bought minus sold.
- Timestamps use `timestamptz(3)` and serialize to UTC. `tradeDate` is execution
  time; `createdAt` is insertion time. Prisma manages `@updatedAt`; raw SQL updates
  must set it explicitly.
- Enums restrict side, status, role and action/event types. Book/counterparty are
  optional text fields; neither has a separate reference table.
- [Trade_price_check](../database/prisma/migrations/20261111065538_init/migration.sql) enforces `0 < Trade.price <= 1,000,000`;
  [summary checks](../database/prisma/migrations/20261114164348_add_symbol_summary/migration.sql) enforce nonnegative/non-NaN totals and nonnegative versions. Quantity bounds and trade ownership,
  status and expected-version checks currently live in API/repository logic.
- Audit checks require creation at version 1 with no reason, later actions above
  version 1, and snapshot ID/version matching its row. A statement-level trigger
  rejects UPDATE, DELETE and TRUNCATE. This protects ordinary database operations;
  privileged administrators can change enforcement. See the
  [audit checks](../database/prisma/migrations/20261114105141_add_trade_audit/migration.sql) and [reject_trade_audit_changes](../database/prisma/migrations/20261114105141_add_trade_audit/migration.sql).

### Indexes and their query paths

Primary keys and unique declarations create indexes as well as enforcing identity.
The `Trade.id` index narrows mutation checks to one candidate row; a separate
`(id, userId, status, version)` index is unnecessary for that lookup; see the
[guarded cancellation update](../backend/src/trades/trade-repository.ts).

| Unique index | Correctness rule and code path |
| --- | --- |
| [Instrument(symbol)](../database/prisma/migrations/20261111065538_init/migration.sql) | One catalogue entry per ticker; [instrument lookup](../backend/src/trades/trade-repository.ts). |
| [User(email)](../database/prisma/migrations/20261111065538_init/migration.sql) | One account per email; [findUser](../backend/src/auth/auth-repository.ts). |
| [Session(tokenHash)](../database/prisma/migrations/20261111065538_init/migration.sql) | Unique token hash; [findSession](../backend/src/auth/auth-repository.ts), [touchSession](../backend/src/auth/auth-repository.ts), [deleteSession](../backend/src/auth/auth-repository.ts). |
| [SymbolSummary(instrumentId)](../database/prisma/migrations/20261114164348_add_symbol_summary/migration.sql) | One desk summary per instrument; [updateSymbolSummary](../backend/src/trades/trade-repository.ts) / [creation upsert](../backend/src/trades/trade-repository.ts). |
| [IdempotencyRequest(userId, key)](../database/prisma/migrations/20261111065538_init/migration.sql) | One saved creation per user/key; [lookup](../backend/src/trades/trade-repository.ts) / [concurrent-winner recovery](../backend/src/trades/trade-repository.ts). |
| [TradeAudit(tradeId, tradeVersion)](../database/prisma/migrations/20261114105141_add_trade_audit/migration.sql) | One audit entry per revision; [listHistory](../backend/src/trades/trade-repository.ts) reads one trade in version order. |
| [OutboxEvent(tradeId, tradeVersion)](../database/prisma/migrations/20261111065538_init/migration.sql) | One saved event per revision; [creation event insert](../backend/src/trades/trade-repository.ts). Does not prevent duplicate delivery. |

| Ordinary index | Query justification |
| --- | --- |
| [Trade(userId)](../database/prisma/migrations/20261111065538_init/migration.sql) | Trader-ID filtering in [tradeListFilters](../backend/src/trades/listing/trade-list-query.ts). |
| [Trade(instrumentId)](../database/prisma/migrations/20261111065538_init/migration.sql) | [Ticker filter](../backend/src/trades/listing/trade-list-query.ts) and [seed summary join](../database/prisma/seed-symbol-summaries.ts). |
| [Trade(tradeDate, id)](../database/prisma/migrations/20261115113459_add_trade_date_id_index/migration.sql) | Newest-first ordering: [tradeListOrder](../backend/src/trades/listing/trade-list-query.ts) and [list](../backend/src/trades/trade-repository.ts). Scans backward for descending order. |
| [Session(userId)](../database/prisma/migrations/20261111065538_init/migration.sql) | [User-to-session cascade](../database/prisma/migrations/20261111065538_init/migration.sql) lookup; no direct user-session listing endpoint. |
| [OutboxEvent(status, nextAttemptAt, createdAt)](../database/prisma/migrations/20261111065538_init/migration.sql) | [listPending](../backend/src/trades/outbox/outbox-repository.ts) eligibility and earliest-attempt ordering. Final ID tie-breaker is outside this index. |

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

[create](../backend/src/trades/trade-repository.ts) commits trade, audit, summary, outbox and idempotency response
together. [amend](../backend/src/trades/trade-repository.ts) / [cancel](../backend/src/trades/trade-repository.ts) commit trade, audit, any summary change and outbox together.
A failed write rolls back its transaction. Publication occurs after commit.
Versions identify revisions; atomic conditional updates provide concurrency safety.

### Migrations

The [Prisma CLI configuration](../database/prisma.config.ts) loads `database/.env` for
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

[seed](../database/prisma/seed.ts) calls [hashPassword](../database/prisma/seed.ts) with individual salts before
opening the seed transaction. Catalogue/accounts are upserted; fixed-ID trades and
histories are inserted together. Summaries are initialized from ACTIVE trades,
including zero rows for unused instruments. Sessions, outbox and idempotency rows
are not seeded.

Reruns preserve existing accounts, trades, history and summary rows, reporting only
newly inserted records. The seed is not a repair/rebuild command for changed or
missing historical data. See [createSeedTradeFixtures](../database/prisma/seed-trades.ts) / [insertSeedTradeFixtures](../database/prisma/seed-trades.ts)
and [insertSeedSymbolSummaries](../database/prisma/seed-symbol-summaries.ts).

## API Conventions

### Contracts and normalization

Trade contracts use Zod for runtime validation and inferred TypeScript types.
Strict request objects reject unknown fields. Parsing normalizes accepted input
before persistence and creation fingerprinting:

| Field | Accepted input → normalized value |
| --- | --- |
| [Symbol](../backend/src/trades/creation/trade-create-contract.ts) | `" aapl "` → `"AAPL"` |
| [Quantity / price](../backend/src/trades/trade-contract.ts) | Decimal strings → six / four fractional digits; excess precision is rejected rather than rounded. |
| [Execution time](../backend/src/trades/trade-contract.ts) | Seconds and timezone required, with at most millisecond precision → [UTC conversion](../backend/src/trades/creation/trade-create-contract.ts) with three fractional digits. |
| [Creation book / counterparty](../backend/src/trades/creation/trade-create-contract.ts) | Missing, null or trimmed blank → `null`; other text is trimmed. |
| [Amendment book / counterparty](../backend/src/trades/amendments/trade-amend-contract.ts) | Omitted → unchanged; null or trimmed blank → cleared. |

Amounts use Decimal arithmetic rather than JavaScript Number conversion. Bounds
are defined in [quantitySchema](../backend/src/trades/trade-contract.ts) and
[priceSchema](../backend/src/trades/trade-contract.ts);
response schemas require fixed-scale values before normalization can run.

### Request, command and response

| Type | Boundary |
| --- | --- |
| [CreateTradeRequest](../backend/src/trades/creation/trade-create-contract.ts) | HTTP body input (`z.input`), before parsing. |
| [NormalizedCreateTradeRequest](../backend/src/trades/creation/trade-create-contract.ts) | Parsed body (`z.output`), including normalized decimals, UTC time and nullable metadata. |
| [CreateTradeCommand](../backend/src/trades/creation/trade-create-contract.ts) | Repository input: normalized body plus session user ID, idempotency header key and server-computed fingerprint. |
| [TradeResponse](../backend/src/trades/trade-contract.ts) | Public DTO with decimal strings, UTC timestamps, symbol, trader display name and owner ID. |

[toTradeResponse](../backend/src/trades/trade-mapper.ts) flattens the database's
instrument/user relations and formats Decimal/Date values. Full relation objects
and account credentials are excluded. [toTradeCursorBoundary](../backend/src/trades/trade-mapper.ts) extracts the selected sort value
and ID for cursor boundaries.

Successful trade mutations return `{trade}` ([createTradeResponseSchema](../backend/src/trades/creation/trade-create-contract.ts)). Listing returns
`{schemaVersion, generatedAt, trades, pageInfo}` ([tradeListResponseSchema](../backend/src/trades/trade-contract.ts)). Its fixed `schemaVersion: 1`
identifies the supported response format; it is separate from `trade.version`,
which advances on successful amendments/cancellation. No format negotiation exists.

Sources: [createTradeRequestSchema](../backend/src/trades/creation/trade-create-contract.ts)
and [tradeChangesSchema](../backend/src/trades/amendments/trade-amend-contract.ts).
Checks: [normalization test](../backend/test/trade-create-contract.test.ts) and
[public mapping test](../backend/test/trades.test.ts).
