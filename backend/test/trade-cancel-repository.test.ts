import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@trade-blotter/database';
import { createTradeRepository, type TradeRecord } from '../src/trades/trade-repository';
import { cancelTradeRequestSchema } from '../src/trades/cancellations/trade-cancel-contract';
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
const cancelled: TradeRecord = {
  ...trade, status: 'CANCELLED', version: 4, updatedAt: new Date('2026-11-14T09:00:00Z'),
};
const command = {
  userId: trade.userId, tradeId: trade.id,
  input: cancelTradeRequestSchema.parse({ expectedVersion: 3, reason: 'Duplicate booking.' }),
};

type Options = {
  current?: TradeRecord | null;
  updated?: TradeRecord | null;
  failAt?: 'update' | 'lookup' | 'audit' | 'outbox';
};

function setup(options: Options = {}) {
  const current = options.current === undefined ? trade : options.current;
  const updated = options.updated === undefined ? cancelled : options.updated;
  const calls: string[] = [];
  const updates: Prisma.TradeUpdateManyAndReturnArgs[] = [];
  const events: Prisma.OutboxEventUncheckedCreateInput[] = [];
  const audits: Prisma.TradeAuditUncheckedCreateInput[] = [];
  const failure = new Error('Database operation failed.');
  const tx = {
    trade: {
      findUnique: async ({ where }: Prisma.TradeFindUniqueArgs) => {
        assert.deepEqual(where, { id: trade.id });
        calls.push('read');
        if (options.failAt === 'lookup') throw failure;
        return current;
      },
      updateManyAndReturn: async (query: Prisma.TradeUpdateManyAndReturnArgs) => {
        calls.push('update');
        updates.push(query);
        if (options.failAt === 'update') throw failure;
        return updated ? [updated] : [];
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

  // Inspect real repository queries, without simulating PostgreSQL locking or rollback.
  const database = fake as unknown as Parameters<typeof createTradeRepository>[0];
  return { repository: createTradeRepository(database), calls, updates, events, audits, failure };
}

test('cancel returns the guarded update directly and saves its audit/event without reading the trade again', async () => {
  const h = setup();
  const response = toTradeResponse(cancelled);
  assert.deepEqual(await h.repository.cancel(command), { kind: 'cancelled', body: { trade: response } });
  assert.deepEqual(h.updates, [{
    where: { id: trade.id, userId: trade.userId, status: 'ACTIVE', version: 3 },
    data: { status: 'CANCELLED', version: { increment: 1 } },
    include: {
      instrument: { select: { symbol: true } },
      user: { select: { displayName: true } },
    },
  }]);
  assert.deepEqual(h.audits, [{
    tradeId: trade.id, tradeVersion: 4, action: 'CANCELLED', actorId: command.userId,
    reason: 'Duplicate booking.', snapshot: response,
  }]);
  assert.deepEqual(h.events, [{
    type: 'TRADE_CANCELLED', actorId: trade.userId, tradeId: trade.id, tradeVersion: 4,
    payload: { trade: response, reason: 'Duplicate booking.' },
  }]);
  assert.deepEqual(h.calls, ['begin', 'update', 'audit', 'outbox', 'commit']);
});

test('cancel retains null when no reason was supplied', async () => {
  const h = setup();
  await h.repository.cancel({ ...command, input: cancelTradeRequestSchema.parse({ expectedVersion: 3 }) });
  assert.equal(h.audits[0]?.reason, null);
  assert.deepEqual(h.events[0]?.payload, { trade: toTradeResponse(cancelled), reason: null });
});

test('a missing cancellation target returns not-found without writes', async () => {
  const h = setup({ updated: null, current: null });
  assert.deepEqual(await h.repository.cancel(command), { kind: 'not-found' });
  assert.deepEqual(h.calls, ['begin', 'update', 'read', 'commit']);
});

test('another owner is forbidden before status/version details are exposed', async () => {
  const h = setup({ updated: null, current: { ...cancelled, userId: 'another-owner' } });
  assert.deepEqual(await h.repository.cancel(command), { kind: 'forbidden' });
  assert.deepEqual(h.calls, ['begin', 'update', 'read', 'commit']);
});

for (const current of [{ ...trade, version: 4 }, cancelled]) {
  test(`a ${current.status === 'CANCELLED' ? 'repeated cancellation with the current version' : 'stale cancellation'} conflicts without writes`, async () => {
    const h = setup({ updated: null, current });
    const expectedVersion = current.status === 'CANCELLED' ? 4 : 3;
    assert.deepEqual(await h.repository.cancel({ ...command, input: { ...command.input, expectedVersion } }), {
      kind: 'conflict', currentTrade: toTradeResponse(current),
    });
    assert.deepEqual(h.calls, ['begin', 'update', 'read', 'commit']);
  });
}

for (const current of [{ ...trade, version: 4 }, cancelled]) {
  test(`a concurrent ${current.status === 'CANCELLED' ? 'cancellation' : 'amendment'} wins without another cancellation event`, async () => {
    const h = setup({ updated: null, current });
    assert.deepEqual(await h.repository.cancel(command), {
      kind: 'conflict', currentTrade: toTradeResponse(current),
    });
    assert.equal(h.updates.length, 1);
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.audits, []);
  });
}

test('a trade removed before the conditional update returns not-found without an event', async () => {
  const h = setup({ updated: null, current: null });
  assert.deepEqual(await h.repository.cancel(command), { kind: 'not-found' });
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.audits, []);
});

for (const failAt of ['update', 'lookup', 'audit', 'outbox'] as const) {
  test(`${failAt} failure escapes the transaction instead of returning cancellation success`, async () => {
    const h = setup({ failAt, updated: failAt === 'lookup' ? null : cancelled });
    await assert.rejects(h.repository.cancel(command), (error) => error === h.failure);
    const steps = failAt === 'update' ? ['update']
      : failAt === 'lookup' ? ['update', 'read']
      : failAt === 'audit' ? ['update', 'audit'] : ['update', 'audit', 'outbox'];
    assert.deepEqual(h.calls, ['begin', ...steps, 'rollback']);
    assert.equal(h.calls.includes('commit'), false);
    if (failAt === 'update' || failAt === 'lookup') assert.deepEqual(h.audits, []);
    if (failAt !== 'outbox') assert.deepEqual(h.events, []);
  });
}
