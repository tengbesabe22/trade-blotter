import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@trade-blotter/database';
import { createTradeRepository, type TradeRecord } from '../../src/trades/trade-repository';
import { toTradeResponse } from '../../src/trades/trade-mapper';
import type { CreateTradeCommand, CreateTradeResult } from '../../src/trades/creation/trade-create-contract';

const command: CreateTradeCommand = {
  userId: 'd197282d-99ca-4260-833a-702f97d1cba1',
  idempotencyKey: 'create-trade-001',
  requestFingerprint: 'a'.repeat(64),
  input: {
    symbol: 'AAPL', side: 'BUY', quantity: '5000.000000', price: '227.4500',
    tradeDate: '2026-08-18T09:15:23.000Z', book: null, counterparty: null,
  },
};

const trade: TradeRecord = {
  id: 'f1550000-0000-4000-8000-000000100001',
  userId: command.userId,
  instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05',
  instrument: { symbol: 'AAPL' },
  user: { displayName: 'JSMITH' },
  side: 'BUY', quantity: new Prisma.Decimal('5000'), price: new Prisma.Decimal('227.45'),
  tradeDate: new Date(command.input.tradeDate), book: null, counterparty: null,
  status: 'ACTIVE', version: 1,
  createdAt: new Date('2026-08-18T09:16:00Z'), updatedAt: new Date('2026-08-18T09:16:00Z'),
};

const summaryRow: Prisma.SymbolSummaryGetPayload<{}> = {
  id: 'a0000000-0000-4000-8000-000000000001', instrumentId: trade.instrumentId,
  buyQuantity: new Prisma.Decimal('5000'), sellQuantity: new Prisma.Decimal('0'),
  buyValue: new Prisma.Decimal('1137250'), sellValue: new Prisma.Decimal('0'),
  version: 1, updatedAt: new Date('2026-08-18T09:16:00.000Z'),
};
const summarySnapshot = {
  instrumentId: trade.instrumentId, symbol: 'AAPL', currency: 'USD',
  buyQuantity: '5000.000000', sellQuantity: '0.000000', netQuantity: '5000.000000',
  buyValue: '1137250.0000000000', sellValue: '0.0000000000',
  version: 1, updatedAt: summaryRow.updatedAt.toISOString(),
};
const responseBody = { trade: toTradeResponse(trade) };
const savedRequest = { requestFingerprint: command.requestFingerprint, responseBody };

type SavedRequest = { requestFingerprint: string; responseBody: Prisma.JsonValue };
type KeyLookup = { where: { userId_key: { userId: string; key: string } } };
type FailurePoint = 'trade' | 'audit' | 'summary' | 'outbox' | 'idempotency';

type FixtureOptions = {
  createdTrade?: TradeRecord;
  savedSummary?: typeof summaryRow;
  existing?: SavedRequest;
  winner?: SavedRequest;
  unknownInstrument?: boolean;
  failAt?: FailurePoint;
  failure?: Error;
};

function uniqueConflict(index = 'IdempotencyRequest_userId_key_key') {
  // This is the error metadata emitted by our pinned Prisma 7 adapter-pg runtime.
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed.', {
    code: 'P2002', clientVersion: '7.10.1',
    meta: { driverAdapterError: { cause: {
      kind: 'UniqueConstraintViolation', constraint: { index },
    } } },
  });
}

function setup(options: FixtureOptions = {}) {
  const calls: string[] = [];
  const lookups: KeyLookup[] = [];
  const reads = { instrument: 0 };
  const writes: {
    trade?: Prisma.TradeUncheckedCreateInput;
    audit?: Prisma.TradeAuditUncheckedCreateInput;
    summary?: Prisma.SymbolSummaryUpsertArgs;
    outbox?: Prisma.OutboxEventUncheckedCreateInput;
    idempotency?: Prisma.IdempotencyRequestUncheckedCreateInput;
  } = {};
  const failure = options.failure ?? new Error('Database write failed.');

  const tx = {
    idempotencyRequest: {
      findUnique: async (query: KeyLookup) => {
        calls.push('tx.lookup');
        lookups.push(query);
        return options.existing ?? null;
      },
      create: async ({ data }: { data: Prisma.IdempotencyRequestUncheckedCreateInput }) => {
        calls.push('tx.idempotency');
        writes.idempotency = data;
        if (options.failAt === 'idempotency') throw failure;
      },
    },
    instrument: { findUnique: async () => {
      calls.push('tx.instrument');
      reads.instrument += 1;
      return options.unknownInstrument ? null : { id: trade.instrumentId, symbol: 'AAPL', currency: 'USD' };
    } },
    trade: { create: async ({ data, include }: {
      data: Prisma.TradeUncheckedCreateInput;
      include?: Prisma.TradeInclude;
    }) => {
      calls.push('tx.trade');
      writes.trade = data;
      if (options.failAt === 'trade') throw failure;

      const { instrument, ...createdTrade } = options.createdTrade ?? trade;
      if (include?.instrument) {
        reads.instrument += 1;
        return { ...createdTrade, instrument };
      }

      return createdTrade;
    } },
    tradeAudit: { create: async ({ data }: { data: Prisma.TradeAuditUncheckedCreateInput }) => {
      calls.push('tx.audit');
      writes.audit = data;
      if (options.failAt === 'audit') throw failure;
    } },
    symbolSummary: { upsert: async (input: Prisma.SymbolSummaryUpsertArgs) => {
      calls.push('tx.summary');
      writes.summary = input;
      if (options.failAt === 'summary') throw failure;
      return options.savedSummary ?? summaryRow;
    } },
    outboxEvent: { create: async ({ data }: { data: Prisma.OutboxEventUncheckedCreateInput }) => {
      calls.push('tx.outbox');
      writes.outbox = data;
      if (options.failAt === 'outbox') throw failure;
    } },
  };

  const fakeDatabase = {
    $transaction: async (work: (client: typeof tx) => Promise<CreateTradeResult>) => {
      calls.push('begin');
      try {
        const result = await work(tx);
        calls.push('commit');
        return result;
      } catch (error) {
        calls.push('rollback');
        throw error;
      }
    },
    idempotencyRequest: { findUnique: async (query: KeyLookup) => {
      calls.push('outside.lookup');
      lookups.push(query);
      return options.winner ?? null;
    } },
  };

  // Prisma delegates are generic; keep the structural fake cast at this one test boundary.
  const database = fakeDatabase as unknown as Parameters<typeof createTradeRepository>[0];
  return { repository: createTradeRepository(database), calls, lookups, writes, failure, reads };
}

test('create saves the trade, audit, symbol summary, outbox and original 201 result in one transaction', async () => {
  const h = setup();

  assert.deepEqual(await h.repository.create(command), { kind: 'created', body: responseBody });
  assert.deepEqual(h.calls, [
    'begin', 'tx.lookup', 'tx.instrument', 'tx.trade', 'tx.audit', 'tx.summary', 'tx.outbox', 'tx.idempotency', 'commit',
  ]);
  assert.deepEqual(h.lookups[0], {
    where: { userId_key: { userId: command.userId, key: command.idempotencyKey } },
  });
  assert.deepEqual(h.writes.trade, {
    userId: command.userId, instrumentId: trade.instrumentId, side: 'BUY',
    quantity: command.input.quantity, price: command.input.price,
    tradeDate: new Date(command.input.tradeDate), book: null, counterparty: null,
  });
  assert.deepEqual(h.writes.audit, {
    tradeId: trade.id, tradeVersion: 1, action: 'CREATED',
    actorId: command.userId, reason: null, snapshot: responseBody.trade,
  });
  assert.deepEqual(h.writes.outbox, {
    type: 'TRADE_CREATED', actorId: command.userId, tradeId: trade.id,
    tradeVersion: 1, payload: { trade: responseBody.trade, summaries: [summarySnapshot] },
  });
  assert.deepEqual(h.writes.idempotency, {
    userId: command.userId, key: command.idempotencyKey,
    requestFingerprint: command.requestFingerprint, responseBody, responseStatus: 201,
  });
});

test('creation reuses the catalog symbol with only one instrument load', async () => {
  const h = setup();

  assert.deepEqual(await h.repository.create(command), { kind: 'created', body: responseBody });
  assert.equal(h.reads.instrument, 1);
});

test('replay returns the saved response before catalog lookup and performs no writes', async () => {
  const h = setup({ existing: savedRequest, unknownInstrument: true });

  assert.deepEqual(await h.repository.create(command), { kind: 'replayed', body: responseBody });
  assert.deepEqual(h.calls, ['begin', 'tx.lookup', 'commit']);
  assert.deepEqual(h.writes, {});
});

test('a reused key with another fingerprint returns conflict without writes', async () => {
  const h = setup({ existing: { ...savedRequest, requestFingerprint: 'b'.repeat(64) } });

  assert.deepEqual(await h.repository.create(command), { kind: 'idempotency-conflict' });
  assert.deepEqual(h.calls, ['begin', 'tx.lookup', 'commit']);
});

test('unknown instruments create no trade, audit, event or completed idempotency result', async () => {
  const h = setup({ unknownInstrument: true });

  assert.deepEqual(await h.repository.create(command), { kind: 'unknown-instrument' });
  assert.deepEqual(h.calls, ['begin', 'tx.lookup', 'tx.instrument', 'commit']);
  assert.deepEqual(h.writes, {});
});

test('malformed saved response JSON propagates a validation error', async () => {
  const h = setup({ existing: { ...savedRequest, responseBody: { trade: {} } } });

  await assert.rejects(h.repository.create(command), { name: 'ZodError' });
  assert.deepEqual(h.calls, ['begin', 'tx.lookup', 'rollback']);
});

for (const failAt of ['trade', 'audit', 'summary', 'outbox', 'idempotency'] as const) {
  test(`${failAt} failure escapes the transaction and prevents a successful result`, async () => {
    const h = setup({ failAt });

    await assert.rejects(h.repository.create(command), (error) => error === h.failure);
    assert.equal(h.calls.at(-1), 'rollback');
    assert.equal(h.calls.includes('commit'), false);
    assert.equal(h.calls.includes('outside.lookup'), false);
    if (failAt === 'trade') assert.equal(h.writes.audit, undefined);
    if (failAt === 'trade' || failAt === 'audit') assert.equal(h.writes.summary, undefined);
    if (failAt === 'trade' || failAt === 'audit' || failAt === 'summary') assert.equal(h.writes.outbox, undefined);
    if (failAt !== 'idempotency') assert.equal(h.writes.idempotency, undefined);
  });
}

for (const sameFingerprint of [true, false]) {
  test(`a concurrent key winner produces ${sameFingerprint ? 'replay' : 'conflict'} after rollback`, async () => {
    const h = setup({
      failAt: 'idempotency', failure: uniqueConflict(),
      winner: { ...savedRequest, requestFingerprint: sameFingerprint ? command.requestFingerprint : 'b'.repeat(64) },
    });

    assert.deepEqual(await h.repository.create(command), sameFingerprint
      ? { kind: 'replayed', body: responseBody }
      : { kind: 'idempotency-conflict' });
    assert.deepEqual(h.calls.slice(-2), ['rollback', 'outside.lookup']);
    assert.equal(h.calls.filter((call) => call === 'tx.audit').length, 1);
    assert.equal(h.calls.filter((call) => call === 'tx.summary').length, 1);
    assert.equal(h.calls.includes('commit'), false);
    assert.deepEqual(h.lookups[0], h.lookups[1]);
  });
}

test('an unrelated unique violation propagates even if another saved request exists', async () => {
  const failure = uniqueConflict('OutboxEvent_tradeId_tradeVersion_key');
  const h = setup({ failAt: 'outbox', failure, winner: savedRequest });

  await assert.rejects(h.repository.create(command), (error) => error === failure);
  assert.equal(h.calls.includes('outside.lookup'), false);
});

test('a key conflict without a committed winner propagates the original error', async () => {
  const failure = uniqueConflict();
  const h = setup({ failAt: 'idempotency', failure });

  await assert.rejects(h.repository.create(command), (error) => error === failure);
  assert.deepEqual(h.calls.slice(-2), ['rollback', 'outside.lookup']);
});


test('an audit version uniqueness error is not treated as an idempotent replay', async () => {
  const failure = uniqueConflict('TradeAudit_tradeId_tradeVersion_key');
  const h = setup({ failAt: 'audit', failure, winner: savedRequest });

  await assert.rejects(h.repository.create(command), (error) => error === failure);
  assert.deepEqual(h.calls, ['begin', 'tx.lookup', 'tx.instrument', 'tx.trade', 'tx.audit', 'rollback']);
  assert.equal(h.writes.outbox, undefined);
  assert.equal(h.writes.idempotency, undefined);
});


test('create initializes a missing BUY summary or increments existing totals/version without overwriting them', async () => {
  const h = setup();
  await h.repository.create(command);
  // Decimal JSON is exact; this also verifies the persistence operation uses increments.
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes.summary)), {
    where: { instrumentId: trade.instrumentId },
    create: {
      instrumentId: trade.instrumentId, buyQuantity: '5000', sellQuantity: '0',
      buyValue: '1137250', sellValue: '0', version: 1,
    },
    update: {
      buyQuantity: { increment: '5000' }, sellQuantity: { increment: '0' },
      buyValue: { increment: '1137250' }, sellValue: { increment: '0' },
      version: { increment: 1 },
    },
  });
});

test('creating a SELL increments only sold quantity/value while preserving buy totals', async () => {
  const createdTrade = { ...trade, side: 'SELL' as const, quantity: new Prisma.Decimal('2.5'), price: new Prisma.Decimal('10.1') };
  const input = { ...command.input, side: 'SELL' as const, quantity: '2.500000', price: '10.1000' };
  const h = setup({ createdTrade, savedSummary: {
    ...summaryRow, buyQuantity: new Prisma.Decimal(0), sellQuantity: new Prisma.Decimal('2.5'),
    buyValue: new Prisma.Decimal(0), sellValue: new Prisma.Decimal('25.25'),
  } });
  assert.deepEqual(await h.repository.create({ ...command, input }), {
    kind: 'created', body: { trade: toTradeResponse(createdTrade) },
  });
  const summary = JSON.parse(JSON.stringify(h.writes.summary));
  assert.deepEqual(summary.create, {
    instrumentId: trade.instrumentId, buyQuantity: '0', sellQuantity: '2.5',
    buyValue: '0', sellValue: '25.25', version: 1,
  });
  assert.deepEqual(summary.update, {
    buyQuantity: { increment: '0' }, sellQuantity: { increment: '2.5' },
    buyValue: { increment: '0' }, sellValue: { increment: '25.25' }, version: { increment: 1 },
  });
  const payload = JSON.parse(JSON.stringify(h.writes.outbox?.payload));
  assert.equal(payload.summaries[0].netQuantity, '-2.500000');
  assert.equal(payload.summaries[0].sellValue, '25.2500000000');
});

test('the summary write retains every digit of a large fractional trade value', async () => {
  const input = { ...command.input, quantity: '999999999.999999', price: '999999.9999' };
  const createdTrade = { ...trade, quantity: new Prisma.Decimal(input.quantity), price: new Prisma.Decimal(input.price) };
  const h = setup({ createdTrade, savedSummary: {
    ...summaryRow, buyQuantity: createdTrade.quantity,
    buyValue: new Prisma.Decimal('999999999899999.0000000001'),
  } });
  await h.repository.create({ ...command, input });
  const summary = JSON.parse(JSON.stringify(h.writes.summary));
  assert.equal(summary.create.buyValue, '999999999899999.0000000001');
  assert.equal(summary.update.buyValue.increment, '999999999899999.0000000001');
  const payload = JSON.parse(JSON.stringify(h.writes.outbox?.payload));
  assert.equal(payload.summaries[0].buyQuantity, '999999999.999999');
  assert.equal(payload.summaries[0].buyValue, '999999999899999.0000000001');
});

test('summary uniqueness failures propagate instead of being mistaken for an idempotent replay', async () => {
  const failure = uniqueConflict('SymbolSummary_instrumentId_key');
  const h = setup({ failAt: 'summary', failure, winner: savedRequest });
  await assert.rejects(h.repository.create(command), (error) => error === failure);
  assert.deepEqual(h.calls, ['begin', 'tx.lookup', 'tx.instrument', 'tx.trade', 'tx.audit', 'tx.summary', 'rollback']);
  assert.equal(h.writes.outbox, undefined);
  assert.equal(h.writes.idempotency, undefined);
});


test('creation captures the returned aggregate totals, independent version and time in the outbox', async () => {
  const savedSummary = {
    ...summaryRow, buyQuantity: new Prisma.Decimal('5100'), sellQuantity: new Prisma.Decimal('30'),
    buyValue: new Prisma.Decimal('1160250'), sellValue: new Prisma.Decimal('6900'),
    version: 9, updatedAt: new Date('2026-08-18T09:16:01.000Z'),
  };
  const h = setup({ savedSummary });
  assert.deepEqual(await h.repository.create(command), { kind: 'created', body: responseBody });
  assert.deepEqual(h.writes.outbox?.payload, {
    trade: responseBody.trade,
    summaries: [{
      ...summarySnapshot, buyQuantity: '5100.000000', sellQuantity: '30.000000', netQuantity: '5070.000000',
      buyValue: '1160250.0000000000', sellValue: '6900.0000000000',
      version: 9, updatedAt: savedSummary.updatedAt.toISOString(),
    }],
  });
  assert.equal(h.reads.instrument, 1);
  assert.deepEqual(h.calls, [
    'begin', 'tx.lookup', 'tx.instrument', 'tx.trade', 'tx.audit', 'tx.summary', 'tx.outbox', 'tx.idempotency', 'commit',
  ]);
});

test('invalid returned summary data aborts creation before saving the outbox or idempotency result', async () => {
  const h = setup({ savedSummary: { ...summaryRow, version: -1 } });
  await assert.rejects(h.repository.create(command), { name: 'ZodError' });
  assert.deepEqual(h.calls, ['begin', 'tx.lookup', 'tx.instrument', 'tx.trade', 'tx.audit', 'tx.summary', 'rollback']);
  assert.equal(h.writes.outbox, undefined);
  assert.equal(h.writes.idempotency, undefined);
});
