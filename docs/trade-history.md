# Trade history storage

**Implemented:** Prisma model, append-only SQL migration and seeded histories.
Create, amend and cancel write audit entries transactionally. The history read
contract, repository reads and GET endpoint are implemented. The history UI is next.

## Stored entry

`TradeAudit` stores one resulting public trade snapshot per version:

| Field | Meaning |
| --- | --- |
| `id` | Entry UUID |
| `tradeId`, `tradeVersion` | Trade identity and resulting version |
| `action` | CREATED, AMENDED or CANCELLED |
| `actorId` | Required authenticated actor |
| `reason` | Optional reason, at most 500 characters |
| `snapshot` | JSONB public trade DTO, with exact decimal strings and UTC times |
| `recordedAt` | Server recording time, distinct from trade execution time |

The unique `(tradeId, tradeVersion)` index prevents duplicate entries and supports
newest-first history reads for a trade. No additional history indexes are added.
There is no updatedAt: entries are never edited.

## Database rules

- UPDATE, DELETE and TRUNCATE are rejected by a statement-level trigger, including
  empty updates/deletes and a cascading truncate from a referenced table.
- Trade/actor foreign keys use RESTRICT for deletion and ID changes.
- Versions must be positive. CREATED requires version 1 and no reason; AMENDED and
  CANCELLED require a later version. Every entry requires an actor.
- Snapshot JSON must be an object with the same trade ID and numeric version as
  the entry. The history mapper and GET response validate the full public DTO.

These rules supplement the application. Database owners can alter/drop triggers;
production runtime credentials should not own the schema. This is not a claim of
administrator-proof or certified regulatory storage.

## Seed and rollout

The migration creates storage only: it does not copy existing trades or explicitly
lock the Trade table. The updated seed prepares 500 trades and 649 synthetic audit
entries: CREATED v1 for every trade, two price amendments for ACTIVE v3 fixtures,
and a cancellation after creation for CANCELLED v2 fixtures. Every final snapshot
matches its trade, including decimal strings, nullable fields and UTC timestamps.
Recording times follow the synthetic changes; they are not real user activity.

`seed-trades.ts` generates fixtures without database access. Its writer uses the
existing seed transaction: bulk-insert trades, then bulk-insert histories only for
the returned new trade IDs. ID matching does not depend on return order. Existing
trades/history are untouched on reruns; missing history on old trades is not
fabricated. Fresh seeding is intended after the planned demo reset. Counts report
only newly inserted trades and entries. Seeded data emits no outbox events.

The local demo database was reset, all three migrations applied, and the seed run.
Read-back checks found 500 trades and 649 entries (500 CREATED, 78 AMENDED,
71 CANCELLED), with complete version chains and final snapshots matching all trades.
New API creations, amendments and cancellations append their corresponding entries
transactionally. Existing seeded histories remain intact.

Create saves its returned trade snapshot, CREATED action, version, authenticated
actor and null reason inside the existing trade/outbox/idempotency transaction.
The database sets recordedAt. Replays and unknown instruments add no audit entry.
Audit errors abort the transaction; concurrent idempotency losers roll back their
attempted history before reading the winner. Audit uniqueness errors are not
mistaken for idempotent replays. The response and SSE payload remain unchanged.

Amend/cancel save AMENDED/CANCELLED with the resulting DTO, actor, resulting version
and normalized optional reason before their outbox insert in the same transaction.
No extra reads are added; cancellation still uses the guarded update's returned row.
An audit error aborts the transaction. Conflicts, no-ops, missing/forbidden trades,
repeated cancellation and drafts add no successful-change history. Responses and
SSE payloads are unchanged; outbox delivery is independent of retained audit storage.

## History endpoint

`GET /api/trades/:id/history` permits both signed-in roles under the existing
shared trade visibility rules, including another trader's trades. The response is
`{schemaVersion: 1, generatedAt, tradeId, entries}`.

Fetch every retained entry for this trade, newest version first. Individual histories
are expected to be short, so the MVP has no pagination parameters, pageInfo or silent
truncation. Trade versions still identify revisions. Reconsider pagination only if
actual per-trade history sizes justify it. An overall audit listing is deferred.

Each entry contains id, tradeVersion, action, actor `{id, displayName}`, reason,
recordedAt, full snapshot and changes. No account email/password/role fields are
included. Changes use `{field, before, after}` and the existing trade field formats;
after agrees with the snapshot. Only editable business fields and status appear.
Creation has `changes: []`; amendment/cancellation changes are nonempty, or null
when the preceding version is unavailable. A nullable before/after value represents
cleared Book/Counterparty metadata; it does not mean missing historical evidence.

`listHistory(tradeId)` is implemented in the existing trade repository:

1. Check that the trade exists; return not-found before querying audit entries.
2. Read all its audit entries in descending version order using the existing unique
   (tradeId, tradeVersion) index. Include only actor ID and display name.
3. Validate snapshots, derive changes and return the complete entries array.

`trade-history-mapper.ts` compares only consecutive versions: comparing v3 with v1
cannot establish exactly what changed in v3, so changes is null. Creation uses [].
Malformed snapshots fail rather than becoming fabricated history. A trade with no
stored history returns an empty array. Actor display names come from the current
account record; the trade snapshot remains the historical saved DTO.

Reads need no explicit transaction because retained audit rows are append-only.
Snapshot and entry validation enforce trade/version agreement, action/state
consistency and valid field differences. The response contract additionally checks
that entries belong to the selected trade and have descending unique versions.
`trade-history-routes.ts` uses the existing session middleware, validates and
normalizes the UUID, calls listHistory and validates the complete response. Invalid
IDs return 400 INVALID_INPUT; missing trades return 404 TRADE_NOT_FOUND. Missing or
expired sessions return 401. Repository/response validation errors use the existing
sanitized 500 INTERNAL_ERROR handler. Responses use Cache-Control: no-store.
Foreground reads record session activity; the existing background-request header
suppresses idle renewal while preserving all session checks. The history UI is next.

## Verification

Disposable PostgreSQL 18 checks covered the three actions, required actors, an
empty audit table after migration, allowed inserts/reads,
blocked mutations/truncation, uniqueness, actor/version/snapshot constraints,
reference restrictions and rollback after a failed audit insert. These are local
SQL checks, not a live-database dependency in CI. Prisma validation and client/type
checks verify the model. Six database-independent unit tests cover fixture histories,
final-state agreement, new-ID selection, reruns and write-failure propagation. They
run through root `pnpm test` and CI; root typecheck includes seed/test TypeScript.
Repository tests for create/amend/cancel also use fake persistence to verify full
audit snapshots, actor/reason/version fields, transactional error propagation and
no history for rejected/conflicting/no-op operations. They verify repository calls,
not PostgreSQL rollback. Eight history repository tests cover complete reads (including more than 100
entries), missing trades, empty histories, all editable field changes,
cancellation status, missing predecessors, malformed snapshots and database errors.
These tests use fake persistence and do not verify PostgreSQL execution plans.
Eleven HTTP route tests use the real app/session middleware with fake repositories.
They cover missing/expired sessions, both roles reading another trader's history,
UUID normalization/validation, missing trades, empty results, sanitized failures,
invalid/private repository output and foreground/background activity handling.
No live-database test dependency was added.

Reference: [PostgreSQL statement-level triggers](https://www.postgresql.org/docs/18/sql-createtrigger.html).
