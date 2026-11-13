# Frontend

React + TypeScript + Vite, with Tailwind CSS and Oxlint.
Login, logout, session restoration, and a read-only trade grid are implemented.
AG Grid Community displays rows; TanStack Query manages the loaded snapshot.
Filtering, trade forms, and live updates are next.

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
| `src/api/trade-api.ts` | Loads `/api/trades` with cookies and cancellation |
| `src/App.tsx` | Restores the session and chooses checking, login, trading workspace, or retry views |
| `src/auth/LoginForm.tsx` | Controlled email/password inputs, submission, pending state, and errors |
| `src/auth/AccountPanel.tsx` | Compact account header and confirmed logout |
| `src/trades/TradeWorkspace.tsx` | Owns a query cache for one signed-in workspace |
| `src/trades/TradesPage.tsx` | Loads trades; handles refresh, loading, empty, and error states |
| `src/trades/TradeTable.tsx` | Grid columns, stable row IDs, and display settings |
| `src/trades/trade-sort.ts` | Compares fixed-scale decimal strings without rounding |
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
2. `TradesPage` loads the snapshot through `tradeApi.list()`. Zod rejects malformed
   responses before they enter the cache; no database/backend modules enter the browser.
3. `TradeTable` reads that snapshot. It is loaded separately so the grid code does
   not delay the login screen. Stable trade IDs preserve row identity on refresh.

Both account roles see all trades. The grid starts with newest execution times
first. Headers sort, columns resize, and the ticker stays pinned while other
columns scroll horizontally. The grid has a bounded height and virtualises rows;
the page and account/refresh controls adapt to narrow screens.

Quantity and price remain decimal strings at six and four fractional places.
Sorting compares scaled integers with BigInt, using the fixed scale of each
column. Prices are labelled USD; execution timestamps are displayed in UTC.
Missing book/counterparty values display an em dash.

| Situation | Behavior |
| --- | --- |
| First load | Loading message and disabled refresh |
| Empty snapshot | Explicit empty state |
| Refresh pending | Keep rows visible; disable duplicate refresh |
| Load failure | Error with Refresh trades available to retry |
| Refresh failure | Keep the last snapshot and warn it could not be refreshed |
| Trade request returns 401 | Hide rows and offer Sign in again |
| Sign out | Unmount the workspace and cancel pending trade requests |

There is no polling, automatic error retry, or focus/reconnect refetch in this
slice. Use manual refresh to see changes made elsewhere. SSE will be a later slice.

Tests cover API validation, exact decimal sorting, loading/empty/error/retry flows,
refresh behavior, expiry, and cancellation. Component tests mock fetch and use the
real grid where jsdom supports it. CSS layout, horizontal navigation, and sorting
were also checked in a real browser with the local seeded API; this is a smoke
check, not an automated end-to-end or load test.

The grid remains the largest production chunk. It is loaded on demand; further
bundle optimisation and larger-dataset measurements remain future work.
