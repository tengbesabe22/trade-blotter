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

## Filter options

`GET /api/trades/filter-options` requires an active session and permits both roles.
It returns reference lists independent of trade filters, pagination or trade history:

```json
{
  "instruments": [{ "symbol": "AAPL", "name": "Apple Inc." }],
  "traders": [{ "id": "<account-uuid>", "displayName": "JSMITH" }]
}
```

The repository runs two independent reads concurrently: all instruments ordered by
symbol, and TRADER accounts ordered by display name then ID. It selects only the
fields above, does not query trades and needs no transaction. Options with no trades
still appear. Empty tables return empty arrays. The route validates the public
response and strips extra fields; failures use the existing sanitized 500 response.
Missing/expired sessions return 401. This passive read never renews idle time.

**Shared frontend cache:** the contract, `tradeApi.filterOptions(signal)` and
`useTradeOptions()` are implemented. The hook uses the existing workspace QueryClient
and a separate `['trade-options']` key. Consumers share an in-flight request and
completed results, including across temporary unmounts. Data stays fresh for the
workspace lifetime; a new workspace/login gets a new client. Pending requests abort
when the last consumer leaves. There is no polling, focus/reconnect reload or
automatic retry; callers receive loading/error state and an explicit `refetch`.

Create trade and the ticker/trader filters now share the hook. Both signed-in roles
can use the filters; Create trade remains trader-only. The first consumer fetches on
workspace entry/full browser refresh. Filtering, sorting, pagination and SSE reuse
the result without another lookup. No server catalogue cache is added. `Cache-Control: no-store`
prevents HTTP caching; the in-memory application cache is separate.

**Scaling path:** returning both complete lists is scoped to the small reference
tables. For larger catalogues, use independent searchable dropdown lookups with
bounded results (for example 25), cursor pagination, search-term caching, roughly
250 ms typing debounce and cancellation of obsolete requests. Add indexes suited
to the agreed search behavior. Do not silently truncate a complete-list dropdown
or derive its options from loaded trade rows. That search API is not implemented.

## Code organisation

`backend/src/trades/listing/` holds the GET handler, query contract, cursor and
Prisma query helpers. `trade-routes.ts` composes listing and creation; shared
trade DTOs, mapping and repository remain in the parent directory.

## Frontend and verification

The UI provides server sort controls, 25/50/100/200 rows per page, Previous/Next,
First page, refresh, and Ticker/Trader/Status/Side filters. Each offers All or one
exact selection; combined selections use AND across the full server dataset.
Ticker shows symbol/company name; Trader shows display names and sends account IDs.
Options come from the complete reference lookup rather than the loaded trade page.
Loading/failure disables only the ticker/trader dropdowns; errors offer an explicit
retry and expired sessions use the existing sign-in callback. Empty lists retain All. Changing a
filter returns to page one; sorting/page-size changes preserve all filters. Clear
filters resets all four selections together and returns to page one while preserving
sorting, page size and the Create trade draft. It is disabled when no filters are
active and remains usable if the options lookup fails. Other filter controls remain
pending; the API supports the table above.
AG Grid renders the returned page without locally reordering it. TanStack Query
keys include the active request and cancel obsolete fetches; inactive pages are released.
During Next/Previous loading, the previous rows stay visible so the grid remains
mounted and page height stays stable. AG Grid preserves scroll when rows change;
navigation stays disabled until the requested page supplies its own cursor. Filter
changes show loading instead of retaining rows from a different selection. Empty
filtered results say No matching trades.

SSE uses the same ticker/trader/Status/Side rules: resolve versions, filter, then limit. A visible
row leaving the selection is removed immediately and invalidates the page cursor.
Nearby exits batch for 100 ms before one current-page background read. It uses the
selected limit (maximum 200), merges newer buffered events, and does not renew idle
time. Failures retain event-applied rows and offer manual Refresh.

Repository tests use fake database operations. A separate local HTTP smoke check
verified all six sorts in both directions, replayed page requests for Previous, filtering,
and a complete traversal of 500 seeded trades. This is not a load test. New indexes
and larger-data performance measurements remain a focused follow-up.

Listing uses one bounded findMany operation with no explicit read transaction or
opposite-direction probe. Related instrument/user data may require additional SQL
statements; pagination does not provide a snapshot across page visits.
