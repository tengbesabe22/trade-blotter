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

Checks run sequentially, with one indexed session read per connection per interval.
Disconnecting cancels the pending timer and removes the request abort listener.
A session lookup failure closes the stream and is logged on the server without
sending internal error details to the client.

The ready payload is defined in
[trade-stream-contract.ts](../backend/src/trades/sse/trade-stream-contract.ts); the route lives in
[trade-stream-routes.ts](../backend/src/trades/sse/trade-stream-routes.ts). It uses Hono's streaming helper and removes the request
abort listener when the connection ends. Responses use no-store and disable
proxy buffering through X-Accel-Buffering.

The outbox relayer now runs after committed creates, at startup and every second
for recovery. The SSE route does not consume broadcaster events yet.

**Not implemented yet:** trade-event delivery or browser subscriptions. Those will be added in separate
reviewable steps before the stream carries trades. Ready currently confirms only
that an authenticated connection opened.

Tests use fake session persistence, a controlled clock and mocked timers, and
read/cancel the real Hono response stream.
No running database is required.
