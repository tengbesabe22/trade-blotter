# Trade history storage

**Implemented:** Prisma model, append-only SQL migration and seeded histories.
Creation audit writes are implemented. Amendment/cancellation audit writes and the
history API/UI are next.

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
  the entry. Full DTO validation belongs to the upcoming backend contract.

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
New API creations now append their CREATED entry transactionally. Existing seeded
histories remain intact. Amendment/cancellation audit writes are next.

Create saves its returned trade snapshot, CREATED action, version, authenticated
actor and null reason inside the existing trade/outbox/idempotency transaction.
The database sets recordedAt. Replays and unknown instruments add no audit entry.
Audit errors abort the transaction; concurrent idempotency losers roll back their
attempted history before reading the winner. Audit uniqueness errors are not
mistaken for idempotent replays. The response and SSE payload remain unchanged.

Amend/cancel transaction integration remains pending. Conflicts, no-ops, rejected
requests and drafts must add no successful-change history. Outbox delivery remains
independent of retained audit storage.

## Verification

Disposable PostgreSQL 18 checks covered the three actions, required actors, an
empty audit table after migration, allowed inserts/reads,
blocked mutations/truncation, uniqueness, actor/version/snapshot constraints,
reference restrictions and rollback after a failed audit insert. These are local
SQL checks, not a live-database dependency in CI. Prisma validation and client/type
checks verify the model. Six database-independent unit tests cover fixture histories,
final-state agreement, new-ID selection, reruns and write-failure propagation. They
run through root `pnpm test` and CI; root typecheck includes seed/test TypeScript.
Creation repository tests also use fake persistence to verify the full audit
snapshot, transactional error propagation, replay behavior and concurrent-key
handling. This slice added no live-database test dependency.

Reference: [PostgreSQL statement-level triggers](https://www.postgresql.org/docs/18/sql-createtrigger.html).
