import assert from 'node:assert/strict';
import test from 'node:test';
import { tradeChangeSchema } from '../src/trades/sse/trade-stream-contract';

const trade = {
  id: 'f1550000-0000-4000-8000-000000100003',
  symbol: 'AAPL', side: 'BUY', quantity: '100.000000', price: '227.4500',
  trader: 'JSMITH', ownerId: 'd197282d-99ca-4260-833a-702f97d1cba1',
  book: null, counterparty: null, status: 'ACTIVE', version: 1,
  tradeDate: '2026-11-15T09:00:00.000Z',
  createdAt: '2026-11-15T09:00:00.000Z', updatedAt: '2026-11-15T09:00:00.000Z',
};
const summary = {
  instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: 'AAPL', currency: 'USD',
  buyQuantity: '150.000000', sellQuantity: '30.000000', netQuantity: '120.000000',
  buyValue: '34117.5000000000', sellValue: '6900.0000000000',
  version: 9, updatedAt: '2026-11-15T09:00:00.000Z',
};
const change = {
  changeId: 'd197282d-99ca-4260-833a-702f97d1cba2',
  type: 'TRADE_CREATED', occurredAt: '2026-11-15T09:00:00.000Z', trade,
  summaries: [summary],
};

test('events use one shape with the complete trade and absolute symbol summary', () => {
  assert.deepEqual(tradeChangeSchema.parse(change), change);
});

test('amendment and cancellation events use the same resulting-summary contract', () => {
  const amended = { ...change, type: 'TRADE_AMENDED', trade: { ...trade, version: 2 },
    summaries: [{ ...summary, version: 10 }] };
  const cancelled = { ...change, type: 'TRADE_CANCELLED',
    trade: { ...trade, version: 3, status: 'CANCELLED' },
    summaries: [{ ...summary, buyQuantity: '50.000000', netQuantity: '20.000000',
      buyValue: '11372.5000000000', version: 11 }] };
  for (const event of [amended, cancelled]) {
    assert.deepEqual(tradeChangeSchema.parse(event), event);
  }
});

test('summary revisions are independent of the changed trade revision', () => {
  const result = tradeChangeSchema.parse(change);
  assert.equal(result.trade.version, 1);
  assert.equal(result.summaries[0]!.version, 9);
});

test('metadata-only amendments can carry no summary updates', () => {
  const event = { ...change, type: 'TRADE_AMENDED',
    trade: { ...trade, book: 'EQUITIES_US', version: 2 }, summaries: [] };
  assert.deepEqual(tradeChangeSchema.parse(event), event);
});

test('creation and cancellation must include their affected summary', () => {
  for (const type of ['TRADE_CREATED', 'TRADE_CANCELLED']) {
    assert.equal(tradeChangeSchema.safeParse({ ...change, type, summaries: [] }).success, false);
  }
});

test('one trade can update at most one desk summary because its symbol is immutable', () => {
  for (const second of [summary, { ...summary,
    instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d06', symbol: 'MSFT' }]) {
    assert.equal(tradeChangeSchema.safeParse({ ...change, summaries: [summary, second] }).success, false);
  }
});

test('the summary symbol must match the changed trade', () => {
  assert.equal(tradeChangeSchema.safeParse({
    ...change, summaries: [{ ...summary, symbol: 'MSFT' }],
  }).success, false);
});

test('event summaries reuse the exact decimal, revision and public-field rules', () => {
  for (const invalidSummary of [
    { ...summary, buyQuantity: 150 },
    { ...summary, netQuantity: '120' },
    { ...summary, sellValue: '-1.0000000000' },
    { ...summary, version: -1 },
    { ...summary, email: 'private@example.com' },
  ]) {
    assert.equal(tradeChangeSchema.safeParse({ ...change, summaries: [invalidSummary] }).success, false);
  }
  const flat = { ...summary, buyQuantity: '0.000000', sellQuantity: '0.000000', netQuantity: '0.000000',
    buyValue: '0.0000000000', sellValue: '0.0000000000' };
  assert.equal(tradeChangeSchema.safeParse({ ...change, type: 'TRADE_CANCELLED',
    trade: { ...trade, status: 'CANCELLED', version: 2 }, summaries: [flat] }).success, true);
});

test('the event contract requires summaries and validates its envelope', () => {
  const { summaries: omitted, ...withoutSummaries } = change;
  assert.equal(omitted.length, 1);
  for (const invalid of [
    withoutSummaries, { ...change, summaries: null }, { ...change, summaries: {} },
    { ...change, changeId: 'invalid' },
    { ...change, type: 'UNKNOWN' }, { ...change, occurredAt: '2026-11-15' },
    { ...change, trade: { ...trade, quantity: 100 } }, { ...change, extra: true },
  ]) assert.equal(tradeChangeSchema.safeParse(invalid).success, false);
});

test('trade-only and format-versioned events are rejected', () => {
  const tradeOnly = {
    changeId: change.changeId, type: change.type, occurredAt: change.occurredAt, trade,
  };
  assert.equal(tradeChangeSchema.safeParse(tradeOnly).success, false);
  for (const schemaVersion of [1, 2]) {
    assert.equal(tradeChangeSchema.safeParse({ ...change, schemaVersion }).success, false);
  }
});
