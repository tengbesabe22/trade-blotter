import assert from 'node:assert/strict';
import test from 'node:test';
import {
  symbolSummarySchema,
  tradeSummaryResponseSchema,
} from '../src/trades/summaries/trade-summary-contract';

const summary = {
  instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: 'AAPL', currency: 'USD',
  buyQuantity: '100.000000', sellQuantity: '30.000000', netQuantity: '70.000000',
  buyValue: '22745.0000000000', sellValue: '6900.0000000000',
  version: 3, updatedAt: '2026-11-15T00:00:00.000Z',
};
const response = { schemaVersion: 1, generatedAt: '2026-11-15T00:01:00.000Z', summaries: [summary] };

test('summary responses preserve desk-wide totals and exact decimal strings', () => {
  assert.deepEqual(tradeSummaryResponseSchema.parse(response), response);
});

test('positions permit long, short, flat and zero-valued initial rows', () => {
  for (const row of [
    summary,
    { ...summary, buyQuantity: '20.000000', sellQuantity: '50.000000', netQuantity: '-30.000000' },
    { ...summary, buyQuantity: '40.000000', sellQuantity: '40.000000', netQuantity: '0.000000' },
    { ...summary, buyQuantity: '0.000000', sellQuantity: '0.000000', netQuantity: '0.000000',
      buyValue: '0.0000000000', sellValue: '0.0000000000', version: 0 },
  ]) assert.deepEqual(symbolSummarySchema.parse(row), row);
});

test('aggregate quantities and values can exceed individual trade limits without losing precision', () => {
  const row = {
    ...summary, buyQuantity: '9999999999999999999999.999999', sellQuantity: '0.000000',
    netQuantity: '9999999999999999999999.999999',
    buyValue: '9999999999999999999999999999.0000000000', sellValue: '0.0000000000',
  };
  assert.deepEqual(symbolSummarySchema.parse(row), row);
  const smallest = { ...summary, buyQuantity: '0.000001', sellQuantity: '0.000000', netQuantity: '0.000001',
    buyValue: '0.0000000001', sellValue: '0.0000000000' };
  assert.deepEqual(symbolSummarySchema.parse(smallest), smallest);
});

test('bought and sold quantities require nonnegative canonical strings with six decimal places', () => {
  for (const field of ['buyQuantity', 'sellQuantity']) {
    for (const value of [null, 100, '100', '100.00000', '100.0000001', '-1.000000', '01.000000',
      '1e2', 'NaN', 'Infinity', '9'.repeat(23) + '.000000']) {
      assert.equal(symbolSummarySchema.safeParse({ ...summary, [field]: value }).success, false);
    }
  }
});

test('net quantity permits signed six-place strings but rejects negative zero and malformed amounts', () => {
  for (const netQuantity of [null, -30, '-30', '+30.000000', '-0.000000', '01.000000', '1e3',
    '0.0000001', '-' + '9'.repeat(23) + '.000000']) {
    assert.equal(symbolSummarySchema.safeParse({ ...summary, netQuantity }).success, false);
  }
});

test('executed values require nonnegative canonical strings with ten decimal places', () => {
  for (const field of ['buyValue', 'sellValue']) {
    for (const value of [null, 100, '100', '100.000000', '0.00000000001', '-1.0000000000',
      '01.0000000000', '1e3', 'NaN', 'Infinity', '9'.repeat(29) + '.0000000000']) {
      assert.equal(symbolSummarySchema.safeParse({ ...summary, [field]: value }).success, false);
    }
  }
});

test('summary revisions use the nonnegative database integer range', () => {
  assert.equal(symbolSummarySchema.safeParse({ ...summary, version: 2_147_483_647 }).success, true);
  for (const version of [null, '1', -1, 1.5, 2_147_483_648]) {
    assert.equal(symbolSummarySchema.safeParse({ ...summary, version }).success, false);
  }
});

test('summaries require valid instrument identity, normalized ticker, USD and UTC millisecond timestamps', () => {
  for (const changes of [
    { instrumentId: 'not-a-uuid' }, { symbol: 'aapl' }, { symbol: ' AAPL ' },
    { symbol: '' }, { symbol: 'A'.repeat(13) }, { currency: 'EUR' },
    { updatedAt: '2026-11-15' }, { updatedAt: '2026-11-15T00:00:00Z' },
    { updatedAt: '2026-11-15T08:00:00.000+08:00' },
    { traderId: '11111111-1111-4111-8111-111111111111' }, { book: 'EQUITIES_US' },
  ]) assert.equal(symbolSummarySchema.safeParse({ ...summary, ...changes }).success, false);
});

test('the complete summary list permits no instruments or more than 100 instruments without pagination', () => {
  const empty = { ...response, summaries: [] };
  assert.deepEqual(tradeSummaryResponseSchema.parse(empty), empty);
  const summaries = Array.from({ length: 101 }, (_, index) => ({
    ...summary, instrumentId: `a0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, symbol: `S${index}`,
  }));
  const complete = { ...response, summaries };
  assert.deepEqual(tradeSummaryResponseSchema.parse(complete), complete);
});

test('response metadata and instrument keys must be valid and unique', () => {
  for (const value of [
    { ...response, schemaVersion: 2 },
    { ...response, generatedAt: 'invalid' },
    { ...response, summaries: [summary, summary] },
    { ...response, summaries: [summary, { ...summary, instrumentId: summary.instrumentId.toUpperCase() }] },
    { ...response, pageInfo: { limit: 10 } },
    { ...response, scope: { type: 'TRADER' } },
  ]) assert.equal(tradeSummaryResponseSchema.safeParse(value).success, false);
});
