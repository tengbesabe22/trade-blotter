# SSE connection

The API exposes an authenticated `GET /api/events` connection.
Both traders and read-only accounts can connect using their existing session cookie.

After [signing in](authentication.md#sign-in), test it with:

```sh
curl -N -b .cookies http://localhost:3000/api/events
```

The server immediately sends:

```text
event: stream.ready
data: {"schemaVersion":1,"connectionId":"<UUID>","serverTime":"<UTC timestamp>"}
retry: 1000

```

The blank line ends the event. The connection stays open while the session is
valid and the client remains connected; Ctrl+C closes curl. `retry` tells a browser EventSource to wait
1,000 milliseconds before reconnecting after a disconnection.

The route reuses session validation with activity recording disabled. Opening or
reconnecting a stream must not keep an otherwise idle account signed in.
Missing, revoked, idle-expired or hard-expired sessions receive 401 at connection time.

Every 15 seconds, the server reads the session again. If it is still valid, it sends
an SSE comment (`: heartbeat` followed by a blank line). Comments keep traffic
flowing through idle connections without triggering browser message handlers.
This follows the [SSE specification's authoring guidance](https://html.spec.whatwg.org/multipage/server-sent-events.html#authoring-notes).

If the session is deleted (logout), idle for 5 minutes or past its 8-hour maximum,
the server closes the stream on the next check. This is periodic detection, not
instant revocation; database/network delays can extend it. Checks use current
activity from other API requests and never update `lastSeenAt` themselves.
An open response cannot change its status to 401; a new connection is validated
again and receives 401 if the session remains invalid.

Sessions are also checked before each trade event. Neither trade delivery nor
heartbeats update `lastSeenAt`.
Disconnecting cancels the pending timer and removes the request abort listener.
A session lookup failure closes the stream and is logged on the server without
sending internal error details to the client.

The ready payload is defined in
[trade-stream-contract.ts](../backend/src/trades/sse/trade-stream-contract.ts); the route lives in
[trade-stream-routes.ts](../backend/src/trades/sse/trade-stream-routes.ts). It uses Hono's streaming helper and removes the request
abort listener when the connection ends. Responses use no-store and disable
proxy buffering through X-Accel-Buffering.

## Trade change events

The outbox relayer runs after committed creates/amendments/cancellations, at startup and every
second for recovery. It broadcasts through the same instance used by this route. Each
connection subscribes before `stream.ready`, then sends queued changes immediately
without waiting for a heartbeat or fetching trades again.

```text
id: <outbox event UUID>
event: trade.changed
data: <complete TradeChange JSON>

```

Each event contains `changeId`, `type` (`TRADE_CREATED`, `TRADE_AMENDED` or
`TRADE_CANCELLED`), `occurredAt`, the complete `trade` DTO and required `summaries`.
There is one event shape with no format-version field. Both account roles receive
events for all traders.
Creation POST, amendment PATCH and cancellation POST responses remain `{trade}`. Duplicate event delivery is possible; the
browser must merge by trade ID/version. No Last-Event-ID history replay is provided.

Create, amend and cancel routes share the `onTradeChanged` wake-up callback. It runs only
after a successful repository transaction and does not wait for delivery. Rejected,
conflicting, no-op and failed mutations do not wake the relayer. Amendment/cancellation outbox
payloads contain `{trade, reason, summaries}`; creation stores `{trade, summaries}`.
SSE forwards the saved snapshots and keeps the reason private. Invalid trades,
summaries or identity/version mismatches remain pending with the existing retry
policy; incomplete events are not published.

Disconnecting removes the subscription. A full 100-event broadcaster buffer also
closes the connection, even if a write is blocked behind a slow browser. Reconnected
clients fetch current state after the next ready event.

To test table updates, sign in as different users in normal/private windows
(ordinary tabs share cookies). Leave both on the first page with the default
newest-execution sort, then create a trade with a current execution time. The new
row should appear in both tables without refreshing the receiving browser.

For optional payload tracing, open an additional connection in each console:

```js
const tradeEvents = new EventSource('/api/events');
tradeEvents.addEventListener('trade.changed', (event) => {
  console.log(JSON.parse(event.data));
});
```

Create a trade in one window. Both consoles should receive the same change/trade
IDs. To test an amendment, use the [PATCH curl example](trade-amend-api.md#http-request-and-responses)
for a visible trade owned by that trader, with its current version. Both consoles
should receive `TRADE_AMENDED` with the same trade ID and the incremented version.
The existing cache merger updates a visible row without another GET.
For cancellation, use the [cancel POST example](trade-cancel-api.md#request).
Both sessions receive `TRADE_CANCELLED`; the row remains with its new status and
version. Its Amend action disappears. An open amendment retains its draft and
blocks saving. Older events cannot undo that status because versions only advance.
Run `tradeEvents.close()` when finished.

## Browser cache behavior

[useLiveTrades.ts](../frontend/src/trades/useLiveTrades.ts) keeps one EventSource
connection per signed-in trade page, including across sorting/pagination changes.
It waits for ready before the first page fetch and re-fetches the current page on
reconnection. Incoming events are validated using the browser event contract.

[trade-merge.ts](../frontend/src/trades/trade-merge.ts) merges by trade
ID/version. The default first page inserts new rows in execution-time/ID descending
order and remains bounded by its selected limit. Other pages/sorts update known
rows, preserving navigation. The unseen-trade notice appears only on older pages;
it is hidden on the first page. No GET is made for
ordinary incoming events. The create form's existing success refresh is unchanged.

The hook retains up to 200 newest received trades while HTTP requests are pending,
then merges them into responses so a late snapshot cannot erase streamed changes.
A live change that invalidates a full page cursor clears it until automatic
reconciliation obtains a fresh cursor. The first page suppresses the new-trade
notice; older pages retain theirs through background reconciliation. Popup
notifications are deferred.

Ticker, trader, Status, Side, applied Book/Counterparty searches and UTC date
bounds apply to HTTP pages and SSE payloads.
Trader matching uses immutable owner ID, not display name. Versions are resolved
before filtering/limiting, so stale events cannot restore an excluded row. A visible
row leaving the selection disappears immediately and schedules a page-sized refill
after a 100 ms batch window. The read is passive and merges newer buffered events.
The same 100 ms batch covers changed sort values on visible rows, matching unseen
trades on other pages/sorts, and uncertain default-page boundaries. Ordinary field
changes, stale/duplicate events and unrelated unseen trades require no read. Unknown
matching trades are conservative triggers because the browser holds only one page.
The request retains the current filters, sort, limit and cursor anchor; it does not
jump to page one. Nearby changes share the fetch; failures retain live rows and
wait for manual Refresh. Changing the query cancels queued old-page work.

An API snapshot settles page membership. Buffered trades already included at an
equal/newer version are not replayed. If a buffered trade is absent, only events
received during that request are replayed; an older event may now belong outside
this page. Newer buffered values still win over older snapshot rows. A concurrent
ordering/membership change can request one further reconciliation; historical
buffer entries do not repeatedly trigger reads after the snapshot accounts for them.
Batching combines bursts; sustained relevant activity can still cause repeated reads.

Connection errors retain rows with stale/reconnecting feedback. Invalid data or a
terminal connection error switches to manual refresh. Signing out/unmounting closes
the connection and late messages are ignored. Browsers without EventSource can
still use manual refresh.

Automatic snapshot/recovery GETs send `X-Session-Activity: background`. The backend
still authenticates and enforces idle/maximum expiry, but leaves `lastSeenAt`
unchanged. Deliberate Refresh, pagination and sort changes count as user activity.
Heartbeat and trade-event checks also never renew idle time.

The inline amendment form and cancellation panel supply successful mutation
responses to the same version guard and buffer. It does not wait for SSE or refetch after saving; duplicate
SSE delivery is harmless and older in-flight snapshots cannot undo the change.
Ordering/membership reconciliation is implemented for the current bounded page.
Summary snapshots now reach the browser; summary cache/UI integration remains pending.
Older pages keep the unseen-trade notice until a
user refreshes or changes the query, even after passive reconciliation.

Tests use fake session persistence, a controlled clock and mocked timers, and
read/cancel the real Hono response stream.
No running database is required.


## Summary events

tradeChangeSchema defines one event contract on the backend and browser:

```text
{changeId, type, occurredAt, trade, summaries}
```

There is no schemaVersion, format union or fallback decoder for trade.changed.
trade.version and summary.version remain independent concurrency/merge revisions.
Summary rows reuse the exact decimal-string contract from GET /api/summaries.

An immutable symbol limits each event to one desk row. Creation/cancellation require
one matching-symbol snapshot. Amendments carry one for economic changes or [] for
metadata-only edits. Zero/flat rows are retained. The writer captures these values
in the mutation transaction; the relayer forwards that snapshot without reading
newer totals. Retries preserve saved values and revisions. Reasons stay private.

All three outbox payloads use {trade, summaries}, with an optional stored reason.
The relayer parses those fields, adds event identity/type/time, validates the event
and broadcasts it. Missing or invalid snapshots stay retryable; they are not replaced
with fabricated totals. A read-only local check found zero pending records lacking
snapshots. No rows were changed and no compatibility migration was needed.

The broadcaster/SSE route use the same authenticated connection. The browser validates
this one shape and immediately merges its trade. Summary baseline loading, merging
by instrument/version and the docked panel remain next. The separate stream.ready,
GET responses and HTTP mutation responses retain their existing contracts.

Checks: all 421 backend tests and 287 frontend tests pass, with root typecheck,
both builds and frontend lint. Focused tests cover captured snapshots, invalid
payloads, retries, both roles receiving complete SSE frames and browser trade updates.
The parallel regression run timed out on one existing Amend grid UI test; that file
and the full frontend rerun both passed without code changes. Persistence/EventSource
are faked; SSE tests read real Hono response streams. No live database CI dependency.
