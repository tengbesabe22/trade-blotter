# Trade summaries

**Implemented:** pure trade-contribution and change calculations, with unit tests.
Storage tables, transaction wiring, summary API/SSE and UI remain planned.

## Scope

Summaries will cover current ACTIVE trades across all execution dates and books,
independently of blotter filters/pagination. The default covers all traders; a trader
filter selects that account's totals. Cancelled trades contribute zero. History
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
The same delta will update the symbol-wide and owning trader's symbol summary.

Inputs are already validated trade data. Amounts stay Decimal values through the
calculation; future response mapping will format quantity strings to six decimal
places and executed values to ten. No rounding or Number conversion happens here.
Bounded trade products can require 25 significant digits. An isolated Decimal
constructor uses precision 40 for product/delta headroom without changing shared
Prisma Decimal configuration. Aggregate storage precision is still to be reviewed.

Ten tests cover contributions, create/amend/side-change/cancel deltas, metadata-only
changes and high-precision boundary arithmetic. They need no database. The helper
is not yet called by mutation repositories, so it changes no existing API behavior.

## Next slice

Review the proposed SymbolSummary/TraderSymbolSummary fields, wider decimal storage
precision and initial totals for existing trades before creating migrations.
Valuation marks and indicative P&L follow the same quantity/value foundation.
Persist independent summary revisions and retain zero-valued rows; summary delivery
will use authoritative versioned snapshots over the existing outbox/SSE path.

Reference: [Decimal.js independent constructors and configuration](https://mikemcl.github.io/decimal.js/#Dclone).
