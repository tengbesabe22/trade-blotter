# Create a trade

`POST /api/trades` creates a trade for the logged-in trader.
[Sign in first](authentication.md#sign-in). Read-only accounts receive `403`.

## Frontend flow

Traders use the **Create trade** panel, select an instrument and enter trade details, then submit.
Execution time is entered in UTC; quantity and price stay decimal strings. The form
validates fields before POST and displays backend validation errors without losing input.
Reviewers have no create button; the backend also enforces their read-only role.

After success, show the trade ID and refresh the current bounded trade page through
TanStack Query. Sorting and page position are preserved, so the new trade may belong
outside the visible page. SSE supplies live changes to connected clients.

Duplicate submission is blocked while saving. For a network failure, server error
or malformed success response, freeze the submitted fields and offer **Retry trade**
with the same key/body. This pending attempt stays in component memory; it is not
restored after a browser reload. A definitive validation rejection permits editing.

## Instrument selection

`InstrumentSelector.tsx` is implemented independently of the form and cache. It
accepts an instrument list, controlled selected symbol, selection callback, disabled
state and optional validation error. Search matches ticker/company name without
case sensitivity. Editing clears a previous selection; only choosing an option
commits its ticker. Arrows highlight, Enter selects without form submission, Escape
or Tab dismiss, and blur discards an uncommitted search. Keyboard behavior follows
the [WAI combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

Create trade now loads this list through `useTradeOptions()`. Search runs locally
without additional requests. Loading, failed and empty lookups block new trades;
failures/empty lists offer **Retry instruments** without clearing other fields.
An expired lookup session uses the existing sign-in flow. The form verifies the
committed symbol belongs to the loaded catalogue before starting a new request.
Reset/success clear both the selected value and the selector's local search state.
Pending/uncertain submissions disable the selector. **Retry trade** still uses the
saved body/key even if the catalogue later becomes unavailable; lookup rules apply
only to new submissions. The server continues validating instrument existence.

## Request

| Header | Value |
| --- | --- |
| `Cookie` | Current session; sent automatically by the browser |
| `Origin` | Configured UI origin; locally `http://localhost:5173` |
| `Content-Type` | `application/json`; charset parameters are accepted |
| `Idempotency-Key` | A new UUID or other valid key for each intentional trade |

Body limit: **4 KiB**. Keys contain 1–120 characters from `A-Z a-z 0-9 . _ : -`.
Reuse the same key when retrying a submission.

```json
{
  "symbol": "AAPL",
  "side": "BUY",
  "quantity": "5000",
  "price": "227.45",
  "tradeDate": "2026-08-18T09:15:23Z",
  "book": "EQUITIES_UK",
  "counterparty": "Goldman Sachs"
}
```

| Field | Validation and normalization |
| --- | --- |
| `symbol` | Trim, uppercase, 1–12 characters; must exist in the seeded catalog |
| `side` | Exactly `BUY` or `SELL` |
| `quantity` | Positive decimal string, up to 6 places, maximum `1000000000`; output has 6 places |
| `price` | Positive decimal string, up to 4 places, maximum `1000000`; output has 4 places |
| `tradeDate` | Valid timestamp with seconds and timezone, up to millisecond precision; normalize to UTC ISO |
| `book` | Optional string/null; trim, blank becomes null; maximum 64 characters |
| `counterparty` | Optional string/null; trim, blank becomes null; maximum 120 characters |

All fields except `book` and `counterparty` are required. Metadata lengths are
checked after trimming. There is no execution-time window restriction.

Decimal strings preserve exact values across JSON and JavaScript. Reject excess
precision, leading zeros except `0`, signs, whitespace, exponent notation, commas,
and currency symbols. Validation uses Decimal arithmetic and never silently rounds.

Unknown fields are rejected. Ownership, ID, status, version, and record timestamps
are assigned by the server. New trades start as `ACTIVE`, version `1`.

## Response

Creation and matching retries return **201**, with `Cache-Control: no-store`:

```json
{
  "trade": {
    "id": "<server-generated UUID>",
    "symbol": "AAPL",
    "side": "BUY",
    "quantity": "5000.000000",
    "price": "227.4500",
    "trader": "JSMITH",
    "ownerId": "<session user UUID>",
    "book": "EQUITIES_UK",
    "counterparty": "Goldman Sachs",
    "tradeDate": "2026-08-18T09:15:23.000Z",
    "status": "ACTIVE",
    "version": 1,
    "createdAt": "<server UTC timestamp>",
    "updatedAt": "<server UTC timestamp>"
  }
}
```

## Retries and durability

Keys are scoped to the logged-in user:

| Same user/key | Result |
| --- | --- |
| Same normalized input | Return the original 201 body |
| Different normalized input | Return `409 IDEMPOTENCY_CONFLICT` |

Different users may reuse a key. Failed validation and unknown-symbol requests do
not consume it. A replay returns the original creation response even after later
amendment/cancellation features change that trade.

The fingerprint is SHA-256 of JSON with this fixed order:

```text
{method:"POST",path:"/api/trades",input:{symbol,side,quantity,price,tradeDate,book,counterparty}}
```

The repository checks for a saved response before consulting the catalog.
For a new trade, **trade + CREATED audit entry + full outbox payload + idempotency
result commit together**. The audit stores the exact returned trade snapshot,
resulting version, authenticated actor and null reason. PostgreSQL supplies its
recording timestamp. Audit failures abort the transaction; matching replays return
before any insert and add no history. Unknown instruments add no audit entry.
A concurrent user/key conflict rolls back the losing transaction, then reads and
compares the winner's committed result. Unrelated database errors propagate.

After commit, a new create wakes the relayer without waiting for delivery.
Startup and 1-second recovery checks find missed wakes and due retries. Connected
clients receive the complete trade through [SSE](trade-stream-api.md) and merge it
into the version-aware browser cache. Creation reuses the catalog lookup for its response.

## Errors

Errors return `{ "code": "...", "message": "..." }`.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | Invalid JSON, fields, or idempotency key |
| 400 | `UNKNOWN_INSTRUMENT` | Symbol is absent from the seeded catalog |
| 401 | `UNAUTHENTICATED` | Missing or expired session |
| 403 | `FORBIDDEN` | Read-only account |
| 403 | `FORBIDDEN_ORIGIN` | Missing or untrusted Origin |
| 409 | `IDEMPOTENCY_CONFLICT` | Key reused with different normalized input |
| 413 | `PAYLOAD_TOO_LARGE` | Body exceeds 4 KiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Body is not JSON |
| 500 | `INTERNAL_ERROR` | Unexpected failure; no partial transaction writes |

## Code map and verification

Creation handlers and helpers live in `backend/src/trades/creation/`. Shared trade
DTOs, mapping and persistence stay in `backend/src/trades/`:

| File | Responsibility |
| --- | --- |
| `trade-routes.ts` | Composes listing, creation, amendment and cancellation routes |
| `creation/trade-create-routes.ts` | POST handler, validation and response statuses |
| `trade-middleware.ts` | Shared 4 KiB request-body limit |
| `trade-contract.ts` | Shared validators, response schemas, and inferred types |
| `creation/trade-create-contract.ts` | Creation request normalization, command, and result contracts |
| `trade-mapper.ts` | Database record to public response |
| `creation/trade-fingerprint.ts` | Canonical request hashing |
| `trade-repository.ts` | Queries, transaction, and idempotency recovery |

`CreateTradeRequest` describes wire input; `NormalizedCreateTradeRequest` describes
parsed output. Run `pnpm test:trade-create` for HTTP tests or `pnpm test` for the
full backend suite. Contract tests call Zod directly; repository tests use real
repository code with fake database operations.

Live PostgreSQL concurrency/rollback verification is deferred. After the MVP is
complete, measure p50/p95 creation latency and query timings, plus commit-to-render
latency when SSE is ready. No numerical improvement is claimed yet.
