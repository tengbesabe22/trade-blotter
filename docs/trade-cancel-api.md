# Cancel a trade

`POST /api/trades/:id/cancel` cancels an owned ACTIVE trade. The record stays in
the blotter with status `CANCELLED`; its business fields are retained.
The endpoint, SSE delivery, browser client and inline confirmation panel are implemented.

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

## Browser client

`tradeApi.cancel(tradeId, {expectedVersion, reason?})` validates the UUID and strict
request, posts with the session cookie, and returns the validated CANCELLED trade.
The response must match the requested ID and increment the submitted version once.
No idempotency key or automatic retry is added; submitted versions are not replaced.

Conflicts keep their details in `ApiError.responseBody` as `unknown`. Validate with
`cancelTradeConflictSchema` before reviewing its ACTIVE or already-CANCELLED
`currentTrade`. Network/malformed-success errors leave the outcome unconfirmed.

## Inline confirmation

- A circled-X icon (**Cancel trade**) appears beside the amend pencil only on
  your own ACTIVE rows. Both have hover/focus tooltips and accessible names. Reviewers
  have no Actions column; other owners and cancelled rows have empty action cells.
- The panel shows read-only trade details and an optional reason. **Keep trade**
  closes without submitting; **Confirm cancellation** sends the captured version.
  It replaces Create trade in the shared lower-right panel. Only one amendment
  or cancellation panel can be open; closing/success restores the creation draft.
- A newer version preserves the reason and blocks confirmation until **Review latest**
  is chosen. Confirmation is a separate action. Already-cancelled trades offer **Close**.
- While submitting, editing, closing and duplicate submissions are disabled.
  Unconfirmed network/server/response failures retain the reason and offer **Close**;
  there is no automatic retry or claim that the trade was kept.
- Opening focuses the panel; closing or success focuses the Trades heading.
  Success uses the existing version-aware cache merger immediately, without another GET.

## Persistence and delivery

The repository conditionally updates owner + ACTIVE + expectedVersion and returns
the changed row. Only a failed match needs a diagnostic read. Cancellation and its
outbox event commit in one transaction; the optional reason stays in the outbox.

After success, the route invokes `onTradeChanged` without waiting for delivery.
The relayer selects pending cancellation events and sends `trade.changed` with
`type: TRADE_CANCELLED` and the complete resulting trade. The reason is not sent
through SSE. Rejections and failures do not wake delivery.
Permanent audit history and live summaries remain separate work.


## Live browser behavior

The receiving table retains the row with `CANCELLED` status and the new version,
without another GET. Its Amend and Cancel trade actions disappear. An open amendment keeps its draft
but blocks saving, with a cancellation message. Existing version guards ignore
duplicate/older events, so a stale amendment cannot restore the active status.

Manual check: open the blotter in two separately signed-in browser sessions, then
choose Cancel trade on an owned visible row, enter a reason and confirm.
Both sessions should receive the cancellation without refreshing. Traders and
reviewers receive the same trade events. See the [stream guide](trade-stream-api.md#trade-change-events).
