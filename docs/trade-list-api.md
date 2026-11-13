# Listing trades

`GET /api/trades` requires a signed-in session. Both roles can read all trades.

For a worked dataset and an Excalidraw drawing plan, see the
[pagination walkthrough](trade-pagination-flow.md).

## Pagination and sorting

The response contains one page, defaulting to 100 rows (maximum 200):

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-13T09:00:00.000Z",
  "trades": [],
  "pageInfo": {
    "limit": 100,
    "nextCursor": null
  }
}
```

Start with:

```http
GET /api/trades?limit=25&sortBy=tradeDate&sortDirection=desc
```

For Next, repeat the same query and add `after=<nextCursor>`. A null nextCursor
means there are no more rows. Previous is handled by the frontend: remember the
cursor used for each page and resend the earlier request. There is no before
parameter or server-issued Previous cursor. No total or page count is calculated.

Sort fields: `tradeDate` (default), `symbol`, `trader`, `quantity`, `price`,
`status`. Direction is `desc` by default, or `asc`. Every sort uses trade ID
as the tie-breaker in the same direction. Decimal sorting happens in PostgreSQL.

Cursors are plain base64url JSON containing the format version, sort direction
and boundary value/ID. They have no signature, secret or expiry. Normal session
authorisation applies to every request. Cursor contents are validated, then used
as query values. No lookup of the original boundary row is required.

Reset frontend cursor history to the first page after changing filters, sorting or page size. Data can
change between requests: pagination is not a historical snapshot. An empty older
page still allows Previous/First page recovery from frontend history.

## Filters

Combine fields with AND; repeat a selection field to match any selected value.

| Parameter | Matching |
| --- | --- |
| `symbol` | Exact selection, trimmed/uppercased |
| `traderId` | Exact account UUID |
| `status` | ACTIVE or CANCELLED; omitted means both |
| `side` | BUY or SELL; omitted means both |
| `book`, `counterparty` | Trimmed, case-insensitive literal contains |
| `tradeDateFrom` | Inclusive execution time |
| `tradeDateTo` | Exclusive execution time |

Selection fields allow at most 20 supplied values each. Book/counterparty limits
are 64/120 characters. Date bounds require timezone-bearing timestamps with seconds
and up to millisecond precision. Both bounds must describe a non-empty range.
The default view includes cancelled trades.

```http
GET /api/trades?symbol=AAPL&symbol=MSFT&status=ACTIVE&counterparty=goldman
```

Unknown keys (including before), duplicate singleton parameters and invalid values return
`400 INVALID_INPUT`. Malformed or sort-incompatible cursors return
`400 INVALID_CURSOR`. Invalid sessions return 401; unexpected failures return a
sanitised 500.

## Code organisation

`backend/src/trades/listing/` holds the GET handler, query contract, cursor and
Prisma query helpers. `trade-routes.ts` composes listing and creation; shared
trade DTOs, mapping and repository remain in the parent directory.

## Frontend and verification

The UI provides server sort controls, 25/50/100/200 rows per page, Previous/Next,
First page, and refresh. Filter form controls remain pending; API filters work now.
AG Grid renders the returned page without locally reordering it. TanStack Query
keys include the active request and cancel obsolete fetches; inactive pages are released.

Repository tests use fake database operations. A separate local HTTP smoke check
verified all six sorts in both directions, replayed page requests for Previous, filtering,
and a complete traversal of 500 seeded trades. This is not a load test. New indexes
and larger-data performance measurements remain a focused follow-up.

Listing uses one bounded findMany operation with no explicit read transaction or
opposite-direction probe. Related instrument/user data may require additional SQL
statements; pagination does not provide a snapshot across page visits.
