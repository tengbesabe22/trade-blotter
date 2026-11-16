import assert from 'node:assert/strict';
import test from 'node:test';
import { amendTradeRequestSchema } from '../../src/trades/amendments/trade-amend-contract';

const request = { expectedVersion: 1, changes: { price: '228.5' } };

test('a partial amendment normalizes only supplied fields and leaves omitted fields unchanged', () => {
  assert.deepEqual(amendTradeRequestSchema.parse(request), {
    expectedVersion: 1, changes: { price: '228.5000' }, reason: null,
  });
});

test('amendment fields reuse create normalization without mutating the input', () => {
  const input = {
    expectedVersion: 3,
    changes: {
      side: 'SELL', quantity: '125.5', price: '10.25',
      tradeDate: '2026-11-14T17:15:23+08:00',
      book: ' EQUITIES_US ', counterparty: ' Example Bank ',
    },
    reason: ' Corrected booking. ',
  };
  const before = structuredClone(input);

  assert.deepEqual(amendTradeRequestSchema.parse(input), {
    expectedVersion: 3,
    changes: {
      side: 'SELL', quantity: '125.500000', price: '10.2500',
      tradeDate: '2026-11-14T09:15:23.000Z',
      book: 'EQUITIES_US', counterparty: 'Example Bank',
    },
    reason: 'Corrected booking.',
  });
  assert.deepEqual(input, before);
});

test('null or blank metadata explicitly clears a field instead of omitting it', () => {
  for (const value of [null, '', '   ']) {
    assert.deepEqual(amendTradeRequestSchema.parse({
      expectedVersion: 1, changes: { book: value, counterparty: value },
    }), {
      expectedVersion: 1, changes: { book: null, counterparty: null }, reason: null,
    });
  }
});

test('reason is optional, nullable, trimmed and limited to 500 characters', () => {
  for (const reason of [undefined, null, '', '   ']) {
    assert.deepEqual(amendTradeRequestSchema.parse({ ...request, reason }), {
      expectedVersion: 1, changes: { price: '228.5000' }, reason: null,
    });
  }
  assert.equal(amendTradeRequestSchema.safeParse({ ...request, reason: 'A'.repeat(500) }).success, true);
  for (const reason of ['A'.repeat(501), 42, false, {}]) {
    assert.equal(amendTradeRequestSchema.safeParse({ ...request, reason }).success, false);
  }
});

test('expectedVersion is a required positive JSON integer within the database Int range', () => {
  for (const expectedVersion of [undefined, null, 0, -1, 1.5, '1', 2_147_483_648]) {
    assert.equal(amendTradeRequestSchema.safeParse({ ...request, expectedVersion }).success, false);
  }
});

test('the minimum and maximum expectedVersion values are accepted', () => {
  for (const expectedVersion of [1, 2_147_483_647]) {
    assert.equal(amendTradeRequestSchema.safeParse({ ...request, expectedVersion }).success, true);
  }
});

test('changes must contain at least one supplied editable field', () => {
  for (const changes of [undefined, null, [], {}, { price: undefined }]) {
    assert.equal(amendTradeRequestSchema.safeParse({ ...request, changes }).success, false);
  }
});

test('unknown and server-controlled fields are rejected at both object levels', () => {
  for (const field of ['id', 'ownerId', 'userId', 'trader', 'instrumentId', 'status', 'version', 'createdAt', 'updatedAt', 'unexpected']) {
    assert.equal(amendTradeRequestSchema.safeParse({ ...request, [field]: 'value' }).success, false);
    assert.equal(amendTradeRequestSchema.safeParse({
      ...request, changes: { price: '228.5', [field]: 'value' },
    }).success, false);
  }
  assert.equal(amendTradeRequestSchema.safeParse({
    ...request, changes: { reason: 'A reason is not a trade field.' },
  }).success, false);
});

test('symbol is immutable even when unchanged or combined with an editable field', () => {
  for (const symbol of ['AAPL', 'MSFT']) {
    for (const changes of [{ symbol }, { symbol, price: '228.5' }]) {
      assert.equal(amendTradeRequestSchema.safeParse({ ...request, changes }).success, false);
    }
  }
});

test('supplied fields retain existing type, precision, range and timestamp rules', () => {
  for (const changes of [
    { side: null }, { side: 'HOLD' },
    { price: null }, { price: 10 }, { price: '0' }, { price: '1.00001' }, { price: '1000000.0001' },
    { quantity: null }, { quantity: 10 }, { quantity: '-1' }, { quantity: '1.0000001' },
    { tradeDate: null }, { tradeDate: '2026-11-14T09:00:00' },
    { book: 42 }, { book: 'B'.repeat(65) }, { counterparty: 'C'.repeat(121) },
  ]) {
    assert.equal(amendTradeRequestSchema.safeParse({ ...request, changes }).success, false);
  }
});
