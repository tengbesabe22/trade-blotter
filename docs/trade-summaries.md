# Trade summaries

**Implemented:** calculation helper, SymbolSummary model/migration and seeded totals.
The local database has been reset and reseeded. Mutation wiring, API/SSE and UI
remain planned.

## Scope

Summaries will cover current ACTIVE trades across all execution dates and books,
independently of blotter filters/pagination. One desk-wide scope covers all traders
and books; there is no summary trader filter or per-trader table. Cancelled trades contribute zero. History
snapshots are not separate positions. Net traded quantity is BUY quantity minus
SELL quantity, with zero assumed opening positions. The initial view will show
Symbol / Bought / Sold / Net quantity; value fields support the later P&L view.

## Calculation helper

`backend/src/trades/summaries/trade-summary-calculation.ts` supplies:

- calculateTradeContribution: BUY/SELL quantities and executed values for one trade.
  buyValue/sellValue mean quantity multiplied by execution price, excluding fees.
- calculateSummaryDelta: contribution(after) minus contribution(before).
  Creation uses before=null; cancellation uses the cancelled trade as after.
- hasSummaryChanges: whether any of the four amounts changed. Book, counterparty
  and execution-time edits alone do not alter these all-book/all-date totals.

Example: BUY 10 at USD 100 contributes buyQuantity=10 and buyValue=1000.
Amending to 12 at USD 100 produces +2 quantity and +200 value. Cancelling the
amended trade produces -12 quantity and -1200 value, with no SELL contribution.
The delta will update the desk-wide row for that symbol.

Inputs are already validated trade data. Amounts stay Decimal values through the
calculation; future response mapping will format quantity strings to six decimal
places and executed values to ten. No rounding or Number conversion happens here.
Bounded trade products can require 25 significant digits. An isolated Decimal
constructor uses precision 40 for product/delta headroom without changing shared
Prisma Decimal configuration. The model uses wider aggregate precision as below.

Ten tests cover contributions, create/amend/side-change/cancel deltas, metadata-only
changes and high-precision boundary arithmetic. They need no database. The helper
is not yet called by mutation repositories, so it changes no existing API behavior.

## Current desk summary model

SymbolSummary has a UUID primary key and one required, unique instrumentId. Its
foreign key prevents deletion/ID changes of a referenced instrument. The reverse
Instrument.summary relation is optional until the row exists.

| Fields | Storage/default | Meaning |
| --- | --- | --- |
| buyQuantity, sellQuantity | Decimal(28,6), zero | Current ACTIVE execution quantities |
| buyValue, sellValue | Decimal(38,10), zero | Summed quantity times execution price |
| version | Int, zero | Independent revision for future SSE merge ordering |
| updatedAt | timestamptz(3), now/@updatedAt | Last summary change; raw SQL must set it |

Net quantity and direction are derived. Keep zero-valued rows/revisions. Unique
instrumentId also indexes the planned lookup; no extra indexes are added. SQL
checks reject negative totals/version and numeric NaN. Decimal column limits reject
overflow. The schema-only migration creates no data and takes no explicit Trade
table lock. It is applied to the local development database.

The accepted UI is a docked Position Summary under the blotter. It shows current
positions across all available dates, across all traders/books, with zero assumed
opening positions. Trade-list date filters affect executions only. P&L will have
its own day selection later; neither it nor historical position queries are added
here. Position shows exposure; P&L supplies performance context.

Our From/Through filters currently select UTC calendar days. A From/Through pair
with the same date selects that UTC day, not necessarily a US market day, whose
sessions are defined in Eastern Time. Daily P&L additionally needs carried/opening
positions and valuation at its period boundaries; filtering today's executions
alone is not a full daily portfolio P&L calculation. Its day/valuation contract
must be reviewed before implementation. Demo marks remain indicative.

## Seed and verification

The developer chose a fresh local reset/reseed instead of migration backfill. The
migration creates only the table, keys and checks. Existing migration files are
retained; all four run during reset. No separate backfill script is introduced.

After trades and audit histories are inserted, seed-symbol-summaries.ts groups
current ACTIVE trades by instrument inside the same seed transaction. PostgreSQL
calculates exact quantity and quantity-times-price sums. A LEFT JOIN includes
instruments without ACTIVE trades as zero rows/version0; populated rows start at1.
Prisma bulk-inserts with skipDuplicates so reruns preserve existing totals and
versions. It reports actual inserted counts. A failure aborts the owning transaction.
This initializes demo data; it is not a repair/rebuild command for stale summaries.

After fresh explicit reset consent, the local database contained 10 instruments,
4 accounts, 500 trades, 649 audit entries and 10 summaries. Independent SQL read-back
matched all four totals and initial versions against ACTIVE trades. A second seed
added zero trades/audits/summaries and preserved every summary ID, amount, revision
and timestamp. No sessions, idempotency requests or outbox events were seeded.

Five fake-persistence unit tests cover exact values, zero rows, actual inserted
counts, reruns, empty catalogues and read/write failures. An isolated PostgreSQL 18
check exercised the full migration chain, empty table after schema migration,
defaults, negative/NaN/version guards, uniqueness, reference restrictions, precision,
overflow and rollback. These one-off SQL checks are not a database dependency in CI.
All 643 project tests (11 database, 352 backend, 280 frontend), schema validation,
root typecheck and root build pass.

## Next slice

Wire create/amend/cancel summary adjustments into the trade/audit/outbox transactions.
The initial seeded totals do not update automatically yet, and no summary endpoint
or UI is enabled. Valuation marks and indicative P&L remain later work. Summary
updates will push authoritative versioned snapshots through the existing SSE path.

References: [Decimal.js independent constructors](https://mikemcl.github.io/decimal.js/#Dclone),
[IBKR daily trade log](https://www.ibkrguides.com/traderworkstation/trade-log.htm),
[NYSE session times](https://www.nyse.com/markets/hours-calendars), and
[IBKR daily versus new-position P&L](https://www.ibkrguides.com/traderworkstation/profit-and-loss.htm).
