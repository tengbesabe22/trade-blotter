import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@trade-blotter/database';
import { createTradeRepository } from '../../src/trades/trade-repository';
import { toSymbolSummary, type SymbolSummaryRecord } from '../../src/trades/summaries/trade-summary-mapper';

function record(fields: Partial<SymbolSummaryRecord> = {}): SymbolSummaryRecord {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05',
    instrument: { symbol: 'AAPL', currency: 'USD' },
    buyQuantity: new Prisma.Decimal('100'), sellQuantity: new Prisma.Decimal('30'),
    buyValue: new Prisma.Decimal('22745'), sellValue: new Prisma.Decimal('6900'),
    version: 3, updatedAt: new Date('2026-11-15T00:00:00.000Z'),
    ...fields,
  };
}

function setup(rows: SymbolSummaryRecord[], fail = false) {
  const reads: Prisma.SymbolSummaryFindManyArgs[] = [];
  const fake = {
    symbolSummary: { findMany: async (args: Prisma.SymbolSummaryFindManyArgs) => {
      reads.push(args);
      if (fail) throw new Error('Database unavailable.');
      return rows;
    } },
    trade: { findMany: async () => { throw new Error('Read stored summaries instead of scanning trades.'); } },
    $transaction: async () => { throw new Error('A summary read needs no multi-query transaction.'); },
  };
  const database = fake as unknown as Parameters<typeof createTradeRepository>[0];
  return { repository: createTradeRepository(database), reads };
}

test('summary mapper returns public identity, exact amounts and the stored revision/time', () => {
  assert.deepEqual(toSymbolSummary(record()), {
    instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: 'AAPL', currency: 'USD',
    buyQuantity: '100.000000', sellQuantity: '30.000000', netQuantity: '70.000000',
    buyValue: '22745.0000000000', sellValue: '6900.0000000000',
    version: 3, updatedAt: '2026-11-15T00:00:00.000Z',
  });
});

test('net quantity supports short and flat positions without changing the source amounts', () => {
  const row = record({ buyQuantity: new Prisma.Decimal(20), sellQuantity: new Prisma.Decimal(50) });
  assert.equal(toSymbolSummary(row).netQuantity, '-30.000000');
  assert.equal(row.buyQuantity.toString(), '20');
  assert.equal(row.sellQuantity.toString(), '50');
  assert.equal(toSymbolSummary(record({ sellQuantity: new Prisma.Decimal(100) })).netQuantity, '0.000000');
});

test('mapper keeps zero-valued version-zero rows for instruments without executions', () => {
  const result = toSymbolSummary(record({
    buyQuantity: new Prisma.Decimal(0), sellQuantity: new Prisma.Decimal(0),
    buyValue: new Prisma.Decimal(0), sellValue: new Prisma.Decimal(0), version: 0,
  }));
  assert.equal(result.netQuantity, '0.000000');
  assert.equal(result.buyValue, '0.0000000000');
  assert.equal(result.sellValue, '0.0000000000');
  assert.equal(result.version, 0);
});

test('net subtraction preserves all aggregate digits without changing global Decimal precision', () => {
  const precision = Prisma.Decimal.precision;
  const large = new Prisma.Decimal('9999999999999999999999.999999');
  const small = new Prisma.Decimal('0.000001');
  const row = record({
    buyQuantity: large, sellQuantity: small,
    buyValue: new Prisma.Decimal('9999999999999999999999999999.9999999999'),
    sellValue: new Prisma.Decimal('0.0000000001'),
  });
  const result = toSymbolSummary(row);
  assert.equal(result.buyQuantity, '9999999999999999999999.999999');
  assert.equal(result.netQuantity, '9999999999999999999999.999998');
  assert.equal(result.buyValue, '9999999999999999999999999999.9999999999');
  assert.equal(result.sellValue, '0.0000000001');
  assert.equal(toSymbolSummary({ ...row, buyQuantity: small, sellQuantity: large }).netQuantity,
    '-9999999999999999999999.999998');
  assert.equal(toSymbolSummary({ ...row, sellQuantity: large }).netQuantity, '0.000000');
  assert.equal(Prisma.Decimal.precision, precision);
});

test('invalid stored summaries fail instead of returning a misleading public payload', () => {
  for (const row of [
    record({ buyQuantity: new Prisma.Decimal(-1) }),
    record({ sellValue: new Prisma.Decimal('NaN') }),
    record({ instrument: { symbol: 'AAPL', currency: 'EUR' } }),
    record({ version: -1 }),
  ]) assert.throws(() => toSymbolSummary(row));
});

test('repository reads the complete desk summary with instrument identity, ordered by symbol', async () => {
  const rows = [record(), record({
    instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d06',
    instrument: { symbol: 'MSFT', currency: 'USD' },
  })];
  const h = setup(rows);
  const result = await h.repository.listSummaries();
  assert.deepEqual(result, rows.map(toSymbolSummary));
  assert.deepEqual(result.map((row) => row.symbol), ['AAPL', 'MSFT']);
  assert.deepEqual(h.reads, [{
    orderBy: { instrument: { symbol: 'asc' } },
    include: { instrument: { select: { symbol: true, currency: true } } },
  }]);
});

test('repository returns an empty list when no summary rows exist', async () => {
  assert.deepEqual(await setup([]).repository.listSummaries(), []);
});

test('repository does not truncate the summary to a trade-page size', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => record({
    instrumentId: `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    instrument: { symbol: `S${index}`, currency: 'USD' },
  }));
  assert.equal((await setup(rows).repository.listSummaries()).length, 101);
});

test('summary read failures propagate to the caller', async () => {
  await assert.rejects(setup([], true).repository.listSummaries(), /Database unavailable/);
});

test('repository propagates invalid stored data rather than omitting the affected symbol', async () => {
  const h = setup([record({ buyValue: new Prisma.Decimal(-1) })]);
  await assert.rejects(h.repository.listSummaries());
});
