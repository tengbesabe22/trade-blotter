import assert from 'node:assert/strict';
import test from 'node:test';
import { tradeHistoryEntrySchema, tradeHistoryResponseSchema } from '../src/api/trade-history-contract';
import { createdHistory, amendedHistory, cancelledHistory, sampleHistory } from './trade-history-fixtures';
import { cancelledTrade } from './trade-fixtures';

test('history preserves all actions, exact decimal strings, reasons and cleared metadata', () => {
  assert.deepEqual(tradeHistoryResponseSchema.parse(sampleHistory), sampleHistory);
});

test('empty history and unavailable predecessor changes remain distinct from creation', () => {
  const empty = { ...sampleHistory, entries: [] };
  assert.deepEqual(tradeHistoryResponseSchema.parse(empty), empty);
  const gap = { ...amendedHistory, changes: null };
  assert.deepEqual(tradeHistoryEntrySchema.parse(gap), gap);
  assert.equal(tradeHistoryEntrySchema.safeParse({ ...createdHistory, changes: null }).success, false);
});

test('history does not impose a 100-entry response cap', () => {
  const entries = Array.from({ length: 100 }, (_, index) => {
    const version = 101 - index;
    const price = `${226 + version}.4500`;
    return {
      ...amendedHistory, id: `a0000000-0000-4000-8000-${String(version).padStart(12, '0')}`, tradeVersion: version,
      snapshot: { ...amendedHistory.snapshot, version, price },
      changes: [{ field: 'price', before: `${225 + version}.4500`, after: price }],
    };
  });
  const history = { ...sampleHistory, entries: [...entries, createdHistory] };
  assert.deepEqual(tradeHistoryResponseSchema.parse(history), history);
});

test('history rejects malformed snapshots, private actors and contradictory action/version states', () => {
  for (const entry of [
    { ...createdHistory, snapshot: { ...createdHistory.snapshot, price: 227.45 } },
    { ...createdHistory, actor: { ...createdHistory.actor, email: 'private@example.com' } },
    { ...createdHistory, tradeVersion: 2 },
    { ...createdHistory, reason: 'Not a creation reason.' },
    { ...amendedHistory, reason: 'R'.repeat(501) },
    { ...amendedHistory, snapshot: { ...amendedHistory.snapshot, status: 'CANCELLED' } },
    { ...cancelledHistory, snapshot: { ...cancelledHistory.snapshot, status: 'ACTIVE' } },
  ]) assert.equal(tradeHistoryEntrySchema.safeParse(entry).success, false);
});

test('history changes must be valid editable fields, distinct and consistent with the snapshot', () => {
  for (const changes of [
    [],
    [{ field: 'symbol', before: 'AAPL', after: 'MSFT' }],
    [{ field: 'price', before: '230.0000', after: '230.0000' }],
    [{ field: 'price', before: 'invalid', after: '230.0000' }],
    [{ field: 'price', before: null, after: '230.0000' }],
    [{ field: 'price', before: '227.4501', after: '240.0000' }],
    [amendedHistory.changes![0], amendedHistory.changes![0]],
  ]) assert.equal(tradeHistoryEntrySchema.safeParse({ ...amendedHistory, changes }).success, false);
});

test('history requires one trade, descending unique versions and the supported response format', () => {
  for (const history of [
    { ...sampleHistory, tradeId: cancelledTrade.id },
    { ...sampleHistory, entries: [createdHistory, amendedHistory] },
    { ...sampleHistory, entries: [amendedHistory, amendedHistory] },
    { ...sampleHistory, schemaVersion: 2 },
    { ...sampleHistory, pageInfo: { limit: 20, nextCursor: null } },
  ]) assert.equal(tradeHistoryResponseSchema.safeParse(history).success, false);
});
