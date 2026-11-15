# Backend logging

The API writes one JSON record per line to stdout using Pino. Start it normally
with `pnpm dev`; set `LOG_LEVEL` in `backend/.env` to change verbosity.
The default is `info`. Supported values are `trace`, `debug`, `info`, `warn`,
`error`, `fatal` and `silent`; invalid values stop startup with a constant error.

## What is recorded

| Event | Level | Meaning |
| --- | --- | --- |
| `server.started` | info | The HTTP server is listening; includes its port |
| `server.closed` | info | The existing server close hook ran |
| `http.response` | info / warn / error | Response status below 400 / 4xx / 5xx |
| `outbox.retry_scheduled` | warn | An event failed and its next retry was saved |
| `outbox.failed` | error | Reading pending events or saving a retry failed |
| `outbox.published` | debug | Local broadcast and publication bookkeeping succeeded |
| `sse.opened` | info | The ready write returned and the stream is still active |
| `sse.closed` | info | Connection cleanup ran; includes close reason and duration |
| `sse.failed` | error | An unexpected stream/session/subscription failure occurred |
| `sse.slow_client_dropped` | warn | A connection exceeded its 100-event queue |
| `sse.sent` | debug | A trade-event write returned while the stream remained active |

Every record includes UTC `time`, a readable `level` and
`service: "trade-blotter-api"`. Successful `/api/health` probes are omitted to
avoid deployment noise. Other requests have one response record, including
handled exceptions; the existing sanitized 500 JSON response is preserved.
No new signal handlers or graceful-shutdown behavior are introduced.

## Follow a request

The server generates a fresh `X-Request-ID` response header, including for rejected
requests and health checks. It ignores a client-supplied ID. Copy this value from
the browser Network panel and search for its `requestId` in the API output.

Example shape (illustrative):

```json
{"level":"warn","time":"2026-11-15T09:00:00.000Z","service":"trade-blotter-api","event":"http.response","requestId":"24d71a17-f824-4e67-b275-c06dd4d30dbe","method":"PATCH","route":"/api/trades/:id","status":409,"durationMs":12.4}
```

`route` is the registered template, so resource IDs and query values are absent.
Unknown paths use `unmatched`. `durationMs` uses a monotonic clock and measures
middleware/response setup, not network round-trip or browser rendering time.
For SSE it measures establishing the response, **not** the connection lifetime.
Use a load client to measure end-to-end p95/p99 latency.

## Follow outbox delivery

Search by `changeId`, the persisted outbox ID. Event-specific records also include
`type` and `attempt` (one plus the saved retry count). Retry records identify the
failed `operation` and the saved `nextAttemptAt`. The existing exponential backoff
and one-second recovery timer are unchanged.

If saving the retry fails, emit only `outbox.failed` for `schedule_retry`; do not
claim the retry was scheduled or log the same failure again in the outer catch.
A pending-read failure has no event ID because no events were loaded. Later wakes
still retry pending work. Idle recovery ticks emit no logs.

Set `LOG_LEVEL=debug` to see successful `outbox.published` records. Publication
means local broadcaster hand-off followed by marking the outbox row, not browser
acknowledgement. A crash or failed publication write can cause repeat delivery;
clients still merge by entity version. No request IDs are persisted in the outbox,
so request-to-event tracing across restarts is not provided.

## Follow an SSE connection

The `connectionId` is the same ID sent in `stream.ready`. Opening, closing, failure
and debug send records also include the HTTP handshake's generated `requestId`.
The broadcaster retains that connection ID with its existing subscription, so an
overflow warning can be linked without another registry or a user identifier.
A reconnect gets a new connection ID.

`closeReason` is one of:

- `client_disconnected`: response cancellation or request abort.
- `session_inactive`: the session is missing or expired; no guess about why.
- `slow_client`: the broadcaster's queue bound was exceeded.
- `stream_error`: an unexpected failure; a safe `sse.failed` record accompanies it.
- `subscription_closed`: the subscription ended normally without a client abort.

There is one closure record per authenticated stream attempt, including attempts
that end before ready (which have no `sse.opened`). `connectionDurationMs` measures
from entry to the authenticated stream handler through cleanup using a monotonic
clock. It is not API latency or commit-to-browser/render time.

At `info`, follow connection lifecycle and failures. At `debug`, `sse.sent` links a
connection to its `changeId`; use that ID to find outbox records. It means Hono's
write helper returned with the stream active, not verified socket delivery or
browser receipt. Heartbeats produce no logs and never renew session idle time.

Unexpected failures are handled inside the stream callback with safe metadata,
then the stream closes. They do not reach HTTP `app.onError` after setup. We do
not use Hono's SSE error callback, which can send the raw exception message in an
error frame. Normal abort cleanup produces no false failure record; overflow gets
its warning plus closure, without an additional unexpected-error record.

## Privacy and errors

Call sites allowlist operational metadata. They do not log identities, IPs,
cookies, session/token values, bodies, query values, financial payloads or SQL.
Unexpected errors add a fixed `errorCategory`; recognized Prisma errors can also
include a `P`-prefixed four-digit `errorCode`. Raw errors, messages and stacks are
excluded because they can contain request or database values.

The logger also redacts known sensitive fields and free-form messages to
`[REDACTED]`. This is a second safeguard, not recursive protection for arbitrary
objects: continue passing only approved metadata and fixed `event` names.
Log access and retention must be controlled in the deployment configuration.

## Code and scope

- `backend/src/logging/logger.ts`: JSON format, level validation and redaction.
- `backend/src/logging/request-logger.ts`: request ID, timing, status and safe errors.
- `backend/src/logging/error-metadata.ts`: shared safe error categories/codes.
- `backend/src/trades/sse/trade-stream-routes.ts`: lifecycle and debug send records.
- `backend/src/trades/sse/trade-broadcaster.ts`: slow-client warnings.
- `backend/src/trades/outbox/outbox-relayer.ts`: publication, retry and failure records;
  standalone fixtures default to silent unless a logger is supplied.
- `backend/src/app.ts`: installs the middleware before routes. App-only fixtures
  use a silent logger by default; the server injects its configured logger.
- `backend/src/index.ts`: creates the shared logger and logs startup/close events.

Startup, HTTP, outbox and SSE lifecycle logging are implemented. Tests capture
real JSON records using fake repositories and real Hono streams; they need no
running database. Cloud log collection, access controls and retention belong to
the deployment configuration. Load measurements remain a separate task.
