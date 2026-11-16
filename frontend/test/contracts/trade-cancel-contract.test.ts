import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelTradeRequestSchema,
  cancelTradeResponseSchema,
  cancelTradeConflictSchema,
} from '../../src/api/contracts/trades/trade-cancel-contract';
import { sampleTrade, cancelledTrade } from '../fixtures/trade-fixtures';

const request = { expectedVersion: 1 };

test('cancel accepts a version alone and normalizes omitted, null or blank reasons to null', () => {
  assert.deepEqual(cancelTradeRequestSchema.parse(request), { expectedVersion: 1, reason: null });
  for (const reason of [undefined, null, '', '   ']) {
    assert.deepEqual(cancelTradeRequestSchema.parse({ ...request, reason }), {
      expectedVersion: 1, reason: null,
    });
  }
});

test('cancel reasons are trimmed strings, limited to 500 characters after trimming', () => {
  assert.deepEqual(cancelTradeRequestSchema.parse({ ...request, reason: ' Duplicate booking. ' }), {
    expectedVersion: 1, reason: 'Duplicate booking.',
  });
  assert.equal(cancelTradeRequestSchema.safeParse({ ...request, reason: ' ' + 'R'.repeat(500) + ' ' }).success, true);
  for (const reason of ['R'.repeat(501), 42, false, [], {}]) {
    assert.equal(cancelTradeRequestSchema.safeParse({ ...request, reason }).success, false);
  }
});

test('cancel requires a positive bounded JSON integer version and an object body', () => {
  for (const expectedVersion of [undefined, null, '1', 0, -1, 1.5, 2_147_483_648]) {
    assert.equal(cancelTradeRequestSchema.safeParse({ expectedVersion }).success, false);
  }
  for (const expectedVersion of [1, 2_147_483_647]) {
    assert.equal(cancelTradeRequestSchema.safeParse({ expectedVersion }).success, true);
  }
  for (const body of [null, [], 'cancel', {}, 1]) {
    assert.equal(cancelTradeRequestSchema.safeParse(body).success, false);
  }
});

test('cancel rejects business edits, status, ownership and all other unknown fields', () => {
  for (const field of [
    'changes', 'symbol', 'instrumentId', 'side', 'quantity', 'price', 'book', 'counterparty',
    'tradeDate', 'id', 'ownerId', 'userId', 'trader', 'status', 'version', 'updatedAt', 'unexpected',
  ]) {
    assert.equal(cancelTradeRequestSchema.safeParse({ ...request, [field]: 'value' }).success, false);
  }
});

test('cancel success requires a complete CANCELLED trade; conflicts can contain either current status', () => {
  assert.deepEqual(cancelTradeResponseSchema.parse({ trade: cancelledTrade }), { trade: cancelledTrade });
  assert.equal(cancelTradeResponseSchema.safeParse({ trade: sampleTrade }).success, false);
  assert.equal(cancelTradeResponseSchema.safeParse({ trade: { ...cancelledTrade, price: 228.5 } }).success, false);
  for (const currentTrade of [sampleTrade, cancelledTrade]) {
    const conflict = { code: 'TRADE_CONFLICT', message: 'Review the current trade.', currentTrade };
    assert.deepEqual(cancelTradeConflictSchema.parse(conflict), conflict);
    assert.equal(cancelTradeConflictSchema.safeParse({ ...conflict, currentTrade: null }).success, false);
    assert.equal(cancelTradeConflictSchema.safeParse({ ...conflict, code: 'OTHER_ERROR' }).success, false);
  }
});
