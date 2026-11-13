import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@trade-blotter/database';
import { createTradeRepository, type TradeRecord } from '../src/trades/trade-repository';
import { tradeListQuerySchema } from '../src/trades/listing/trade-query-contract';
import { decodeTradeCursor, encodeTradeCursor } from '../src/trades/listing/trade-cursor';

function record(index: number): TradeRecord {
  return {
    id: `f1550000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    userId: 'd197282d-99ca-4260-833a-702f97d1cba1',
    instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05',
    instrument: { symbol: 'AAPL' }, user: { displayName: 'JSMITH' },
    quantity: new Prisma.Decimal('5000'), price: new Prisma.Decimal('227.45'),
    side: 'BUY', status: 'ACTIVE', version: 1, book: null, counterparty: null,
    tradeDate: new Date('2026-11-13T09:00:00Z'),
    createdAt: new Date('2026-11-13T09:00:00Z'), updatedAt: new Date('2026-11-13T09:00:00Z'),
  };
}

function setup(rows: TradeRecord[]) {
  const reads: Prisma.TradeFindManyArgs[] = [];
  const fake = {
    trade: {
      findMany: async (args: Prisma.TradeFindManyArgs) => { reads.push(args); return rows; },
      findFirst: async () => { throw new Error('Listing must not probe the opposite direction.'); },
    },
    $transaction: async () => { throw new Error('Listing must not open a transaction.'); },
  };
  const database = fake as unknown as Parameters<typeof createTradeRepository>[0];
  return { repository: createTradeRepository(database), reads };
}

const firstQuery = tradeListQuerySchema.parse({ limit: ['2'] });

test('first page loads only limit plus one, preserves ID ties and removes the lookahead row', async () => {
  const rows = [record(3), record(2), record(1)];
  const h = setup(rows);
  const result = await h.repository.list(firstQuery, null);

  assert.deepEqual(result, { records: rows.slice(0, 2), hasNextPage: true });
  assert.equal(h.reads[0]?.take, 3);
  assert.deepEqual(h.reads[0]?.orderBy, [{ tradeDate: 'desc' }, { id: 'desc' }]);
  assert.equal(h.reads.length, 1);
});

test('a short first page has no next page and an empty first page has no navigation', async () => {
  for (const rows of [[], [record(1)]]) {
    const h = setup(rows);
    assert.deepEqual(await h.repository.list(firstQuery, null), {
      records: rows, hasNextPage: false,
    });
  }
});

test('the maximum page limit still bounds the query to 201 records', async () => {
  const h = setup([]);
  await h.repository.list(tradeListQuerySchema.parse({ limit: ['200'] }), null);
  assert.equal(h.reads[0]?.take, 201);
});

for (const sortDirection of ['asc', 'desc'] as const) {
  test(`continuation keeps ${sortDirection} ordering and uses one forward read`, async () => {
    const rows = sortDirection === 'asc'
      ? [record(1), record(2), record(3)]
      : [record(3), record(2), record(1)];
    const h = setup(rows);
    const query = { ...firstQuery, sortDirection };
    const boundary = { sortBy: 'tradeDate' as const, value: rows[0]!.tradeDate.toISOString(), id: record(9).id };
    const requested = { ...query, after: encodeTradeCursor(query, boundary) };
    const result = await h.repository.list(requested, decodeTradeCursor(requested));
    const comparison = sortDirection === 'asc' ? 'gt' : 'lt';

    assert.equal(h.reads.length, 1);
    assert.deepEqual(h.reads[0]?.orderBy, [{ tradeDate: sortDirection }, { id: sortDirection }]);
    assert.deepEqual(h.reads[0]?.where, { AND: [{}, { OR: [
      { tradeDate: { [comparison]: rows[0]!.tradeDate } },
      { AND: [{ tradeDate: { equals: rows[0]!.tradeDate } }, { id: { [comparison]: boundary.id } }] },
    ] }] });
    assert.deepEqual(result, { records: rows.slice(0, 2), hasNextPage: true });
  });
}

test('an empty continuation remains a single bounded read', async () => {
  const h = setup([]);
  const boundary = { sortBy: 'tradeDate' as const, value: record(9).tradeDate.toISOString(), id: record(9).id };
  const query = { ...firstQuery, after: encodeTradeCursor(firstQuery, boundary) };
  assert.deepEqual(await h.repository.list(query, boundary), { records: [], hasNextPage: false });
  assert.equal(h.reads.length, 1);
  assert.equal(h.reads[0]?.take, 3);
});

test('filters combine exact selections, literal insensitive metadata and half-open UTC dates', async () => {
  const h = setup([]);
  const query = tradeListQuerySchema.parse({
    symbol: ['aapl', 'MSFT'], traderId: [record(1).userId], status: ['ACTIVE'], side: ['BUY'],
    book: ['desk_%'], counterparty: ['ACME\\_%'],
    tradeDateFrom: ['2026-11-13T09:00:00+08:00'], tradeDateTo: ['2026-11-14T09:00:00+08:00'],
  });
  await h.repository.list(query, null);

  assert.deepEqual(h.reads[0]?.where, {
    instrument: { symbol: { in: ['AAPL', 'MSFT'] } },
    userId: { in: [record(1).userId] }, status: { in: ['ACTIVE'] }, side: { in: ['BUY'] },
    book: { contains: 'desk\\_\\%', mode: 'insensitive' },
    counterparty: { contains: 'acme\\\\\\_\\%', mode: 'insensitive' },
    tradeDate: { gte: new Date('2026-11-13T01:00:00Z'), lt: new Date('2026-11-14T01:00:00Z') },
  });
});

for (const [sortBy, value, field, expectedOrder] of [
  ['symbol', 'AAPL', { instrument: { symbol: { lt: 'AAPL' } } }, { instrument: { symbol: 'desc' } }],
  ['trader', 'JSMITH', { user: { displayName: { lt: 'JSMITH' } } }, { user: { displayName: 'desc' } }],
  ['quantity', '999999999.999999', { quantity: { lt: '999999999.999999' } }, { quantity: 'desc' }],
  ['price', '227.4501', { price: { lt: '227.4501' } }, { price: 'desc' }],
  ['status', 'CANCELLED', { status: { in: ['ACTIVE'] } }, { status: 'desc' }],
] as const) {
  test(`${sortBy} sort uses its database field and exact typed boundary`, async () => {
    const h = setup([]);
    const query = tradeListQuerySchema.parse({ sortBy: [sortBy] });
    const boundary = { sortBy, value, id: record(1).id } as Parameters<typeof encodeTradeCursor>[1];
    const request = { ...query, after: encodeTradeCursor(query, boundary) };
    await h.repository.list(request, boundary);
    assert.deepEqual(h.reads[0]?.orderBy, [expectedOrder, { id: 'desc' }]);
    const where = h.reads[0]?.where as { AND: [unknown, { OR: unknown[] }] };
    assert.deepEqual(where.AND[1].OR[0], field);
  });
}
