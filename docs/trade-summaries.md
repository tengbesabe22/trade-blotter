# Trade summaries

**Implemented:** calculation helper, SymbolSummary model/migration and seeded totals.
The local database has been reset and reseeded. Create, amend and cancel now update
summaries transactionally. The read response contract, repository, mapper and GET endpoint are implemented/tested.
Create, amend and cancel capture their resulting summary snapshots in the outbox;
the relayer sends one event shape containing trade and summaries, with no format
version. Trade and summary revisions remain independent. The frontend now loads and
merges summaries in a separate Position Summary tab beside Trades.

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
is used by creation; amendments/cancellations use the before/after delta helper.
HTTP response and SSE payload shapes are unchanged.

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

The UI uses separate Trades and Position Summary tabs. Position Summary shows current
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
At the migration slice, all 643 project tests (11 database, 352 backend, 280 frontend),
schema validation, root typecheck and root build passed.

## Creation transaction

After inserting the trade and audit entry, creation calculates the new trade's
contribution and upserts its SymbolSummary before saving the outbox/idempotency rows.
The same transaction commits all five writes or aborts on failure.
Creation now keeps the row returned by the scalar-only upsert and maps it with
symbol/currency from the existing catalog lookup. Its outbox payload is
{trade, summaries: [snapshot]}. The snapshot holds exact resulting aggregate totals,
version and updatedAt from that write; it is not just the new trade's contribution.
No later summary read or nested upsert relation query is added.

- Missing summary: create it with the contribution and version1.
- Existing summary: increment the four amounts and version atomically.
- BUY affects bought quantity/value; SELL affects sold quantity/value.
- Replays, key conflicts and unknown instruments do not update summaries.
- A concurrent idempotency loser rolls back its attempted summary change before
  reading the winner. Summary errors are not mistaken for idempotency conflicts.

There is no prior summary lookup. The scalar-only unique instrumentId upsert meets
Prisma's documented PostgreSQL database-upsert criteria; adding nested relation
reads/writes could change that behavior. updatedAt is handled by Prisma.
Twenty creation repository tests use fake persistence to check transaction ordering,
upsert create/update arguments, exact decimals, failure propagation and replay paths.
They do not verify PostgreSQL concurrency or rollback directly. The create-only
slice passed all357 backend tests, root typecheck and backend build.

The capture slice passes 22 creation repository tests and 14 relayer tests, using
fake persistence. Coverage includes returned aggregate versions/times, BUY/SELL and
large exact amounts, invalid snapshots, failure paths, replay paths, and compatibility
with old/raw and new/wrapped creation payloads. All 413 backend tests, root typecheck
and backend build pass. These checks do not exercise real PostgreSQL concurrency.
HTTP/idempotency responses remain {trade}. The relayer now publishes the stored
trade and summary snapshots through the single trade.changed contract.

## Amendment and cancellation transactions

Both mutations call a small private updateSymbolSummary helper in the existing
trade repository, after the audit entry and before the outbox. The helper skips
zero deltas and atomically increments the four totals and independent version.
It updates an existing row; missing summaries or invalid resulting totals cause
an error and abort the whole transaction instead of inventing a partial baseline.
The helper now maps the returned update row into a one-element summaries array,
using symbol/currency from the existing trade relation. Zero deltas return [].
Each outbox payload stores {trade, reason, summaries} inside the same transaction.
There is no extra summary query or post-commit reconstruction of totals.

Amendment computes contribution(after) minus contribution(before), reusing the
trade states already read. Quantity/price/side changes adjust totals; metadata-only
changes retain trade history/events without changing summary values or version.
Cancellation changes no economic fields, so its guarded update's returned quantity,
price and side describe the prior ACTIVE contribution. Compare that ACTIVE state
with the CANCELLED state and subtract it. No extra trade lookup is added. Keep the
summary row and increment its version even when its totals reach zero.

Failed ownership/version/status checks, no-ops and losing mutations never adjust
summaries. Audit, summary or outbox errors abort the transaction. Thirty-seven
amend/cancel repository tests cover signed quantity/value changes, side flips,
metadata-only changes, exact large decimals, failure paths and no extra cancellation
read. Combined with creation, all57 mutation repository cases and all368 backend
tests pass, with root typecheck/build. These tests use fake persistence, not live
PostgreSQL concurrency/rollback checks. No schema/data or API/SSE shape change.

The amend/cancel capture slice passes all 40 repository cases and 14 relayer cases.
Tests cover captured aggregate totals/revisions/times, metadata-only empty arrays,
retained zero rows and invalid snapshots aborting the transaction. All 416 backend tests, root typecheck and backend build pass.
Persistence is faked; no live PostgreSQL concurrency/rollback check was added. HTTP
responses remain {trade}; SSE carries the trade and captured summaries.

## Read response contract

The GET /api/summaries response is `{schemaVersion: 1, generatedAt, summaries}`.
It is one complete desk-wide list, including retained zero rows, independent of
trade filters/pages. Empty lists are valid; there is no pagination or arbitrary
100-instrument cap. Each instrument ID must appear once, ignoring UUID letter case.

`symbolSummarySchema` describes one row: instrumentId, normalized symbol, USD
currency, buyQuantity, sellQuantity, netQuantity, buyValue, sellValue, version and
updatedAt. Quantities are canonical six-place decimal strings (22 whole digits
maximum); executed values use ten places (28 whole digits). Bought/sold quantities
and values are nonnegative. Net quantity permits a minus sign, with unsigned zero
for flat positions. Amount bounds follow the aggregate database columns, rather
than the stricter limits on one trade. Versions span zero through PostgreSQL Int's
maximum; times are UTC ISO strings with milliseconds.

The contract validates payload formats and identity uniqueness. The read mapper
derives netQuantity as bought minus sold with exact decimal arithmetic; it is not
calculated by the schema. Direction follows its sign in the frontend.
There are no trader/book/date scope fields, market prices or P&L fields in this
response. Stored buyValue/sellValue are included for future valuation work; the
initial position panel renders the quantity fields.

Ten schema tests cover exact strings, zero/long/short/flat rows, aggregate bounds,
invalid formats, revisions, normalized identity, USD/UTC, duplicate keys and empty/
large lists. All378 backend tests, root typecheck and backend build pass. The route,
read repository and SSE contract are not changed in this slice.

## Read repository and mapper

TradeRepository.listSummaries reads all stored SymbolSummary rows, ordered by
instrument symbol, with only symbol/currency selected from the instrument relation.
It does not scan trades, apply blotter filters, paginate or recalculate stored totals.
An empty table returns an empty list. No multi-query transaction is needed.

trade-summary-mapper.ts converts each row to the public symbol summary. For example,
buyQuantity=100 and sellQuantity=30 produce netQuantity="70.000000". It preserves
stored versions/timestamps, formats quantities to six places and values to ten, and
validates the result against symbolSummarySchema. Internal row IDs are omitted.
An isolated Decimal constructor with precision 40 preserves subtraction across all
28 quantity digits without changing global Prisma Decimal settings. No Number
conversion is used. Invalid rows and database failures propagate to the caller.

Ten additional tests use fake persistence and real Prisma Decimal values, covering
mapping, long/short/flat/zero rows, aggregate precision boundaries, complete/empty
reads and failure paths. All 388 backend tests, root typecheck and backend build
pass. No live database test or HTTP/SSE/frontend change is part of this slice.

## GET endpoint

GET /api/summaries requires a valid session; both TRADER and READ_ONLY can read the
same desk-wide totals. The route calls listSummaries, adds schemaVersion=1 and a
UTC generatedAt, then validates the complete response with tradeSummaryResponseSchema.
An empty list returns 200. generatedAt records response generation time; stored
per-symbol versions/timestamps describe the summary rows.

The existing session middleware supplies Cache-Control: no-store and rejects missing,
revoked or expired sessions with 401 before reading summaries. Foreground requests
record activity. Automatic reads should send X-Session-Activity: background so they
validate the session without extending idle time. Invalid response data or repository
failures use the existing sanitized 500 response.

Eleven route tests use fake repositories and an injected clock. All 399 backend
tests, root typecheck and backend build pass. A separate read-only check of the local
database found all 10 instrument summaries present and all four totals equal to the
ACTIVE trade aggregates. This verification changed no data and is not a CI dependency.

## Frontend tabs and live positions

Trades is the default tab. Position Summary loads its complete desk baseline on
first opening, after stream.ready or through HTTP fallback if SSE is unavailable.
After first use, both views remain mounted: switching retains filters, pagination,
create/amend drafts and loaded positions without another connection or summary read.
Both account roles can view positions. Arrow keys and Home/End navigate the tabs.

The position view shows Symbol / Bought / Sold / Net quantity / Direction. Positive
net is Long, negative is Short, and zero is Flat under the zero-opening assumption.
Quantity formatting groups string digits and trims trailing fractional zeros; it
never converts financial values to Number. Zero-valued symbol rows remain visible.

usePositionSummaries owns the ['position-summaries'] query and one latest event row
per instrument. That buffer protects events received before the tab opens or while
an older HTTP response is pending. It does not retain event history and is released
with the signed-in workspace. trade-summary-merge.ts selects the greatest independent
summary version per instrument. Duplicate/older snapshots do not change totals.
Summary processing happens before the trade version guard, so an older trade record
cannot suppress a newer summary carried with it.

stream.ready cancels old requests and refreshes both loaded datasets. Recovery GETs
use X-Session-Activity: background; first opening and deliberate Refresh count as
user activity. Ordinary summary events update the cache directly without a GET.
Blotter filters do not redefine the summary scope. HTTP mutation responses remain
{trade}; summary updates arrive through the shared SSE event.

Loading, empty, synchronising, disconnected, failed-read and expired-session states
are explicit. Failed refreshes keep labelled last data and a retry action. Events
remain buffered during a failed baseline/recovery; the next successful snapshot
merges them before clearing the warning. HTTP fallback supports manual refresh.
Expired sessions hide the data and offer sign-in.

Checks: 311 frontend tests pass, including 24 new API, merge and UI cases. Frontend
build/typechecking and lint pass. Tests use mocked fetch/EventSource and real React/
TanStack Query; the existing live trade suite also remains green. In two local
browser clients, a synthetic AAPL BUY of 1, amendment to 2, and cancellation moved
the receiving net from 9,112.625 to 9,113.625, then 9,114.625, and back to 9,112.625
without receiver refresh. The test trade remains CANCELLED with its audit history.

## Next work

Position Summary is implemented. P&L stays deferred. Prioritize documentation cleanup,
backend logging, p95/p99 load measurements and deployment. Do not add valuation marks
or P&L implementation to this feature.

References: [Decimal.js independent constructors](https://mikemcl.github.io/decimal.js/#Dclone),
[IBKR daily trade log](https://www.ibkrguides.com/traderworkstation/trade-log.htm),
[NYSE session times](https://www.nyse.com/markets/hours-calendars), and
[IBKR daily versus new-position P&L](https://www.ibkrguides.com/traderworkstation/profit-and-loss.htm).

[Prisma 7 database upsert criteria](https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference#database-upsert-query-criteria).
