import assert from 'node:assert/strict';
import test from 'node:test';
import { tradeChangeSchema } from '../src/api/trade-stream-contract';
import { sampleTrade } from './trade-fixtures';

const summary = {
  instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: sampleTrade.symbol, currency: 'USD',
  buyQuantity: sampleTrade.quantity, sellQuantity: '0.000000', netQuantity: sampleTrade.quantity,
  buyValue: '1137250.5002274501', sellValue: '0.0000000000',
  version: 9, updatedAt: '2026-11-15T09:00:00.000Z',
};
const tradeOnly = {
  changeId: 'd197282d-99ca-4260-833a-702f97d1cba9',
  type: 'TRADE_CREATED', occurredAt: summary.updatedAt, trade: sampleTrade,
};
const change = { ...tradeOnly, summaries: [summary] };

test('browser requires both the trade and summaries', () => {
  assert.equal(tradeChangeSchema.safeParse(tradeOnly).success, false);
});

test('browser accepts one event shape with snapshots for creation, amendment and cancellation', () => {
  for (const type of ['TRADE_CREATED', 'TRADE_AMENDED', 'TRADE_CANCELLED']) {
    const event = { ...change, type, trade: { ...sampleTrade,
      status: type === 'TRADE_CANCELLED' ? 'CANCELLED' : 'ACTIVE' } };
    assert.deepEqual(tradeChangeSchema.parse(event), event);
  }
});

test('metadata-only amendments can carry no summary update', () => {
  const event = { ...change, type: 'TRADE_AMENDED', summaries: [] };
  assert.deepEqual(tradeChangeSchema.parse(event), event);
  for (const type of ['TRADE_CREATED', 'TRADE_CANCELLED']) {
    assert.equal(tradeChangeSchema.safeParse({ ...event, type }).success, false);
  }
});

test('browser rejects malformed or mismatched summaries', () => {
  for (const summaries of [undefined, null, {}, [{ ...summary, buyQuantity: 5000 }],
    [{ ...summary, netQuantity: '5000' }], [{ ...summary, version: -1 }],
    [{ ...summary, symbol: 'OTHER' }], [{ ...summary, privateField: true }], [summary, summary]]) {
    assert.equal(tradeChangeSchema.safeParse({ ...change, summaries }).success, false);
  }
});

test('browser retains aggregate precision and independent summary versions', () => {
  const event = { ...change, summaries: [{ ...summary,
    buyQuantity: '9999999999999999999999.999999', netQuantity: '9999999999999999999999.999999',
    buyValue: '9999999999999999999999999999.9999999999', version: 99 }] };
  assert.deepEqual(tradeChangeSchema.parse(event), event);
});

test('the event envelope rejects format versions and unknown fields', () => {
  for (const event of [{ ...change, schemaVersion: 1 }, { ...change, schemaVersion: 2 }, { ...change, changeId: 'bad' },
    { ...change, occurredAt: '2026-11-15' }, { ...change, extra: true }]) {
    assert.equal(tradeChangeSchema.safeParse(event).success, false);
  }
});
