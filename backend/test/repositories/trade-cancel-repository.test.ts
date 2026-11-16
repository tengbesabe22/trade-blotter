import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@trade-blotter/database';
import { createTradeRepository, type TradeRecord } from '../../src/trades/trade-repository';
import { cancelTradeRequestSchema } from '../../src/trades/cancellations/trade-cancel-contract';
import { toTradeResponse } from '../../src/trades/trade-mapper';

type TradeRecordWithCurrency = TradeRecord & { instrument: { currency: string } };

const trade: TradeRecordWithCurrency = {
  id: 'f1550000-0000-4000-8000-000000100001',
  userId: 'd197282d-99ca-4260-833a-702f97d1cba1',
  instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05',
  instrument: { symbol: 'AAPL', currency: 'USD' }, user: { displayName: 'JSMITH' },
  side: 'BUY', quantity: new Prisma.Decimal('5000'), price: new Prisma.Decimal('227.45'),
  book: 'EQUITIES_US', counterparty: 'Example Bank',
  tradeDate: new Date('2026-08-18T09:15:23Z'), status: 'ACTIVE', version: 3,
  createdAt: new Date('2026-08-18T09:16:00Z'), updatedAt: new Date('2026-08-18T09:16:00Z'),
};
const cancelled: TradeRecordWithCurrency = {
  ...trade, status: 'CANCELLED', version: 4, updatedAt: new Date('2026-11-14T09:00:00Z'),
};
const command = {
  userId: trade.userId, tradeId: trade.id,
  input: cancelTradeRequestSchema.parse({ expectedVersion: 3, reason: 'Duplicate booking.' }),
};

const summaryRow: Prisma.SymbolSummaryGetPayload<{}> = {
  id: 'a0000000-0000-4000-8000-000000000001', instrumentId: trade.instrumentId,
  buyQuantity: new Prisma.Decimal('100'), sellQuantity: new Prisma.Decimal('30'),
  buyValue: new Prisma.Decimal('23000'), sellValue: new Prisma.Decimal('6900'),
  version: 10, updatedAt: new Date('2026-11-15T09:00:02.000Z'),
};
const summarySnapshot = {
  instrumentId: trade.instrumentId, symbol: 'AAPL', currency: 'USD',
  buyQuantity: '100.000000', sellQuantity: '30.000000', netQuantity: '70.000000',
  buyValue: '23000.0000000000', sellValue: '6900.0000000000',
  version: 10, updatedAt: summaryRow.updatedAt.toISOString(),
};

type Options = {
  savedSummary?: typeof summaryRow;
  current?: TradeRecordWithCurrency | null;
  updated?: TradeRecordWithCurrency | null;
  failAt?: 'update' | 'lookup' | 'audit' | 'summary' | 'outbox';
};

function setup(options: Options = {}) {
  const current = options.current === undefined ? trade : options.current;
  const updated = options.updated === undefined ? cancelled : options.updated;
  const calls: string[] = [];
  const updates: Prisma.TradeUpdateManyAndReturnArgs[] = [];
  const events: Prisma.OutboxEventUncheckedCreateInput[] = [];
  const audits: Prisma.TradeAuditUncheckedCreateInput[] = [];
  const summaries: Prisma.SymbolSummaryUpdateArgs[] = [];
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
    symbolSummary: { update: async (input: Prisma.SymbolSummaryUpdateArgs) => {
      calls.push('summary');
      summaries.push(input);
      if (options.failAt === 'summary') throw failure;
      return options.savedSummary ?? summaryRow;
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
  return { repository: createTradeRepository(database), calls, updates, events, audits, summaries, failure };
}

test('cancel returns the guarded update directly and saves its audit/summary/event without reading the trade again', async () => {
  const h = setup();
  const response = toTradeResponse(cancelled);
  assert.deepEqual(await h.repository.cancel(command), { kind: 'cancelled', body: { trade: response } });
  assert.deepEqual(h.updates, [{
    where: { id: trade.id, userId: trade.userId, status: 'ACTIVE', version: 3 },
    data: { status: 'CANCELLED', version: { increment: 1 } },
    include: {
      instrument: { select: { symbol: true, currency: true } },
      user: { select: { displayName: true } },
    },
  }]);
  assert.deepEqual(h.audits, [{
    tradeId: trade.id, tradeVersion: 4, action: 'CANCELLED', actorId: command.userId,
    reason: 'Duplicate booking.', snapshot: response,
  }]);
  assert.deepEqual(h.events, [{
    type: 'TRADE_CANCELLED', actorId: trade.userId, tradeId: trade.id, tradeVersion: 4,
    payload: { trade: response, reason: 'Duplicate booking.', summaries: [summarySnapshot] },
  }]);
  assert.deepEqual(h.calls, ['begin', 'update', 'audit', 'summary', 'outbox', 'commit']);
});

test('cancel retains null when no reason was supplied', async () => {
  const h = setup();
  await h.repository.cancel({ ...command, input: cancelTradeRequestSchema.parse({ expectedVersion: 3 }) });
  assert.equal(h.audits[0]?.reason, null);
  assert.deepEqual(h.events[0]?.payload, { trade: toTradeResponse(cancelled), reason: null, summaries: [summarySnapshot] });
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
    assert.deepEqual(h.summaries, []);
  });
}

test('a trade removed before the conditional update returns not-found without an event', async () => {
  const h = setup({ updated: null, current: null });
  assert.deepEqual(await h.repository.cancel(command), { kind: 'not-found' });
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.audits, []);
});

for (const failAt of ['update', 'lookup', 'audit', 'summary', 'outbox'] as const) {
  test(`${failAt} failure escapes the transaction instead of returning cancellation success`, async () => {
    const h = setup({ failAt, updated: failAt === 'lookup' ? null : cancelled });
    await assert.rejects(h.repository.cancel(command), (error) => error === h.failure);
    const steps = failAt === 'update' ? ['update']
      : failAt === 'lookup' ? ['update', 'read']
      : failAt === 'audit' ? ['update', 'audit']
      : failAt === 'summary' ? ['update', 'audit', 'summary'] : ['update', 'audit', 'summary', 'outbox'];
    assert.deepEqual(h.calls, ['begin', ...steps, 'rollback']);
    assert.equal(h.calls.includes('commit'), false);
    if (failAt === 'update' || failAt === 'lookup') assert.deepEqual(h.audits, []);
    if (failAt === 'update' || failAt === 'lookup' || failAt === 'audit') assert.deepEqual(h.summaries, []);
    if (failAt !== 'outbox') assert.deepEqual(h.events, []);
  });
}


test('cancellation subtracts the full BUY contribution and retains the summary row/version', async () => {
  const h = setup();
  await h.repository.cancel(command);
  assert.deepEqual(JSON.parse(JSON.stringify(h.summaries)), [{
    where: { instrumentId: trade.instrumentId },
    data: {
      buyQuantity: { increment: '-5000' }, sellQuantity: { increment: '0' },
      buyValue: { increment: '-1137250' }, sellValue: { increment: '0' }, version: { increment: 1 },
    },
  }]);
  assert.equal(h.calls.includes('read'), false);
});

test('cancelling a SELL removes only sold quantity and value', async () => {
  const h = setup({ updated: { ...cancelled, side: 'SELL' } });
  await h.repository.cancel(command);
  const summary = JSON.parse(JSON.stringify(h.summaries[0]));
  assert.deepEqual(summary.data, {
    buyQuantity: { increment: '0' }, sellQuantity: { increment: '-5000' },
    buyValue: { increment: '0' }, sellValue: { increment: '-1137250' }, version: { increment: 1 },
  });
});

test('cancellation preserves every digit when removing a large fractional trade', async () => {
  const h = setup({ updated: { ...cancelled, quantity: new Prisma.Decimal('999999999.999999'), price: new Prisma.Decimal('999999.9999') } });
  await h.repository.cancel(command);
  const summary = JSON.parse(JSON.stringify(h.summaries[0]));
  assert.equal(summary.data.buyQuantity.increment, '-999999999.999999');
  assert.equal(summary.data.buyValue.increment, '-999999999899999.0000000001');
});


test('cancelling the last execution saves a retained zero summary with its resulting version and time', async () => {
  const h = setup({ savedSummary: {
    ...summaryRow, buyQuantity: new Prisma.Decimal(0), sellQuantity: new Prisma.Decimal(0),
    buyValue: new Prisma.Decimal(0), sellValue: new Prisma.Decimal(0), version: 11,
  } });
  await h.repository.cancel(command);
  assert.deepEqual(h.events[0]?.payload, {
    trade: toTradeResponse(cancelled), reason: command.input.reason,
    summaries: [{
      ...summarySnapshot, buyQuantity: '0.000000', sellQuantity: '0.000000', netQuantity: '0.000000',
      buyValue: '0.0000000000', sellValue: '0.0000000000', version: 11,
    }],
  });
  assert.equal(h.calls.includes('read'), false);
});

test('an invalid returned cancellation summary aborts before writing the outbox', async () => {
  const h = setup({ savedSummary: { ...summaryRow, buyQuantity: new Prisma.Decimal(-1) } });
  await assert.rejects(h.repository.cancel(command), { name: 'ZodError' });
  assert.deepEqual(h.calls, ['begin', 'update', 'audit', 'summary', 'rollback']);
  assert.deepEqual(h.events, []);
});
