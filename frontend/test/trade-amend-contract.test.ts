import assert from 'node:assert/strict';
import test from 'node:test';
import {
  amendTradeRequestSchema,
  amendTradeResponseSchema,
  amendTradeConflictSchema,
} from '../src/api/contracts/trades/trade-amend-contract';
import { sampleTrade } from './trade-fixtures';

const request = { expectedVersion: 1, changes: { price: '228.5' } };

test('partial amendments preserve exact decimal strings and omit unchanged fields', () => {
  assert.deepEqual(amendTradeRequestSchema.parse(request), {
    expectedVersion: 1, changes: { price: '228.5' }, reason: null,
  });
});

test('amendment metadata and reasons are trimmed, with null or blank clearing optional values', () => {
  for (const blank of [null, '', '   ']) {
    assert.deepEqual(amendTradeRequestSchema.parse({
      expectedVersion: 1, changes: { book: blank, counterparty: blank }, reason: blank,
    }), { expectedVersion: 1, changes: { book: null, counterparty: null }, reason: null });
  }
  assert.deepEqual(amendTradeRequestSchema.parse({
    expectedVersion: 1, changes: { book: ' EQUITIES_US ', counterparty: ' Example Bank ' },
    reason: ' Correct booking. ',
  }), {
    expectedVersion: 1, changes: { book: 'EQUITIES_US', counterparty: 'Example Bank' },
    reason: 'Correct booking.',
  });
});

test('amendments require a positive bounded JSON version and nonempty changes', () => {
  for (const expectedVersion of [undefined, null, '1', 0, -1, 1.5, 2_147_483_648]) {
    assert.equal(amendTradeRequestSchema.safeParse({ ...request, expectedVersion }).success, false);
  }
  assert.equal(amendTradeRequestSchema.safeParse({ ...request, expectedVersion: 2_147_483_647 }).success, true);
  for (const changes of [undefined, null, [], {}, { price: undefined }]) {
    assert.equal(amendTradeRequestSchema.safeParse({ ...request, changes }).success, false);
  }
});

test('amendments reject symbols and other immutable, server-controlled or unknown fields', () => {
  for (const field of ['symbol', 'instrumentId', 'id', 'ownerId', 'userId', 'trader', 'status', 'version', 'createdAt', 'updatedAt', 'unexpected']) {
    assert.equal(amendTradeRequestSchema.safeParse({ ...request, [field]: 'value' }).success, false);
    assert.equal(amendTradeRequestSchema.safeParse({
      ...request, changes: { ...request.changes, [field]: 'value' },
    }).success, false);
  }
});

test('editable fields keep existing precision, range, type and length validation', () => {
  for (const changes of [
    { side: 'HOLD' }, { quantity: 100 }, { quantity: '0' }, { quantity: '1.0000001' },
    { quantity: '1000000000.000001' }, { price: null }, { price: '1e3' },
    { price: '1.00001' }, { price: '1000000.0001' }, { tradeDate: 'invalid' },
    { book: 'B'.repeat(65) }, { counterparty: 'C'.repeat(121) },
  ]) {
    assert.equal(amendTradeRequestSchema.safeParse({ ...request, changes }).success, false);
  }
  assert.equal(amendTradeRequestSchema.safeParse({ ...request, reason: 'R'.repeat(501) }).success, false);
});

test('amendment success and conflict payloads validate the complete current trade', () => {
  const conflict = { code: 'TRADE_CONFLICT', message: 'Review the current trade.', currentTrade: sampleTrade };
  assert.deepEqual(amendTradeResponseSchema.parse({ trade: sampleTrade }), { trade: sampleTrade });
  assert.deepEqual(amendTradeConflictSchema.parse(conflict), conflict);
  assert.equal(amendTradeResponseSchema.safeParse({ trade: { ...sampleTrade, price: 228.5 } }).success, false);
  assert.equal(amendTradeConflictSchema.safeParse({ ...conflict, currentTrade: null }).success, false);
  assert.equal(amendTradeConflictSchema.safeParse({ ...conflict, code: 'OTHER_ERROR' }).success, false);
});
