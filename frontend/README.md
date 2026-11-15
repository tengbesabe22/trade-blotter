# Frontend

React + TypeScript + Vite, with Tailwind CSS and Oxlint.
Login/session restoration, trade CRUD, filtering, live updates and per-trade history
are implemented. Trades and Position Summary use separate tabs. AG Grid displays
one bounded trade page; the position view shows current desk-wide totals by symbol.
TanStack Query manages both caches through one shared SSE connection.

## Commands

Run from the repository root after `pnpm install --frozen-lockfile`:

```sh
pnpm --filter @trade-blotter/frontend dev
pnpm --filter @trade-blotter/frontend test
pnpm --filter @trade-blotter/frontend lint
pnpm --filter @trade-blotter/frontend build
```

Vite uses `http://localhost:5173` and fails if the port is occupied. This keeps
the origin aligned with the backend's local `APP_ORIGIN`. Build output is in
`frontend/dist/`. Strict TypeScript checking covers source and frontend tests.

## File map

| File | Purpose |
| --- | --- |
| `index.html` | HTML entry point |
| `src/main.tsx` | Mounts React |
| `src/api/api-client.ts` | Fetch wrapper, cookies, and structured HTTP errors |
| `src/api/auth-api.ts` | Login, current-user, and logout calls |
| `src/api/auth-contract.ts` | Browser-side auth shapes and inferred types |
| `src/api/trade-contract.ts` | Validates trade responses, including exact decimal strings |
| `src/api/trade-create-contract.ts` | Create request/response validation with exact decimal strings |
| `src/api/trade-api.ts` | Loads `/api/trades` with cookies and cancellation |
| `src/App.tsx` | Restores the session and chooses checking, login, trading workspace, or retry views |
| `src/auth/LoginForm.tsx` | Controlled email/password inputs, submission, pending state, and errors |
| `src/auth/AccountPanel.tsx` | Compact account header and confirmed logout |
| `src/trades/TradeWorkspace.tsx` | Owns the account query cache, gates creation by role and refreshes trades after success |
| `src/trades/CreateTradeForm.tsx` | Form fields, validation, submission and same-key retry after uncertain responses |
| `src/trades/TradesPage.tsx` | Owns page inputs, cursor history/query key, refresh and error states |
| `src/trades/TradeListControls.tsx` | Server sort and page-size controls; changing either resets pagination |
| `src/trades/TradePagination.tsx` | Previous from local history, Next from the response, and First page controls |
| `src/trades/TradeTable.tsx` | Grid columns, stable row IDs, and display settings |
| `src/trades/trade-sort.ts` | Decimal comparison utility; active page sorting now happens on the server |
| `src/index.css` | Global styles and Tailwind entry |
| `src/assets/` | Imported images and SVGs |
| `public/` | Static files copied to the build |
| `vite.config.ts` | React/Tailwind plugins and local API proxy |
| `.oxlintrc.json` | Lint rules |
| `tsconfig*.json` | TypeScript settings |
| `package.json` | Frontend dependencies and scripts |

## Request flow

Start the backend with `pnpm dev` in another terminal. Browser code calls relative
URLs such as `/api/auth/login`; Vite forwards `/api` to `http://localhost:3000`
without removing the prefix. The browser handles the HttpOnly session cookie.
The API client leaves the browser's Origin header intact.

`authApi.login()` and `authApi.me()` validate their JSON responses with Zod.
`authApi.logout()` accepts an empty 204 response. HTTP failures throw `ApiError`
with `status`, `code`, and `message`; network failures propagate to the caller.
`LoginForm` calls `authApi.login()` and passes the returned user to `App` through
`onAuthenticated`. `App` renders `TradeWorkspace` with `AccountPanel`, which calls `authApi.logout()`
and notifies the parent through `onSignedOut` after success. Each component owns
its pending/error state. Passwords are kept only in the form's component state.

The current user is held in React memory. On every fresh app mount, including a
refresh, `App` checks `/me` using the existing HttpOnly cookie:

| Result | UI |
| --- | --- |
| Pending | Checking state; no login-form flash |
| 200 | Restore the returned account and role |
| 401 | Show the login form |
| Network, server, or invalid-response error | Show a retry action |

`authApi.me()` accepts an optional AbortSignal. Effect cleanup aborts obsolete
checks and ignores their results, so a delayed response cannot restore an account
after logout. Only startup and explicit retries perform this check; no background
polling is added.

The frontend keeps a small browser-safe auth contract; backend password/session
implementation details are not imported. Business validation remains on the API.
The dev proxy is not bundled into static output; production needs `/api` routing.

`pnpm test` at the root runs backend and frontend tests. API-client tests mock
fetch. Component tests use Testing Library and a jsdom environment with the same
Node/tsx runner; they test interactions, pending states, and failed requests.
For backend setup, see the [project README](../README.md).

## Read-only trade view

1. After login or session restoration, `TradeWorkspace` creates a TanStack Query
   client. A new login receives a new workspace/cache.
2. `TradesPage` loads a page through `tradeApi.list(query, signal)`. Its query key
   includes limit, ordering and cursor; inactive pages are released. Zod rejects malformed
   responses before they enter the cache; no database/backend modules enter the browser.
3. `TradeTable` reads that snapshot. It is loaded separately so the grid code does
   not delay the login screen. Stable trade IDs preserve row identity on refresh.

Both account roles can browse all trades. The first request loads 100 rows, newest
execution time first. Sort controls order the full result set on the API; grid
headers do not reorder only the loaded page. Page-size options are 25/50/100/200.
Next appends the returned cursor to a small request history. Previous removes the
latest history entry and repeats the earlier forward request. First page clears
history; changing sorting or page size also resets it. Refresh preserves history. No total count or numbered-page jump is shown.
Columns resize and the ticker stays pinned while other columns scroll horizontally.
The grid has a bounded height and virtualises rows; controls wrap on narrow screens.

Quantity and price remain decimal strings at six and four fractional places.
Sorting uses PostgreSQL decimal columns. Prices are labelled USD; execution
timestamps are displayed in UTC.
Missing book/counterparty values display an em dash.

| Situation | Behavior |
| --- | --- |
| First load | Loading message and disabled refresh |
| Empty first page | Explicit empty state |
| Empty older page | Page-specific message and First page recovery |
| Page navigation | Bounded fetch; no previous-page rows shown under the new query |
| Changed sort/page size | Reset to first page; abort obsolete requests |
| Refresh pending | Keep rows visible; disable duplicate refresh |
| Load failure | Error with Refresh trades available to retry |
| Refresh failure | Keep the last snapshot and warn it could not be refreshed |
| Trade request returns 401 | Hide rows and offer Sign in again |
| Sign out | Unmount the workspace and cancel pending trade requests |

There is no polling, automatic error retry, or focus/reconnect refetch in this
slice. Use manual refresh to see changes made elsewhere. SSE will be a later slice.

Tests cover response/query validation, cursor navigation, server sort/page-size
changes, loading/empty/error/retry flows, refresh, expiry, and cancellation. Component tests mock fetch and use the
real grid where jsdom supports it. The pagination controls were also checked in a real browser against the local
seeded API; this is a smoke check, not an automated end-to-end or load test.
See the [trade-list API guide](../docs/trade-list-api.md) for available filters,
response metadata and cursor behavior. Filter form controls remain pending.

The grid remains the largest production chunk. It is loaded on demand; further
bundle optimisation and larger-dataset measurements remain future work.

## Create trade

Trader accounts see New trade. The form validates input and calls tradeApi.create(),
which sends JSON and an Idempotency-Key to POST /api/trades. A successful response
shows confirmation; TradeWorkspace invalidates the active trades query to reload
its current page. This slice does not subscribe to SSE or merge events into the cache.

Validation failures retain editable input. An uncertain result freezes the original
submission and retries the same key/body. Pending attempts are held in component
memory only. See the [create API guide](../docs/trade-create-api.md) for limits and
error behavior. Component tests cover request payloads, duplicate prevention,
network/server/invalid-response retries, role visibility and page refresh after success.


## Position Summary

Open Position Summary to load GET /api/summaries once. The complete list covers all
traders/books/dates, independently of blotter filters. Subsequent SSE snapshots replace
each instrument only when its summary version advances; no per-event GET is needed.
Reconnect reloads the baseline passively and merges buffered newer events. Switching
tabs preserves trade filters, pagination and form drafts. Both roles can read it.

| File | Responsibility |
| --- | --- |
| src/api/trade-summary-contract.ts | Exact decimal rows and complete response validation |
| src/api/trade-api.ts | summaries GET with cookies, cancellation and activity policy |
| src/trades/usePositionSummaries.ts | Baseline query, per-instrument event buffer, refresh and recovery |
| src/trades/trade-summary-merge.ts | Independent version guard and stable symbol ordering |
| src/trades/PositionSummaryPage.tsx | Exact quantities, Long/Short/Flat and view states |
| src/trades/TradesPage.tsx | Tabs and preserved views |
| src/trades/useLiveTrades.ts | One SSE connection feeding both caches |

The buffer stores one newest event per instrument until workspace unmount; keeping
it after caching protects against older HTTP responses. Failed snapshots retain
labelled last data and buffer events until a successful retry. The position view
supports loading/empty/error/session expiry, disconnected status and manual refresh.
Quantities are formatted as strings, preserving precision. P&L remains deferred.
