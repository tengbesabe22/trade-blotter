# Frontend Overview

React renders the workspace. TanStack Query holds server data; REST loads
snapshots and submits changes, while one SSE connection keeps trades and positions
current. PostgreSQL remains the source of truth.

## Structure

| Area | Responsibility |
| --- | --- |
| [App](../frontend/src/App.tsx) and [auth](../frontend/src/auth) | Restore the session, sign in and sign out. |
| [API clients](../frontend/src/api) | Send credentialed HTTP requests and handle API errors. |
| [Contracts](../frontend/src/api/contracts) | Validate payloads with Zod and define their TypeScript types. |
| [Trade workspace](../frontend/src/trades/TradeWorkspace.tsx) | Own the signed-in user's Query client and compose the workspace. |
| [Pages](../frontend/src/trades/pages) | Coordinate trades, history and Position Summary screens. |
| [Components](../frontend/src/trades/components) | Render forms, controls, tabs, the grid and action panels. |
| [Hooks](../frontend/src/trades/hooks) | Coordinate fetching, live updates and cache lifecycle. |
| [Utils](../frontend/src/trades/utils) | Pure merging and date-filter rules without React or network calls. |

## Session and navigation

1. On startup, `/auth/me` restores the account from the HttpOnly session cookie.
   A missing session shows sign-in; a failed connection offers retry.
2. Signing in opens a workspace with its own Query client. The browser sends the
   cookie automatically; JavaScript does not read or store the session token.
3. Trades and Position Summary share the same live connection. History opens as
   a separate view; returning preserves filters, pagination and the creation draft.
4. Confirmed logout unmounts the workspace, releasing its cache, buffers and SSE.

## Where state lives

| State | Owner / lifetime |
| --- | --- |
| Tabs, filters, cursor history, selected trade and form drafts | React state in the workspace's pages/components. |
| Current trade page | Query cache keyed by its filters, sort and cursor; inactive pages are released. |
| Instrument/trader options | Shared Query cache for the signed-in workspace. |
| Positions and trade history | Separate Query caches; positions stay live, history loads on opening and refreshes manually. |
| Recent live updates | Bounded buffers protect against older HTTP responses arriving later. |

## Loading and live updates

```text
REST snapshots ───────┐
Amend/cancel results ─┼─→ Version-aware cache updates → React views
SSE trade + positions┘
```

- Open SSE, wait for ready, then fetch the current trade page. HTTP refresh remains
  available when streaming is unavailable. Positions load when their tab is requested.
- Incoming events update trade and position caches immediately. Each trade and
  each symbol summary has its own version; duplicates or older versions cannot
  replace newer data. Position snapshots replace totals rather than adding them.
- Preserve events arriving during HTTP reads so a delayed snapshot cannot roll
  the screen back. Changing filters, pages or tabs keeps the same SSE connection.
- Reconnection fetches fresh baselines. When an event affects sorting or page
  membership, a short batch delay groups the necessary page-sized refreshes.

See [Real-time Updates](realtime.md#frontend-processing) for merging examples,
page membership and reconnect behavior.

## User actions

| Action | Frontend behavior |
| --- | --- |
| Create | Validate, submit with an idempotency key, then refresh the trade page. An unconfirmed result retains the same request/key for retry. |
| Amend / cancel | Capture the selected version, submit, then merge the returned trade. Conflicts preserve the draft/reason and require review of the latest trade. |
| Filter / sort | Request a new server page and reset cursor history. Text/date drafts use Apply; dropdowns apply immediately. Previous uses saved cursors. |
| Position Summary | Show current desk-wide positions, independently of blotter filters; SSE keeps totals current. |
| History | Fetch the selected trade's retained audit entries; refresh explicitly for later changes. |

Only owned ACTIVE trades show amendment/cancellation actions. The backend also
enforces these permissions. Successful changes reach other browsers through SSE.

## Recovery and UX

- Pending submissions disable duplicate actions; switching panels preserves the creation draft.
- Loading, empty, disconnected and failed-request states are explicit. Failed refreshes
  retain previously loaded data with a warning and a retry action.
- Session expiry offers sign-in. Automatic snapshots and SSE do not renew idle time;
  deliberate foreground requests do.
- The grid is virtualized and loads lazily. Paging keeps it mounted to preserve
  scroll; tabs and action controls support keyboard navigation and accessible labels.
