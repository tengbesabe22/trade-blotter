# SSE connection

This first slice adds an authenticated `GET /api/events` connection.
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

The blank line ends the event. The connection stays open until the client
disconnects; Ctrl+C closes curl. `retry` tells a browser EventSource to wait
1,000 milliseconds before reconnecting after a disconnection.

The route reuses session validation with activity recording disabled. Opening or
reconnecting a stream must not keep an otherwise idle account signed in.
Missing, revoked, idle-expired or hard-expired sessions receive 401 at connection time.

The ready payload is defined in
[trade-stream-contract.ts](../backend/src/trades/sse/trade-stream-contract.ts); the route lives in
[trade-stream-routes.ts](../backend/src/trades/sse/trade-stream-routes.ts). It uses Hono's streaming helper and removes the request
abort listener when the connection ends. Responses use no-store and disable
proxy buffering through X-Accel-Buffering.

**Not implemented in this slice:** heartbeats, ongoing session checks, trade-event
delivery, outbox dispatch or browser subscriptions. Those will be added in separate
reviewable steps before the stream carries trades. Ready currently confirms only
that an authenticated connection opened.

Tests use fake session persistence and read/cancel the real Hono response stream.
No running database is required.
