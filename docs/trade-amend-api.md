# Amendments

`PATCH /api/trades/:id` is implemented for signed-in traders amending their own
ACTIVE trades. Amendment SSE delivery and the frontend form remain pending.

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
limited to 500 characters, and saved in the outbox payload. Permanent audit history
remains planned.

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
saves the resulting trade and amendment outbox record in the same transaction.
A concurrent winner returns a conflict with current state, without silently retrying.
Amendments never look up a replacement instrument.
