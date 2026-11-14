import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateTradeContribution,
  calculateSummaryDelta,
  hasSummaryChanges,
  type TradeContribution,
} from '../src/trades/summaries/trade-summary-calculation';

const trade = { side: 'BUY' as const, status: 'ACTIVE' as const, quantity: '2.500000', price: '10.1000' };

function amounts(contribution: TradeContribution) {
  return {
    buyQuantity: contribution.buyQuantity.toFixed(6),
    sellQuantity: contribution.sellQuantity.toFixed(6),
    buyValue: contribution.buyValue.toFixed(10),
    sellValue: contribution.sellValue.toFixed(10),
  };
}
const zero = {
  buyQuantity: '0.000000', sellQuantity: '0.000000',
  buyValue: '0.0000000000', sellValue: '0.0000000000',
};

test('an ACTIVE BUY contributes quantity and execution cost only to the buy totals', () => {
  assert.deepEqual(amounts(calculateTradeContribution(trade)), {
    ...zero, buyQuantity: '2.500000', buyValue: '25.2500000000',
  });
});

test('an ACTIVE SELL contributes quantity and proceeds only to the sell totals', () => {
  assert.deepEqual(amounts(calculateTradeContribution({ ...trade, side: 'SELL' })), {
    ...zero, sellQuantity: '2.500000', sellValue: '25.2500000000',
  });
});

test('cancelled or absent trades contribute zero, regardless of their former side', () => {
  for (const side of ['BUY', 'SELL'] as const) {
    assert.deepEqual(amounts(calculateTradeContribution({ ...trade, side, status: 'CANCELLED' })), zero);
  }
  assert.deepEqual(amounts(calculateTradeContribution(null)), zero);
});

test('creating a trade adds its contribution', () => {
  const delta = calculateSummaryDelta(null, trade);
  assert.deepEqual(amounts(delta), amounts(calculateTradeContribution(trade)));
  assert.equal(hasSummaryChanges(delta), true);
});

test('a quantity/price amendment replaces the old contribution rather than adding the whole new trade', () => {
  const after = { ...trade, quantity: '3.250000', price: '12.3000' };
  assert.deepEqual(amounts(calculateSummaryDelta(trade, after)), {
    ...zero, buyQuantity: '0.750000', buyValue: '14.7250000000',
  });
});

test('changing BUY to SELL removes the buy contribution and adds the sell contribution', () => {
  assert.deepEqual(amounts(calculateSummaryDelta(trade, { ...trade, side: 'SELL' })), {
    buyQuantity: '-2.500000', sellQuantity: '2.500000',
    buyValue: '-25.2500000000', sellValue: '25.2500000000',
  });
});

test('cancellation removes the ACTIVE contribution without inventing an opposite-side trade', () => {
  assert.deepEqual(amounts(calculateSummaryDelta(trade, { ...trade, status: 'CANCELLED' })), {
    ...zero, buyQuantity: '-2.500000', buyValue: '-25.2500000000',
  });
});

test('metadata-only amendments do not require another summary revision', () => {
  const before = { ...trade, book: 'DESK_A', counterparty: 'Bank A', tradeDate: '2026-11-14T09:00:00.000Z' };
  const after = { ...before, book: 'DESK_B', counterparty: 'Bank B', tradeDate: '2026-11-14T10:00:00.000Z' };
  const delta = calculateSummaryDelta(before, after);
  assert.deepEqual(amounts(delta), zero);
  assert.equal(hasSummaryChanges(delta), false);
  assert.equal(hasSummaryChanges(calculateSummaryDelta(null, null)), false);
});

test('large fractional trade amounts retain every trade-value digit', () => {
  const large = { ...trade, quantity: '999999999.999999', price: '999999.9999' };
  assert.equal(calculateTradeContribution(large).buyValue.toFixed(10), '999999999899999.0000000001');
});

test('subtracting large trade values preserves a small price amendment exactly', () => {
  const before = Object.freeze({ ...trade, quantity: '999999999.999999', price: '999999.9999' });
  const after = Object.freeze({ ...before, price: '1000000.0000' });
  assert.deepEqual(amounts(calculateSummaryDelta(before, after)), {
    ...zero, buyValue: '99999.9999999999',
  });
});
