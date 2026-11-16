import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@trade-blotter/database';
import type { TradeResponse } from '../../src/trades/trade-contract';
import { createTradeRepository } from '../../src/trades/trade-repository';
import { tradeHistoryResponseSchema } from '../../src/trades/history/trade-history-contract';

const tradeId = 'f1550000-0000-4000-8000-000000100001';
const actor = { id: 'd197282d-99ca-4260-833a-702f97d1cba1', displayName: 'JSMITH' };
const recordedAt = new Date('2026-11-14T09:00:00.000Z');

type AuditRecord = Omit<Prisma.TradeAuditGetPayload<{
  include: { actor: { select: { id: true; displayName: true } } };
}>, 'snapshot'> & { snapshot: TradeResponse };

function record(version: number): AuditRecord {
  return {
    id: `a0000000-0000-4000-8000-${String(version).padStart(12, '0')}`,
    tradeId, tradeVersion: version, actorId: actor.id, actor,
    action: version === 1 ? 'CREATED' as const : 'AMENDED' as const,
    reason: version === 1 ? null : 'Correct price.', recordedAt,
    snapshot: {
      id: tradeId, symbol: 'AAPL', side: 'BUY', quantity: '5000.000000',
      price: `${226 + version}.4500`, trader: 'JSMITH', ownerId: actor.id,
      book: 'EQUITIES_US', counterparty: null, tradeDate: recordedAt.toISOString(),
      status: 'ACTIVE', version, createdAt: recordedAt.toISOString(), updatedAt: recordedAt.toISOString(),
    },
  };
}

function setup(rows: AuditRecord[], options: { missingTrade?: boolean; fail?: boolean } = {}) {
  const calls = {
    trade: [] as Prisma.TradeFindUniqueArgs[],
    history: [] as Prisma.TradeAuditFindManyArgs[],
  };
  const fake = {
    trade: { findUnique: async (args: Prisma.TradeFindUniqueArgs) => {
      calls.trade.push(args);
      return options.missingTrade ? null : { id: tradeId };
    } },
    tradeAudit: {
      findMany: async (args: Prisma.TradeAuditFindManyArgs) => {
        calls.history.push(args);
        if (options.fail) throw new Error('Database unavailable.');
        return rows;
      },
    },
    $transaction: async () => { throw new Error('Append-only history reads need no transaction.'); },
  };
  const database = fake as unknown as Parameters<typeof createTradeRepository>[0];
  return { repository: createTradeRepository(database), calls };
}

test('history reads every entry for one trade, newest first, with safe actor fields', async () => {
  const rows = [record(3), record(2), record(1)];
  const h = setup(rows);
  const result = await h.repository.listHistory(tradeId);
  if (result.kind !== 'found') assert.fail('Expected trade history.');

  assert.deepEqual(h.calls.trade, [{ where: { id: tradeId }, select: { id: true } }]);
  assert.deepEqual(h.calls.history, [{
    where: { tradeId }, orderBy: { tradeVersion: 'desc' },
    include: { actor: { select: { id: true, displayName: true } } },
  }]);
  assert.deepEqual(result.entries.map((entry) => entry.tradeVersion), [3, 2, 1]);
  assert.deepEqual(result.entries[0].actor, actor);
  assert.equal(result.entries[0].recordedAt, recordedAt.toISOString());
  assert.equal(result.entries[0].reason, 'Correct price.');
  assert.deepEqual(result.entries[0].snapshot, rows[0].snapshot);
  assert.deepEqual(result.entries[1].changes, [{ field: 'price', before: '227.4500', after: '228.4500' }]);
  assert.deepEqual(result.entries[2].changes, []);
  assert.equal(tradeHistoryResponseSchema.safeParse({
    schemaVersion: 1, generatedAt: recordedAt.toISOString(), tradeId,
    entries: result.entries,
  }).success, true);
});

test('history returns not-found without reading audits when the trade does not exist', async () => {
  const h = setup([], { missingTrade: true });
  assert.deepEqual(await h.repository.listHistory(tradeId), { kind: 'not-found' });
  assert.equal(h.calls.history.length, 0);
});

test('an existing trade with no history returns no fabricated entries', async () => {
  const result = await setup([]).repository.listHistory(tradeId);
  assert.deepEqual(result, { kind: 'found', entries: [] });
});

test('history does not truncate trades with more than 100 audit entries', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => record(101 - index));
  const h = setup(rows);
  const result = await h.repository.listHistory(tradeId);
  if (result.kind !== 'found') assert.fail('Expected trade history.');
  assert.equal(h.calls.history.length, 1);
  assert.equal(h.calls.history[0].take, undefined);
  assert.equal(result.entries.length, 101);
  assert.deepEqual(result.entries.map((entry) => entry.tradeVersion), rows.map((row) => row.tradeVersion));
  assert.deepEqual(result.entries.at(-1)?.changes, []);
});

test('history diffs preserve cleared nullable fields, exact amounts and cancellation status', async () => {
  const created = record(1);
  const amended = record(2);
  amended.snapshot.book = null;
  amended.snapshot.quantity = '6000.000000';
  amended.snapshot.counterparty = 'Goldman Sachs';
  amended.snapshot.side = 'SELL';
  amended.snapshot.tradeDate = '2026-11-14T08:00:00.000Z';
  const cancelled = {
    ...amended, id: record(3).id, tradeVersion: 3, action: 'CANCELLED', reason: null,
    snapshot: { ...amended.snapshot, version: 3, status: 'CANCELLED' },
  } satisfies AuditRecord;
  const result = await setup([cancelled, amended, created]).repository.listHistory(tradeId);
  if (result.kind !== 'found') assert.fail('Expected trade history.');
  assert.deepEqual(result.entries[0].changes, [{ field: 'status', before: 'ACTIVE', after: 'CANCELLED' }]);
  assert.deepEqual(result.entries[1].changes, [
    { field: 'side', before: 'BUY', after: 'SELL' },
    { field: 'quantity', before: '5000.000000', after: '6000.000000' },
    { field: 'price', before: '227.4500', after: '228.4500' },
    { field: 'book', before: 'EQUITIES_US', after: null },
    { field: 'counterparty', before: null, after: 'Goldman Sachs' },
    { field: 'tradeDate', before: recordedAt.toISOString(), after: '2026-11-14T08:00:00.000Z' },
  ]);
});

test('history never infers changes across a missing version or a missing predecessor', async () => {
  for (const rows of [[record(3), record(1)], [record(2)]]) {
    const result = await setup(rows).repository.listHistory(tradeId);
    if (result.kind !== 'found') assert.fail('Expected trade history.');
    assert.equal(result.entries[0].changes, null);
  }
});

test('invalid stored snapshots fail visibly instead of returning misleading history', async () => {
  for (const snapshot of [
    { ...record(1).snapshot, price: 227.45 },
    { ...record(1).snapshot, id: actor.id },
    { ...record(1).snapshot, version: 2 },
  ]) {
    const row = { ...record(1), snapshot } as unknown as AuditRecord;
    await assert.rejects(setup([row]).repository.listHistory(tradeId));
  }
});

test('history database failures propagate to the caller', async () => {
  await assert.rejects(setup([], { fail: true }).repository.listHistory(tradeId), /Database unavailable/);
});
