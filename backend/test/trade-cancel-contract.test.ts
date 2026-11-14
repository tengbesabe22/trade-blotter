import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelTradeRequestSchema } from '../src/trades/cancellations/trade-cancel-contract';

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
