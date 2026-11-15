# Real-time Updates

[Flow](#flow) · [Events](#event-contract) · [Delivery](#durable-delivery) ·
[Frontend](#frontend-processing) · [Connections](#sse-connections) · [Reconnects](#reconnection)

## Flow

```text
Trade request → commit trade, audit, positions and outbox event
  ├─ HTTP response → caller's browser
  └─ wake relayer → broadcaster → SSE → all connected browsers
                                      → trade and position caches → UI
```

REST handles creation, amendment and cancellation. The HTTP response belongs to
its caller; SSE sends the committed change to every connected client, including
the caller. Both delivery paths can arrive in either order. The mutation response
does not wait for SSE delivery.

## Event contract

One authenticated `/api/events` connection carries all trade updates. Both roles
receive the same public data; current table filters do not filter the stream.

| Message | Purpose |
| --- | --- |
| `stream.ready` | Connection is ready; the browser can load fresh baseline data. |
| `trade.changed` | A committed creation, amendment or cancellation. |
| Heartbeat | Keeps the connection active; no business-data change. |

Each change includes an event ID, action, time, the complete resulting trade and
any affected position summaries. Summaries contain absolute totals, not increments;
metadata-only amendments carry no summary change. Reasons stay in audit storage.
Trade versions and per-symbol summary versions advance independently.

## Durable delivery

The trade change and its outbox event commit together. The **relayer** reads saved
events; the **broadcaster** distributes them to local SSE connections. After local
publication, the event is marked published.

| Trigger | Behavior |
| --- | --- |
| Trade committed | Wake the relayer immediately. |
| Server startup | Recover pending events and restore future retry deadlines. |
| Delivery failure | Keep the event and set a one-shot retry with increasing delay, capped at 30 seconds. |
| Database-operation failure | Retry the failed run after one second; repeated failures rearm it. |
| No pending work | No timer and no periodic database polling. |

A crash after saving an event is recovered on restart. A crash after broadcast but
before publication is recorded may cause duplicate delivery. Published means local
hand-off, not browser acknowledgement or exactly-once delivery.

**Tradeoff:** a missed wake while the process stays running waits for another trade
wake-up or restart. The current relayer and broadcaster belong to one API instance.
Independent recovery and cross-instance fan-out are [production work](decisions.md#production-path).

## Frontend processing

TanStack Query holds the displayed data. Incoming events update those caches so
the UI can change immediately without fetching every trade again.

| Data | Merge rule |
| --- | --- |
| Trades | Replace a trade only with a higher version of that trade. |
| Positions | Replace a symbol's totals only with a higher summary version; never add received totals together. |
| HTTP snapshots | Preserve newer events received while the request was in flight. |

Amend/cancel responses use the same trade-version rules as SSE. Creation refreshes
the current page after success; its event also enters the live cache.

### Merging examples

Versions are compared per trade or symbol, independently of delivery order.

| Scenario | Result |
| --- | --- |
| HTTP returns trade v2, then SSE delivers the same v2 | Apply once; ignore the duplicate. |
| An HTTP snapshot returns trade v2 after SSE supplied v3 | Keep v3; an older response cannot undo the update. |
| Trade v4 is already cached, but the event contains summary v10 instead of cached v9 | Keep the trade and update the summary independently. |

### Keeping the page correct

Page membership means which trades belong on the current filtered, sorted page.
Version checks keep individual rows current, but cannot identify an unseen row
needed to fill a gap. For example, cancellation removes a row from an ACTIVE-only
page immediately; a bounded page fetch finds replacement rows when available.

- On the default newest-first first page, matching new trades appear immediately.
- Other pages/sorts retain the user's place. Visible trades update; older pages
  show a notice when unseen trades arrive.
- Cancelled trades remain visible unless an active filter excludes them.
- Changes affecting ordering or page membership trigger a batched, page-sized
  background fetch. Ordinary field updates and duplicate events need no fetch.

Changes are grouped over 100 ms rather than fetching for every event. Further
changes during a fetch can require another pass; settled events do not keep
refetching. Failed requests retain live rows and offer manual Refresh.

Buffers protect newer events from older HTTP responses. Trade buffering is capped
at 200 records; positions retain only the newest snapshot per instrument. Signing
out releases the workspace's caches, buffers and connection.

## SSE connections

One stream serves the signed-in workspace across filters, pages and tabs. Payloads
are validated before entering caches. Heartbeats run every 15 seconds; business
events are sent immediately without waiting for a heartbeat.

Session validity is checked at connection, before events and on heartbeats. Passive
stream traffic does not extend the idle timeout. An expired session closes the
stream. A slow client that fills its bounded queue is disconnected so it cannot
block other clients; it recovers current state after reconnecting.

Deployment must preserve streaming and avoid proxy buffering. Connection lifecycle
and failures are logged with correlation IDs; a logged send does not prove browser
receipt. See [logging](technical-design.md#logging).

## Reconnection

1. **Connect:** wait for ready, then fetch the active trade page. Load the position
   baseline when its tab is requested.
2. **Disconnect:** retain displayed data and show that the stream is reconnecting.
3. **Reconnect:** after ready, replace obsolete requests with fresh trade and
   requested position baselines. Retain newer events arriving during those reads.
4. **Merge:** versions protect fresh values; the trade snapshot restores correct
   page membership. Blotter filters do not change the desk-wide position scope.

The browser retries recoverable connection failures automatically. The server does
not replay missed event history; fresh snapshots recover current state. If streaming
is unavailable or sends invalid data, offer HTTP refresh and retain labelled stale
data. Automatic recovery reads do not renew session idle time; deliberate user
refresh/navigation does.

**Manual check:** use two separately signed-in browser windows. Create, amend and
cancel an owned trade in one; observe the other table and Position Summary. Disconnect
and reconnect the receiving client to check current-state recovery.
