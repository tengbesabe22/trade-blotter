import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@trade-blotter/database';
import { createTradeRepository, type TradeRecord } from '../src/trades/trade-repository';
import { amendTradeRequestSchema } from '../src/trades/amendments/trade-amend-contract';
import { toTradeResponse } from '../src/trades/trade-mapper';

const trade: TradeRecord = {
  id: 'f1550000-0000-4000-8000-000000100001',
  userId: 'd197282d-99ca-4260-833a-702f97d1cba1',
  instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05',
  instrument: { symbol: 'AAPL' }, user: { displayName: 'JSMITH' },
  side: 'BUY', quantity: new Prisma.Decimal('5000'), price: new Prisma.Decimal('227.45'),
  book: 'EQUITIES_US', counterparty: 'Example Bank',
  tradeDate: new Date('2026-08-18T09:15:23Z'), status: 'ACTIVE', version: 3,
  createdAt: new Date('2026-08-18T09:16:00Z'), updatedAt: new Date('2026-08-18T09:16:00Z'),
};

const command = {
  userId: trade.userId,
  tradeId: trade.id,
  input: amendTradeRequestSchema.parse({
    expectedVersion: 3, changes: { price: '228.5', book: null }, reason: 'Correct price.',
  }),
};
const updated: TradeRecord = {
  ...trade, price: new Prisma.Decimal('228.5'), book: null, version: 4,
  updatedAt: new Date('2026-11-14T09:00:00Z'),
};

type Options = {
  current?: TradeRecord | null;
  afterUpdate?: TradeRecord | null;
  count?: number;
  failAt?: 'update' | 'audit' | 'outbox';
};

function setup(options: Options = {}) {
  const current = options.current === undefined ? trade : options.current;
  const afterUpdate = options.afterUpdate === undefined ? updated : options.afterUpdate;
  const calls: string[] = [];
  const updates: Prisma.TradeUpdateManyArgs[] = [];
  const events: Prisma.OutboxEventUncheckedCreateInput[] = [];
  const audits: Prisma.TradeAuditUncheckedCreateInput[] = [];
  const failure = new Error('Database write failed.');
  let attemptedUpdate = false;

  const tx = {
    trade: {
      findUnique: async ({ where }: Prisma.TradeFindUniqueArgs) => {
        assert.deepEqual(where, { id: command.tradeId });
        calls.push('read');
        return attemptedUpdate ? afterUpdate : current;
      },
      updateMany: async (query: Prisma.TradeUpdateManyArgs) => {
        calls.push('update');
        updates.push(query);
        attemptedUpdate = true;
        if (options.failAt === 'update') throw failure;
        return { count: options.count ?? 1 };
      },
    },
    tradeAudit: { create: async ({ data }: { data: Prisma.TradeAuditUncheckedCreateInput }) => {
      calls.push('audit');
      audits.push(data);
      if (options.failAt === 'audit') throw failure;
    } },
    outboxEvent: { create: async ({ data }: { data: Prisma.OutboxEventUncheckedCreateInput }) => {
      calls.push('outbox');
      events.push(data);
      if (options.failAt === 'outbox') throw failure;
    } },
  };
  const fake = { $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => {
    calls.push('begin');
    try {
      const result = await work(tx);
      calls.push('commit');
      return result;
    } catch (error) {
      calls.push('rollback');
      throw error;
    }
  } };

  // The fake inspects persistence calls; it does not simulate PostgreSQL locks or rollback.
  const database = fake as unknown as Parameters<typeof createTradeRepository>[0];
  return { repository: createTradeRepository(database), calls, updates, events, audits, failure };
}

test('amend atomically guards owner/status/version and saves the resulting audit and event in the transaction', async () => {
  const h = setup();
  const response = toTradeResponse(updated);

  assert.deepEqual(await h.repository.amend(command), { kind: 'amended', body: { trade: response } });
  assert.deepEqual(h.updates[0], {
    where: { id: trade.id, userId: trade.userId, status: 'ACTIVE', version: 3 },
    data: { price: '228.5000', book: null, version: { increment: 1 } },
  });
  assert.deepEqual(h.audits, [{
    tradeId: trade.id, tradeVersion: 4, action: 'AMENDED', actorId: command.userId,
    reason: 'Correct price.', snapshot: response,
  }]);
  assert.deepEqual(h.events, [{
    type: 'TRADE_AMENDED', actorId: trade.userId, tradeId: trade.id, tradeVersion: 4,
    payload: { trade: response, reason: 'Correct price.' },
  }]);
  assert.deepEqual(h.calls, ['begin', 'read', 'update', 'read', 'audit', 'outbox', 'commit']);
});

test('a missing trade returns not-found without writes', async () => {
  const h = setup({ current: null });
  assert.deepEqual(await h.repository.amend(command), { kind: 'not-found' });
  assert.deepEqual(h.calls, ['begin', 'read', 'commit']);
});

test('another owner is forbidden before checking version or exposing the current trade', async () => {
  const h = setup({ current: { ...trade, userId: 'another-owner', version: 99, status: 'CANCELLED' } });
  assert.deepEqual(await h.repository.amend(command), { kind: 'forbidden' });
  assert.deepEqual(h.calls, ['begin', 'read', 'commit']);
});

for (const current of [{ ...trade, version: 4 }, { ...trade, status: 'CANCELLED' as const }]) {
  test(`a ${current.status === 'CANCELLED' ? 'cancelled' : 'stale'} trade conflicts without writes`, async () => {
    const h = setup({ current });
    assert.deepEqual(await h.repository.amend(command), { kind: 'conflict', currentTrade: toTradeResponse(current) });
    assert.deepEqual(h.calls, ['begin', 'read', 'commit']);
  });
}

test('normalized identical values and a reason alone do not create another version or event', async () => {
  const h = setup();
  const input = amendTradeRequestSchema.parse({
    expectedVersion: 3, changes: {
      side: 'BUY', price: '227.450', quantity: '5000.0',
      tradeDate: '2026-08-18T17:15:23+08:00', book: ' EQUITIES_US ', counterparty: 'Example Bank',
    }, reason: 'Only a comment.',
  });
  assert.deepEqual(await h.repository.amend({ ...command, input }), { kind: 'no-changes' });
  assert.deepEqual(h.calls, ['begin', 'read', 'commit']);
});

test('amend updates editable fields and converts execution time without changing the instrument', async () => {
  const h = setup();
  const input = amendTradeRequestSchema.parse({
    expectedVersion: 3, changes: {
      side: 'SELL', quantity: '125.5', tradeDate: '2026-11-14T17:15:23+08:00',
    },
  });
  await h.repository.amend({ ...command, input });
  assert.equal(h.audits[0]?.reason, null);
  assert.deepEqual(h.updates[0]?.data, {
    side: 'SELL', quantity: '125.500000',
    tradeDate: new Date('2026-11-14T09:15:23Z'), version: { increment: 1 },
  });
});

for (const afterUpdate of [{ ...trade, version: 4 }, { ...trade, version: 4, status: 'CANCELLED' as const }]) {
  test(`losing the atomic update to a concurrent ${afterUpdate.status === 'CANCELLED' ? 'cancellation' : 'amendment'} returns current state without an event`, async () => {
    const h = setup({ count: 0, afterUpdate });
    assert.deepEqual(await h.repository.amend(command), {
      kind: 'conflict', currentTrade: toTradeResponse(afterUpdate),
    });
    assert.equal(h.updates.length, 1);
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.audits, []);
  });
}

test('a record removed before the guarded update returns not-found without an event', async () => {
  const h = setup({ count: 0, afterUpdate: null });
  assert.deepEqual(await h.repository.amend(command), { kind: 'not-found' });
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.audits, []);
});

for (const failAt of ['update', 'audit', 'outbox'] as const) {
  test(`${failAt} errors escape the transaction instead of returning amendment success`, async () => {
    const h = setup({ failAt });
    await assert.rejects(h.repository.amend(command), (error) => error === h.failure);
    assert.equal(h.calls.at(-1), 'rollback');
    assert.equal(h.calls.includes('commit'), false);
    if (failAt === 'update') assert.deepEqual(h.audits, []);
    if (failAt !== 'outbox') assert.deepEqual(h.events, []);
  });
}
