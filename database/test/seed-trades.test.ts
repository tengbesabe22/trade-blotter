import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '../generated/prisma/client.ts';
import { createSeedTradeFixtures, insertSeedTradeFixtures, type SeedTransaction } from '../prisma/seed-trades.ts';

const instruments = [
  { id: '33333333-3333-4333-8333-333333333333', symbol: 'AAPL', price: '227.4500' },
  { id: '44444444-4444-4444-8444-444444444444', symbol: 'MSFT', price: '415.2600' },
];
const traders = [
  { id: '11111111-1111-4111-8111-111111111111', displayName: 'JSMITH' },
  { id: '22222222-2222-4222-8222-222222222222', displayName: 'ADOE' },
];

const fixtures = () => createSeedTradeFixtures(instruments, traders);

test('500 deterministic trades have complete histories matching their final states', () => {
  const records = fixtures();
  assert.equal(records.length, 500);
  assert.equal(records.flatMap((record) => record.auditEntries).length, 649);
  assert.deepEqual(records, fixtures());

  for (const { trade, auditEntries } of records) {
    assert.equal(auditEntries.length, trade.version);
    assert.deepEqual(auditEntries.map((entry) => entry.tradeVersion), Array.from({ length: trade.version }, (_, i) => i + 1));
    const instrument = instruments.find((record) => record.id === trade.instrumentId)!;
    const trader = traders.find((record) => record.id === trade.userId)!;
    const { instrumentId: _instrumentId, userId: _userId, tradeDate, createdAt, updatedAt, ...fields } = trade;
    assert.deepEqual(auditEntries.at(-1)!.snapshot, {
      ...fields, symbol: instrument.symbol, ownerId: trader.id, trader: trader.displayName,
      tradeDate: tradeDate.toISOString(), createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(),
    });
    for (const entry of auditEntries) {
      assert.equal(entry.actorId, trade.userId);
      assert.equal(entry.tradeId, trade.id);
      assert.equal(entry.snapshot.id, trade.id);
      assert.equal(entry.snapshot.version, entry.tradeVersion);
      assert.match(entry.snapshot.quantity, /^\d+\.\d{6}$/);
      assert.match(entry.snapshot.price, /^\d+\.\d{4}$/);
      assert.equal(entry.recordedAt.toISOString(), entry.snapshot.updatedAt);
    }
  }
});

test('creation starts ACTIVE at v1; amendments change price; cancellation changes status', () => {
  const records = fixtures();
  const created = records[0].auditEntries;
  assert.deepEqual(created.map((entry) => entry.action), ['CREATED']);
  assert.equal(created[0].snapshot.status, 'ACTIVE');
  assert.equal(created[0].snapshot.price, '227.4500');
  assert.equal(created[0].reason, null);

  const amended = records[11].auditEntries;
  assert.deepEqual(amended.map((entry) => entry.action), ['CREATED', 'AMENDED', 'AMENDED']);
  for (let i = 1; i < amended.length; i += 1) {
    assert.notEqual(amended[i].snapshot.price, amended[i - 1].snapshot.price);
    assert.equal(amended[i].snapshot.status, 'ACTIVE');
    assert.ok(amended[i].recordedAt > amended[i - 1].recordedAt);
    assert.ok(amended[i].reason);
  }

  const cancelled = records[7].auditEntries;
  assert.deepEqual(cancelled.map((entry) => entry.action), ['CREATED', 'CANCELLED']);
  assert.equal(cancelled[0].snapshot.status, 'ACTIVE');
  assert.equal(cancelled[1].snapshot.status, 'CANCELLED');
  assert.equal(cancelled[0].snapshot.price, cancelled[1].snapshot.price);
  assert.equal(cancelled[0].snapshot.quantity, cancelled[1].snapshot.quantity);
});

function writer(insertedIds: string[], failure?: 'trade' | 'audit') {
  const calls: string[] = [];
  let tradeInput: { data: Prisma.TradeCreateManyInput[]; skipDuplicates: boolean; select: { id: true } } | undefined;
  let auditInput: { data: Prisma.TradeAuditCreateManyInput[] } | undefined;
  const error = new Error('Seed write failed.');
  const tx = {
    trade: { createManyAndReturn: async (input: NonNullable<typeof tradeInput>) => {
      calls.push('trade');
      tradeInput = input;
      if (failure === 'trade') throw error;
      return insertedIds.map((id) => ({ id }));
    } },
    tradeAudit: { createMany: async (input: NonNullable<typeof auditInput>) => {
      calls.push('audit');
      auditInput = input;
      if (failure === 'audit') throw error;
      return { count: input.data.length };
    } },
  };
  return { tx: tx as unknown as SeedTransaction, calls, error,
    trades: () => tradeInput, audits: () => auditInput };
}

test('bulk inserts attach histories only to inserted IDs, regardless of returned order', async () => {
  const records = fixtures().slice(0, 12);
  const h = writer([records[11].trade.id, records[0].trade.id]);
  assert.deepEqual(await insertSeedTradeFixtures(h.tx, records), { trades: 2, auditEntries: 4 });
  assert.deepEqual(h.calls, ['trade', 'audit']);
  assert.equal(h.trades()?.skipDuplicates, true);
  assert.deepEqual(h.trades()?.data, records.map((record) => record.trade));
  assert.deepEqual(h.audits()?.data, [...records[0].auditEntries, ...records[11].auditEntries]);
});

test('a rerun with no inserted trades writes no audit rows', async () => {
  const h = writer([]);
  assert.deepEqual(await insertSeedTradeFixtures(h.tx, fixtures()), { trades: 0, auditEntries: 0 });
  assert.deepEqual(h.calls, ['trade']);
  assert.equal(h.audits(), undefined);
});

for (const failure of ['trade', 'audit'] as const) {
  test(`${failure} failures propagate to the owning seed transaction`, async () => {
    const records = fixtures().slice(0, 1);
    const h = writer([records[0].trade.id], failure);
    await assert.rejects(insertSeedTradeFixtures(h.tx, records), (error) => error === h.error);
    assert.deepEqual(h.calls, failure === 'trade' ? ['trade'] : ['trade', 'audit']);
  });
}
