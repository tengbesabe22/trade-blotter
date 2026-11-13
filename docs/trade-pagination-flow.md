# Trade pagination

## Backend: always fetch forward

Every request applies the same four steps:

```text
Filters + optional after boundary -> ORDER BY chosen field, ID -> LIMIT page size + 1
```

Return the first page-size rows. If an extra row exists, return a nextCursor built
from the last returned trade; otherwise nextCursor is null.

There is one findMany call, no reverse query, opposite-page probe or explicit read
transaction. Prisma may still issue separate SQL statements to load related data.

## Frontend: remember page requests

Suppose prices are ascending and the page size is 3:

| Page | Trades |
| --- | --- |
| 1 | A: 100.0000, B: 100.0000, C: 101.0000 |
| 2 | D: 102.0000, E: 103.0000, F: 104.0000 |
| 3 | G: 105.0000, H: 106.0000, I: 107.0000 |

Letters stand for UUIDs; A's ID sorts before B's when their prices tie.
All example trades are ACTIVE AAPL trades.

```text
Page 1: GET with no after       History: [null]
Page 2: GET after cursor C      History: [null, cursorC]
Page 3: GET after cursor F      History: [null, cursorC, cursorF]

Previous: remove cursorF
Reload GET after cursor C      History: [null, cursorC]
Result: D, E, F
```

The backend receives only forward requests. It does not know whether the user
clicked Next or Previous. A cursor preserves the sort value and ID, so no lookup
of its original trade is needed.

Next appends the returned cursor. Previous removes the latest request cursor.
Refresh reloads the current request without changing history. First page, changed
sorting or changed page size resets history to [null]. Future filter controls must
reset history through the same query-change handler.

## Draw this in Excalidraw

Draw four boxes: **Browser -> GET route -> Repository -> PostgreSQL**.

For page 2, label the arrows:

1. Browser -> GET route: AAPL, ACTIVE, price ASC, limit 3, after cursor C.
2. GET route -> Repository: validated filters and boundary (101.0000, C).
3. Repository -> PostgreSQL: matching rows after C, price/ID ASC, take 4.
4. PostgreSQL -> Repository: D, E, F, G.
5. Repository -> GET route -> Browser: D, E, F; nextCursor F.

Beside Browser write: **history [null, cursorC]**.
For Previous from page 3, draw an arrow back to the page-2 request:
**pop cursorF; resend after cursorC**. No backwards database arrow is needed.

## Explain it

> The API always fetches forward from a cursor, with server-side filters and
> sorting. Next uses the returned cursor; Previous reuses a request cursor
> remembered by the frontend.

History belongs to the signed-in workspace. Browser reload/new login starts at page
one; the manual Refresh button preserves history.
Page contents can change between requests; history remembers boundaries, not
frozen results. An empty or failed later page still allows Previous/First page
recovery. No total count, standalone before cursor or historical snapshot is offered.
