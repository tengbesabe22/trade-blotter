# Decisions and Scaling

The current design favors a small, reviewable system. These choices and limits
are specific to this project. See [Technical Design](technical-design.md) and
[Real-time Updates](realtime.md) for the main flows.

Hono, Vite and pnpm were selected for developer familiarity. PostgreSQL was also
familiar and provides ACID transactions for saving trades and related records
together. These are stack-selection reasons, separate from the tradeoffs below.

## Tradeoffs

| Decision and alternative | What we gain | What we give up / accept |
| --- | --- | --- |
| REST + SSE instead of WebSockets | Keep commands in REST; native browser streaming/reconnection fits one-way updates. | The stream cannot carry client-to-server messages; a future bidirectional workflow may need another transport. |
| Full trade/summary snapshots instead of delta events | Each update can be applied independently using entity versions. | Larger event payloads. |
| Fresh snapshots on reconnect instead of event replay | Recover current state without retaining/tracking a replay stream. | Disconnected clients do not receive every missed transition; history is inspected through the audit view. |
| In-process relayer/broadcaster instead of separate workers and a broker | Fewer services to deploy while retaining the transactional outbox. | Delivery shares the API lifecycle; local fan-out cannot reach clients on other instances. |
| Immediate wakes + one-shot retries instead of periodic polling | No database reads while the outbox is idle. | A missed wake has no recovery deadline until another trade or restart. |
| Server filtering/sorting and cursor pages instead of loading all trades into the browser | Bounded transfers and page sizes as history grows. | Navigation/filter changes need requests; live ordering and page membership need reconciliation. |
| Stored incremental summaries instead of aggregating on every read | Avoid rescanning trade history for each summary request. | More work during mutations, contention on busy symbols and a need for summary repair. |
| Database sessions instead of access/refresh tokens | Straightforward logout/revocation and current role checks. | Protected requests depend on a database session lookup. |

SSE itself does not require a single instance. That limit comes from our current
process-local delivery architecture; the scaling path below addresses it.

## Current limitations

- **Delivery:** a missed wake while the API stays running waits for another trade
  or restart. Saved events survive crashes, but publication is local hand-off,
  not browser acknowledgement. Reconnects fetch current state without event replay.
- **Data growth:** lookups load complete reference lists; per-trade history loads
  in full and refreshes manually. Positions cover the desk across all dates,
  assuming zero opening balances. P&L, historical/trader/book positions, instrument
  administration and global audit search remain deferred.
- **Evidence:** isolated tests do not prove live-database concurrency/rollback or
  production capacity. The default-page index has local query-plan evidence;
  client p50/p95/p99 load measurements remain pending. Manual browser checks are
  not capacity benchmarks.
- **Deployment:** Vercel, Lightsail/Caddy and Neon are deployed. Backend releases
  are manual; continuous deployment, failover and production hardening remain work.

## Production path

- **Independent delivery:** supervise an outbox worker or CDC pipeline independently
  of API requests, with coordinated processing, reliable retries, backlog monitoring
  and recovery of missed work. Add broker/pub-sub fan-out so **every SSE-serving
  instance** receives updates. Browser connections remain local to each instance;
  shared sessions or sticky routing alone do not distribute events. Complete this
  before running multiple API instances.
- **Identity and transport:** federate with an organization identity provider; add
  shared rate limiting and account lifecycle controls. Verify HTTPS/cookies and
  proxy support for long-lived, unbuffered SSE connections.
- **Availability and growth:** provide database failover, backups and tested restores;
  verify health checks and graceful shutdown. Add bounded lookup search, summary
  repair and retention policies. Use representative query plans and load results
  before expanding indexes or infrastructure.
- **Operations:** centralize structured logs with restricted access and retention;
  monitor delivery failures/backlog and connection health. Verify migration/deployment
  procedures and measure HTTP latency and end-to-end browser delivery separately.

These are planned production capabilities. See [deployment status](../README.md#deployment).
