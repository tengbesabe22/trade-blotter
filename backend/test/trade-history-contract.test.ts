import assert from 'node:assert/strict';
import test from 'node:test';
import {
  tradeHistoryIdSchema,
  tradeHistoryEntrySchema,
  tradeHistoryResponseSchema,
} from '../src/trades/history/trade-history-contract';

const tradeId = 'f1550000-0000-4000-8000-000000100001';
const actor = { id: 'd197282d-99ca-4260-833a-702f97d1cba1', displayName: 'JSMITH' };
const snapshot = {
  id: tradeId, symbol: 'AAPL', side: 'BUY', quantity: '5000.000000', price: '227.4500',
  trader: 'JSMITH', ownerId: actor.id, book: 'EQUITIES_US', counterparty: null,
  tradeDate: '2026-08-18T09:15:23.000Z', status: 'ACTIVE', version: 1,
  createdAt: '2026-08-18T09:16:00.000Z', updatedAt: '2026-08-18T09:16:00.000Z',
};
const created = {
  id: 'a1111111-1111-4111-8111-111111111111', tradeVersion: 1, action: 'CREATED', actor,
  reason: null, recordedAt: snapshot.createdAt, snapshot, changes: [],
};
const amended = {
  ...created, id: 'a2222222-2222-4222-8222-222222222222', tradeVersion: 2, action: 'AMENDED',
  reason: 'Correct price and book.', recordedAt: '2026-08-18T09:20:00.000Z',
  snapshot: { ...snapshot, version: 2, price: '230.0000', book: null, updatedAt: '2026-08-18T09:20:00.000Z' },
  changes: [
    { field: 'price', before: '227.4500', after: '230.0000' },
    { field: 'book', before: 'EQUITIES_US', after: null },
  ],
};
const cancelled = {
  ...amended, id: 'a3333333-3333-4333-8333-333333333333', tradeVersion: 3, action: 'CANCELLED',
  reason: null, recordedAt: '2026-08-18T09:25:00.000Z',
  snapshot: { ...amended.snapshot, version: 3, status: 'CANCELLED', updatedAt: '2026-08-18T09:25:00.000Z' },
  changes: [{ field: 'status', before: 'ACTIVE', after: 'CANCELLED' }],
};
const history = {
  schemaVersion: 1, generatedAt: '2026-11-14T09:00:00.000Z', tradeId,
  entries: [cancelled, amended, created],
};

test('history path requires a UUID and normalizes its case', () => {
  assert.equal(tradeHistoryIdSchema.parse(tradeId.toUpperCase()), tradeId);
  assert.equal(tradeHistoryIdSchema.safeParse('TRD-100001').success, false);
});

test('history entries preserve all three actions, exact snapshots, nullable fields and reasons', () => {
  for (const entry of [created, amended, cancelled]) assert.deepEqual(tradeHistoryEntrySchema.parse(entry), entry);
  assert.deepEqual(tradeHistoryResponseSchema.parse(history), history);
});

test('unavailable prior state is explicit rather than inventing old field values', () => {
  assert.deepEqual(tradeHistoryEntrySchema.parse({ ...amended, changes: null }).changes, null);
  assert.equal(tradeHistoryEntrySchema.safeParse({ ...created, changes: null }).success, false);
});

test('history entry rejects malformed snapshots, mismatched versions and invalid action states', () => {
  for (const entry of [
    { ...amended, tradeVersion: 3 },
    { ...created, action: 'BASELINE' },
    { ...created, reason: 'Invented creation reason.' },
    { ...created, snapshot: { ...snapshot, status: 'CANCELLED' } },
    { ...amended, snapshot: { ...amended.snapshot, status: 'CANCELLED' } },
    { ...cancelled, snapshot: { ...cancelled.snapshot, status: 'ACTIVE' } },
    { ...amended, changes: [] },
    { ...amended, reason: 'x'.repeat(501) },
    { ...amended, snapshot: { ...amended.snapshot, price: 230 } },
    { ...amended, snapshot: { ...amended.snapshot, quantity: '5000' } },
  ]) assert.equal(tradeHistoryEntrySchema.safeParse(entry).success, false);
});

test('history actor contains only public identity fields', () => {
  for (const actorValue of [null, { ...actor, id: 'invalid' }, { ...actor, displayName: '' }, { ...actor, displayName: '   ' },
    { ...actor, email: 'private@example.com' }, { ...actor, passwordHash: 'secret' }]) {
    assert.equal(tradeHistoryEntrySchema.safeParse({ ...created, actor: actorValue }).success, false);
  }
});

test('field changes use the existing trade field validators and match the resulting snapshot', () => {
  for (const changes of [
    [{ field: 'ownerId', before: actor.id, after: actor.id }],
    [{ field: 'price', before: '227.4500', after: '227.4500' }],
    [{ field: 'price', before: 'not-a-price', after: '230.0000' }],
    [{ field: 'price', before: null, after: '230.0000' }],
    [{ field: 'price', before: '227.4500', after: 230 }],
    [{ field: 'price', before: '227.4500', after: '240.0000' }],
    [amended.changes[0], amended.changes[0]],
  ]) assert.equal(tradeHistoryEntrySchema.safeParse({ ...amended, changes }).success, false);
});

test('history permits an empty result without pagination metadata', () => {
  const emptyHistory = { ...history, entries: [] };
  assert.deepEqual(tradeHistoryResponseSchema.parse(emptyHistory), emptyHistory);
});

test('history returns more than 100 entries without truncation or a response cap', () => {
  const entries = Array.from({ length: 100 }, (_, index) => {
    const version = 101 - index;
    const price = `${226 + version}.4500`;
    return {
      ...amended, id: `a0000000-0000-4000-8000-${String(version).padStart(12, '0')}`, tradeVersion: version,
      snapshot: { ...amended.snapshot, version, price },
      changes: [{ field: 'price', before: `${225 + version}.4500`, after: price }],
    };
  });
  const response = { ...history, entries: [...entries, created] };
  assert.deepEqual(tradeHistoryResponseSchema.parse(response), response);
});

test('history rejects mixed trades, repeated/out-of-order versions and unsupported metadata', () => {
  for (const response of [
    { ...history, tradeId: actor.id },
    { ...history, entries: [created, amended] },
    { ...history, entries: [amended, amended] },
    { ...history, pageInfo: { limit: 20, nextCursor: null } },
    { ...history, schemaVersion: 2 },
  ]) assert.equal(tradeHistoryResponseSchema.safeParse(response).success, false);
});
