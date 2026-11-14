# Cancel a trade

`POST /api/trades/:id/cancel` cancels an owned ACTIVE trade. The record stays in
the blotter with status `CANCELLED`; its business fields are retained.
The endpoint is implemented. Cancellation SSE delivery and UI remain pending.

## Request

[Sign in first](authentication.md#sign-in). Replace `<trade-id>` with an owned
trade's UUID and use its current version:

```sh
curl -i -b .cookies -X POST 'http://localhost:3000/api/trades/<trade-id>/cancel' \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"expectedVersion":3,"reason":"Duplicate booking."}'
```

- Require a session, trader role, trusted Origin and JSON body up to 4 KiB.
- `expectedVersion` is a required positive PostgreSQL Int value.
- `reason` is optional: trim it, limit to 500 characters, and normalize absent/null/blank to null.
- Reject unknown fields, including status, ownership and business-field edits.
- No idempotency key is required. Repeated cancellation conflicts; there is no uncancel endpoint.

## Responses

| Status | Response |
| --- | --- |
| 200 | `{trade}`: the complete CANCELLED trade with version incremented once |
| 400 | `INVALID_INPUT` for an invalid UUID or body |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` for read-only users/another owner, or `FORBIDDEN_ORIGIN` |
| 404 | `TRADE_NOT_FOUND` |
| 409 | `TRADE_CONFLICT`, including `currentTrade` for a stale/already-cancelled trade |
| 413 / 415 | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` |
| 500 | Sanitized `INTERNAL_ERROR` |

Responses use `Cache-Control: no-store`. On conflict, review current state rather
than automatically substituting its version and retrying.

## Persistence and delivery

The repository conditionally updates owner + ACTIVE + expectedVersion and returns
the changed row. Only a failed match needs a diagnostic read. Cancellation and its
outbox event commit in one transaction; the optional reason stays in the outbox.

After success, the route invokes `onTradeChanged` without waiting for delivery.
The current relayer selects creation/amendment events only, so cancellation events
remain pending until the SSE slice. For now, refresh trade listings to see a
cancellation made through curl. Rejections and failures do not wake delivery.
Permanent audit history and live summaries remain separate work.
