import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelTradeRequestSchema, cancelTradeResultSchema } from '../../src/trades/cancellations/trade-cancel-contract';

const request = { expectedVersion: 3 };

test('cancel requires only the expected version and defaults the optional reason to null', () => {
  assert.deepEqual(cancelTradeRequestSchema.parse(request), { expectedVersion: 3, reason: null });
  assert.deepEqual(request, { expectedVersion: 3 });
});

test('cancel reasons are trimmed, while omitted, null or blank reasons normalize to null', () => {
  assert.deepEqual(cancelTradeRequestSchema.parse({ ...request, reason: ' Duplicate booking. ' }), {
    expectedVersion: 3, reason: 'Duplicate booking.',
  });
  for (const reason of [undefined, null, '', '   ']) {
    assert.deepEqual(cancelTradeRequestSchema.parse({ ...request, reason }), {
      expectedVersion: 3, reason: null,
    });
  }
});

test('cancel validates the positive database integer version without coercion', () => {
  for (const expectedVersion of [undefined, null, 0, -1, 1.5, '3', 2_147_483_648]) {
    assert.equal(cancelTradeRequestSchema.safeParse({ ...request, expectedVersion }).success, false);
  }
  for (const expectedVersion of [1, 2_147_483_647]) {
    assert.equal(cancelTradeRequestSchema.safeParse({ expectedVersion }).success, true);
  }
});

test('cancel reasons are strings or null and limited to 500 characters after trimming', () => {
  assert.deepEqual(cancelTradeRequestSchema.parse({ ...request, reason: ' ' + 'R'.repeat(500) + ' ' }), {
    expectedVersion: 3, reason: 'R'.repeat(500),
  });
  for (const reason of ['R'.repeat(501), 42, false, [], {}]) {
    assert.equal(cancelTradeRequestSchema.safeParse({ ...request, reason }).success, false);
  }
});

test('cancel rejects trade edits, server-controlled fields and other unknown properties', () => {
  for (const field of [
    'changes', 'id', 'symbol', 'instrumentId', 'side', 'quantity', 'price', 'book',
    'counterparty', 'tradeDate', 'userId', 'ownerId', 'trader', 'status', 'version',
    'createdAt', 'updatedAt', 'unexpected',
  ]) {
    assert.equal(cancelTradeRequestSchema.safeParse({ ...request, [field]: 'value' }).success, false);
  }
});

test('cancel rejects malformed request shapes', () => {
  for (const input of [undefined, null, [], 'cancel', 3, {}]) {
    assert.equal(cancelTradeRequestSchema.safeParse(input).success, false);
  }
});


test('repository results distinguish success, current-trade conflicts and rejection reasons', () => {
  const trade = {
    id: 'f1550000-0000-4000-8000-000000100001',
    symbol: 'AAPL', side: 'BUY', quantity: '5000.000000', price: '228.5000',
    trader: 'JSMITH', ownerId: 'd197282d-99ca-4260-833a-702f97d1cba1',
    book: null, counterparty: null, tradeDate: '2026-08-18T09:15:23.000Z',
    status: 'CANCELLED', version: 2,
    createdAt: '2026-08-18T09:16:00.000Z', updatedAt: '2026-08-18T09:20:00.000Z',
  };

  for (const result of [
    { kind: 'cancelled', body: { trade } },
    { kind: 'conflict', currentTrade: trade },
    ...['not-found', 'forbidden'].map((kind) => ({ kind })),
  ]) {
    assert.deepEqual(cancelTradeResultSchema.parse(result), result);
  }

  for (const result of [
    { kind: 'unknown' },
    { kind: 'cancelled' },
    { kind: 'conflict' },
    { kind: 'cancelled', body: { trade: { ...trade, price: 228.5 } } },
    { kind: 'forbidden', currentTrade: trade },
  ]) {
    assert.equal(cancelTradeResultSchema.safeParse(result).success, false);
  }
});
