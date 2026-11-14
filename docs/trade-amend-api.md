# Amendments

`PATCH /api/trades/:id` is implemented for signed-in traders amending their own
ACTIVE trades. Successful amendments are delivered through SSE. The frontend API
client, ownership-aware row action and inline form are implemented.

## Inline editor

- A pencil icon (**Amend trade**) appears on your own ACTIVE rows. Other owners/cancelled rows have empty action cells;
  reviewers have no Actions column. Tooltips appear on hover or keyboard focus;
  Escape dismisses them. Backend authorization still applies.
- Selecting a row opens its prefilled form in the shared lower-right panel.
  Ticker/trade ID are fixed context. Finish or discard that edit before choosing
  another row. Closing/success restores Create trade with its draft preserved.
- Save sends only effective changed fields plus the optional reason and original
  version. Equivalent decimal formatting and reason-only edits make no request.
- Pending saves disable duplicate submission and discard. Success closes the form,
  confirms the trade and merges the returned record immediately without a GET.
- SSE does not overwrite the draft. A newer trade blocks Save until **Load latest**
  explicitly replaces the draft/version. A cancellation prevents further editing.
- Network/server/malformed-success failures keep the draft and show an unconfirmed
  outcome; they do not retry automatically. Check the current trade before another
  intentional submission. Session expiry returns to sign-in.

The sidebar form uses two-column fields, inline field errors and keyboard focus.
Opening focuses the panel; closing returns focus to the Trades heading.

Manual check: sign in as a trader, amend an owned ACTIVE row's price, and save.
A second signed-in window should receive the update. Try another trader's row and
a reviewer account to check action visibility. Cancellation uses the same sidebar slot.

## Editable fields

`changes` accepts `side`, `quantity`, `price`, `tradeDate`, `book` and `counterparty`.
Omitted fields stay unchanged; null/blank clears only book or counterparty.
Validation and normalization follow the [creation rules](trade-create-api.md#request).

```json
{
  "expectedVersion": 3,
  "changes": { "price": "228.5", "book": null },
  "reason": "Corrected execution price."
}
```

`expectedVersion` is a required positive integer. The optional reason is trimmed,
limited to 500 characters, and saved with the AMENDED audit entry and outbox payload.

## HTTP request and responses

[Sign in first](authentication.md#sign-in). Send the session cookie, trusted Origin
and `Content-Type: application/json`. Body limit: 4 KiB. No idempotency key is needed;
`expectedVersion` protects against concurrent changes.

Replace `<trade-id>` with a trade you own and use its current version:

```sh
curl -i -b .cookies -X PATCH 'http://localhost:3000/api/trades/<trade-id>' \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"expectedVersion":3,"changes":{"price":"228.5"},"reason":"Correct price."}'
```

| Status | Response |
| --- | --- |
| 200 | `{trade}` containing the complete updated record |
| 400 | `INVALID_INPUT` for invalid UUID/body; `NO_CHANGES` for an effective no-op |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` for read-only users/another owner; `FORBIDDEN_ORIGIN` for an untrusted origin |
| 404 | `TRADE_NOT_FOUND` |
| 409 | `TRADE_CONFLICT`, including `currentTrade` for a stale/cancelled record |
| 413 / 415 | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` |
| 500 | Sanitized `INTERNAL_ERROR` |

Responses use `Cache-Control: no-store`. On conflict, retain the draft and review
`currentTrade`; never silently substitute its version and retry the edit.

## Browser client

`tradeApi.amend(tradeId, input)` validates the ID and partial request, sends PATCH
with the session cookie, and returns the validated trade. Decimal strings stay
exact; the backend applies canonical fixed-scale formatting. It does not retry or
replace the submitted version automatically.

HTTP errors retain their JSON in `ApiError.responseBody` as `unknown`. Validate it
with `amendTradeConflictSchema` before using a conflict's `currentTrade` for review.
The inline form follows this validation and verifies that the trade ID matches.

## Instrument corrections

Symbol and instrument ID are immutable through amendments. The strict request
schema rejects either field, including an unchanged symbol or a symbol submitted
alongside another valid change. Create still accepts a seeded symbol.

For a wrong instrument, cancel the original trade and create a new trade with the
correct symbol. Keep the cancelled original visible. These are separate actions;
linked replacement records and an atomic replacement workflow are not implemented.

This is our blotter policy, informed by FINRA's ORF correction process, which
requires cancellation and a new entry for a different security. It is not a claim
that every market uses the same rules. See [ORF specification, section 3.4](https://www.finra.org/sites/default/files/AppSupportDoc/p455406.pdf).

## Repository flow

The shared `TradeRepository.amend` checks ownership, ACTIVE status, expected version
and effective changes. Its conditional update increments the version once, then
saves its full resulting DTO as an AMENDED audit snapshot, including the authenticated
actor, resulting version and optional reason, followed by the outbox record in the
same transaction. PostgreSQL supplies recordedAt. Audit/outbox failures abort the
transaction; no-ops and rejected or lost concurrent updates add neither record.
A concurrent winner returns a conflict with current state, without silently retrying.
Amendments never look up a replacement instrument. The summary adjustment and its
returned totals/version/time are also captured in that transaction: the outbox now
stores {trade, reason, summaries}. Metadata-only amendments use summaries: [] without
updating the summary revision. Symbol/currency come from the existing trade read;
there is no additional summary lookup. HTTP and current SSE shapes are unchanged.


## Live updates

After the transaction commits, the PATCH route wakes the existing outbox relayer
without awaiting delivery. Both traders and reviewers receive `trade.changed`
with `type: TRADE_AMENDED`, the complete trade and its new version. The browser
accepts this type and reuses the existing version-aware cache merge without an
extra GET for a visible row. Successful PATCH responses enter the same version
guard and buffer, so an older in-flight page response cannot undo the save. Conflicts, rejections and no-ops produce no event.
The optional reason remains in the outbox payload and is not included in SSE.
See the [stream guide](trade-stream-api.md#trade-change-events).
