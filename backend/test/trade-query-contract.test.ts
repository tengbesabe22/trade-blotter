import assert from 'node:assert/strict';
import test from 'node:test';
import { tradeListQuerySchema } from '../src/trades/trade-query-contract';

const traderId = 'd197282d-99ca-4260-833a-702f97d1cba1';
const otherTraderId = '14cad115-cfe2-402f-9934-a97657f91162';

const defaults = {
  limit: 100,
  sortBy: 'tradeDate',
  sortDirection: 'desc',
  symbols: [],
  traderIds: [],
  statuses: [],
  sides: [],
  book: null,
  counterparty: null,
  tradeDateFrom: null,
  tradeDateTo: null,
  after: null,
};

// Hono's req.queries() supplies an array for every query parameter.
test('an omitted query produces the bounded first-page defaults', () => {
  assert.deepEqual(tradeListQuerySchema.parse({}), defaults);
});

test('filters normalise casing, selections and UTC bounds without losing their meaning', () => {
  const result = tradeListQuerySchema.parse({
    limit: ['50'],
    sortBy: ['price'],
    sortDirection: ['asc'],
    symbol: [' msft ', 'aapl', 'MSFT'],
    traderId: [traderId.toUpperCase(), otherTraderId, traderId],
    status: ['CANCELLED'],
    side: ['SELL'],
    book: [' EQUITIES_US '],
    counterparty: [' Goldman Sachs '],
    tradeDateFrom: ['2026-11-13T09:00:00+08:00'],
    tradeDateTo: ['2026-11-13T10:00:00+08:00'],
  });

  assert.deepEqual(result, {
    ...defaults,
    limit: 50,
    sortBy: 'price',
    sortDirection: 'asc',
    symbols: ['AAPL', 'MSFT'],
    traderIds: [otherTraderId, traderId],
    statuses: ['CANCELLED'],
    sides: ['SELL'],
    book: 'equities_us',
    counterparty: 'goldman sachs',
    tradeDateFrom: '2026-11-13T01:00:00.000Z',
    tradeDateTo: '2026-11-13T02:00:00.000Z',
  });
});

test('duplicate selections collapse and selecting every enum option means no filter', () => {
  assert.deepEqual(tradeListQuerySchema.parse({
    status: ['ACTIVE', 'ACTIVE'],
    side: ['SELL', 'SELL'],
  }), { ...defaults, statuses: ['ACTIVE'], sides: ['SELL'] });

  assert.deepEqual(tradeListQuerySchema.parse({
    status: ['CANCELLED', 'ACTIVE', 'ACTIVE'],
    side: ['SELL', 'BUY'],
  }), defaults);
});

test('blank metadata filters are omitted and literal search characters stay intact', () => {
  assert.deepEqual(tradeListQuerySchema.parse({
    book: ['   '], counterparty: [''],
  }), defaults);

  assert.deepEqual(tradeListQuerySchema.parse({
    book: [' EQUITIES_% '], counterparty: [' ACME\\_% '],
  }), { ...defaults, book: 'equities_%', counterparty: 'acme\\_%' });
});

test('both page-limit boundaries are accepted without clamping', () => {
  for (const limit of [1, 200]) {
    assert.deepEqual(tradeListQuerySchema.parse({ limit: [String(limit)] }), {
      ...defaults, limit,
    });
  }
});

test('the declared sort fields accept either direction', () => {
  for (const sortBy of ['tradeDate', 'symbol', 'trader', 'quantity', 'price', 'status']) {
    for (const sortDirection of ['asc', 'desc']) {
      assert.deepEqual(tradeListQuerySchema.parse({
        sortBy: [sortBy], sortDirection: [sortDirection],
      }), { ...defaults, sortBy, sortDirection });
    }
  }
});

test('after preserves the opaque forward cursor', () => {
  assert.deepEqual(tradeListQuerySchema.parse({ after: ['opaque-cursor'] }), {
    ...defaults, after: 'opaque-cursor',
  });
});

test('a maximum-length cursor is accepted for later content validation', () => {
  const cursor = 'a'.repeat(2048);
  assert.deepEqual(tradeListQuerySchema.parse({ after: [cursor] }), {
    ...defaults, after: cursor,
  });
});

test('a one-sided execution-time range is valid', () => {
  assert.deepEqual(tradeListQuerySchema.parse({
    tradeDateFrom: ['2026-11-13T09:00:00Z'],
  }), { ...defaults, tradeDateFrom: '2026-11-13T09:00:00.000Z' });

  assert.deepEqual(tradeListQuerySchema.parse({
    tradeDateTo: ['2026-11-14T00:00:00.125Z'],
  }), { ...defaults, tradeDateTo: '2026-11-14T00:00:00.125Z' });
});

test('normalisation leaves the caller-owned parameter arrays unchanged', () => {
  const parameters = { symbol: [' msft ', 'aapl', 'aapl'], book: [' Desk '] };
  const before = structuredClone(parameters);
  tradeListQuerySchema.parse(parameters);
  assert.deepEqual(parameters, before);
});

const invalidQueries = [
  { name: 'zero limit', parameters: { limit: ['0'] } },
  { name: 'over-limit page size', parameters: { limit: ['201'] } },
  { name: 'fractional limit', parameters: { limit: ['1.5'] } },
  { name: 'exponent limit', parameters: { limit: ['1e2'] } },
  { name: 'partially numeric limit', parameters: { limit: ['100rows'] } },
  { name: 'whitespace limit', parameters: { limit: [' 100 '] } },
  { name: 'empty limit', parameters: { limit: [''] } },
  { name: 'unknown sort field', parameters: { sortBy: ['ownerId'] } },
  { name: 'unknown direction', parameters: { sortDirection: ['down'] } },
  { name: 'blank symbol', parameters: { symbol: ['   '] } },
  { name: 'overlong symbol', parameters: { symbol: ['A'.repeat(13)] } },
  { name: 'malformed trader ID', parameters: { traderId: ['JSMITH'] } },
  { name: 'unknown status', parameters: { status: ['PENDING'] } },
  { name: 'unknown side', parameters: { side: ['SHORT'] } },
  { name: 'too many raw selections', parameters: { symbol: Array(21).fill('AAPL') } },
  { name: 'overlong book', parameters: { book: ['A'.repeat(65)] } },
  { name: 'overlong counterparty', parameters: { counterparty: ['A'.repeat(121)] } },
  { name: 'blank cursor', parameters: { after: [''] } },
  { name: 'overlong cursor', parameters: { after: ['a'.repeat(2049)] } },
  { name: 'unsupported before cursor', parameters: { before: ['opaque-cursor'] } },
  { name: 'both cursor directions', parameters: { after: ['a'], before: ['b'] } },
  { name: 'duplicate limit', parameters: { limit: ['10', '20'] } },
  { name: 'duplicate metadata filter', parameters: { book: ['A', 'B'] } },
  { name: 'empty singleton array', parameters: { sortBy: [] } },
  { name: 'unknown parameter', parameters: { ownerId: [traderId] } },
  { name: 'summary-only parameter', parameters: { summaryTraderId: [traderId] } },
  { name: 'invalid calendar date', parameters: { tradeDateFrom: ['2026-02-30T09:00:00Z'] } },
  { name: 'missing timezone', parameters: { tradeDateFrom: ['2026-11-13T09:00:00'] } },
  { name: 'missing seconds', parameters: { tradeDateTo: ['2026-11-13T09:00Z'] } },
  { name: 'sub-millisecond timestamp', parameters: { tradeDateTo: ['2026-11-13T09:00:00.1234Z'] } },
  {
    name: 'reversed date range',
    parameters: { tradeDateFrom: ['2026-11-14T00:00:00Z'], tradeDateTo: ['2026-11-13T00:00:00Z'] },
  },
  {
    name: 'equal instants with different timezone offsets',
    parameters: { tradeDateFrom: ['2026-11-13T09:00:00+08:00'], tradeDateTo: ['2026-11-13T01:00:00Z'] },
  },
];

for (const { name, parameters } of invalidQueries) {
  test(`rejects ${name}`, () => {
    assert.equal(tradeListQuerySchema.safeParse(parameters).success, false);
  });
}
