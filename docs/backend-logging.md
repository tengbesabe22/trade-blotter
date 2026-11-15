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
- `backend/src/app.ts`: installs the middleware before routes. App-only fixtures
  use a silent logger by default; the server injects its configured logger.
- `backend/src/index.ts`: creates the shared logger and logs startup/close events.

Outbox and SSE lifecycle logging remain follow-up slices. Their existing console
and stream-error paths have not yet been migrated. This guide describes L1/L2;
it does not claim all backend log paths are covered.
