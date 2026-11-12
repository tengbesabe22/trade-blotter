import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTradeCommandSchema,
  createTradeRequestSchema,
  createTradeResponseSchema,
  createTradeResultSchema,
} from '../src/trades/trade-create-contract';
import { tradeResponseSchema } from '../src/trades/trade-contract';

const request = {
  symbol: 'AAPL',
  side: 'BUY',
  quantity: '5000',
  price: '227.45',
  tradeDate: '2026-08-18T09:15:23Z',
} as const;

const normalizedRequest = {
  ...request,
  quantity: '5000.000000',
  price: '227.4500',
  tradeDate: '2026-08-18T09:15:23.000Z',
  book: null,
  counterparty: null,
};

const trade = {
  id: 'f1550000-0000-4000-8000-000000100001',
  ...normalizedRequest,
  ownerId: 'd197282d-99ca-4260-833a-702f97d1cba1',
  trader: 'JSMITH',
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-08-18T09:16:00.000Z',
  updatedAt: '2026-08-18T09:16:00.000Z',
};

const command = {
  userId: trade.ownerId,
  idempotencyKey: 'create-trade-001',
  requestFingerprint: 'a'.repeat(64),
  input: normalizedRequest,
};

test('symbol normalizes casing and whitespace and enforces length', () => {
  const schema = createTradeRequestSchema.shape.symbol;

  assert.equal(schema.parse(' aapl '), 'AAPL');
  assert.equal(schema.safeParse('   ').success, false);
  assert.equal(schema.safeParse('A'.repeat(13)).success, false);
});

test('the request normalizes all fields without changing the caller object', () => {
  const raw = {
    ...request,
    symbol: ' aapl ',
    tradeDate: '2026-08-18T17:15:23+08:00',
    book: ' EQUITIES_UK ',
    counterparty: ' Example Bank ',
  };
  const before = { ...raw };

  assert.deepEqual(createTradeRequestSchema.parse(raw), {
    ...normalizedRequest,
    book: 'EQUITIES_UK',
    counterparty: 'Example Bank',
  });
  assert.deepEqual(raw, before);
});

test('omitted, null, empty, and whitespace metadata all normalize to null', () => {
  for (const value of [undefined, null, '', '   ']) {
    const result = createTradeRequestSchema.parse({ ...request, book: value, counterparty: value });

    assert.equal(result.book, null);
    assert.equal(result.counterparty, null);
  }

  assert.deepEqual(createTradeRequestSchema.parse(request), normalizedRequest);
});

test('metadata lengths are bounded after trimming and nonstrings are rejected', () => {
  const maximum = createTradeRequestSchema.parse({
    ...request,
    book: ` ${'A'.repeat(64)} `,
    counterparty: ` ${'B'.repeat(120)} `,
  });

  assert.equal(maximum.book?.length, 64);
  assert.equal(maximum.counterparty?.length, 120);

  for (const fields of [
    { book: 'A'.repeat(65) },
    { counterparty: 'B'.repeat(121) },
    { book: 42 },
    { counterparty: false },
  ]) {
    assert.equal(createTradeRequestSchema.safeParse({ ...request, ...fields }).success, false);
  }
});

test('decimals preserve fractional values and accept inclusive positive bounds', () => {
  for (const values of [
    { quantity: '999999999.999999', price: '999999.9999' },
    { quantity: '1000000000.000000', price: '1000000.0000' },
    { quantity: '0.000001', price: '0.0001' },
  ]) {
    const result = createTradeRequestSchema.parse({ ...request, ...values });

    assert.equal(result.quantity, values.quantity);
    assert.equal(result.price, values.price);
  }
});

test('decimals reject invalid syntax, nonstrings, zero, and negatives without throwing', () => {
  for (const field of ['quantity', 'price'] as const) {
    for (const value of [
      1, null, '', '0', '0.0000', '-1', '+1', '01', '.5', '1.',
      ' 1 ', '1\n', '1\t', '1e3', '1,000', '$10', '10abc', 'NaN', 'Infinity',
    ]) {
      assert.equal(
        createTradeRequestSchema.safeParse({ ...request, [field]: value }).success,
        false,
        `${field} accepted ${JSON.stringify(value)}`,
      );
    }
  }
});

test('decimals reject excess scale and values above the maximum instead of rounding', () => {
  for (const values of [
    { quantity: '0.0000001' },
    { quantity: '1.0000000' },
    { quantity: '1000000000.000001' },
    { price: '0.00001' },
    { price: '1.00000' },
    { price: '1000000.0001' },
  ]) {
    assert.equal(createTradeRequestSchema.safeParse({ ...request, ...values }).success, false);
  }
});

test('execution timestamps accept offsets and up to millisecond precision and normalize to UTC', () => {
  for (const [raw, expected] of [
    ['2026-08-18T17:15:23+08:00', '2026-08-18T09:15:23.000Z'],
    ['2026-08-18T04:15:23-05:00', '2026-08-18T09:15:23.000Z'],
    ['2026-08-18T09:15:23.1Z', '2026-08-18T09:15:23.100Z'],
    ['2026-08-18T09:15:23.123Z', '2026-08-18T09:15:23.123Z'],
    ['2024-02-29T09:15:23Z', '2024-02-29T09:15:23.000Z'],
  ]) {
    assert.equal(createTradeRequestSchema.parse({ ...request, tradeDate: raw }).tradeDate, expected);
  }
});

test('execution timestamps reject invalid calendars, missing zones, and excess precision', () => {
  for (const tradeDate of [
    'invalid', '2026-02-29T09:15:23Z', '2026-02-30T09:15:23Z',
    '2026-08-18', '2026-08-18T09:15:23', '2026-08-18T09:15Z',
    '2026-08-18T09:15:23.1234Z', '2026-08-18T09:15:23+99:00',
  ]) {
    assert.equal(
      createTradeRequestSchema.safeParse({ ...request, tradeDate }).success,
      false,
      `Accepted timestamp ${tradeDate}`,
    );
  }
});

test('requests reject client-supplied server fields and unknown properties', () => {
  for (const field of ['id', 'userId', 'ownerId', 'instrumentId', 'trader', 'status', 'version',
    'createdAt', 'updatedAt', 'unexpected']) {
    assert.equal(createTradeRequestSchema.safeParse({ ...request, [field]: 'spoofed' }).success, false);
  }

  for (const invalid of [null, [], {}, { ...request, side: 'buy' }]) {
    assert.equal(createTradeRequestSchema.safeParse(invalid).success, false);
  }
});

test('the internal command validates owner UUID, key, fingerprint, and normalized input', () => {
  assert.deepEqual(createTradeCommandSchema.parse(command), command);

  for (const fields of [
    { userId: 'not-a-uuid' },
    { idempotencyKey: '' },
    { idempotencyKey: 'a'.repeat(121) },
    { idempotencyKey: 'invalid key' },
    { idempotencyKey: 'valid-key\n' },
    { requestFingerprint: 'not-a-hash' },
    { requestFingerprint: 'g'.repeat(64) },
    { requestFingerprint: `${'a'.repeat(64)}\n` },
    { unexpected: true },
  ]) {
    assert.equal(createTradeCommandSchema.safeParse({ ...command, ...fields }).success, false);
  }

  assert.equal(createTradeCommandSchema.safeParse({
    ...command,
    idempotencyKey: 'a'.repeat(120),
  }).success, true);
});

test('response metadata is always present and nullable', () => {
  assert.deepEqual(tradeResponseSchema.parse(trade), trade);

  for (const field of ['book', 'counterparty'] as const) {
    assert.equal(tradeResponseSchema.safeParse({ ...trade, [field]: undefined }).success, false);
  }
});

test('responses require UUIDs, fixed decimals, UTC milliseconds, and positive integer versions', () => {
  for (const fields of [
    { id: 'invalid' }, { ownerId: 'invalid' },
    { quantity: '5000' }, { price: '227.45' }, { price: '0.0000' },
    { tradeDate: '2026-08-18T09:15:23+00:00' },
    { createdAt: 'invalid' }, { updatedAt: '2026-08-18T09:15:23Z' },
    { version: 0 }, { version: 1.5 }, { status: 'UNKNOWN' },
    { passwordHash: 'private' },
  ]) {
    assert.equal(tradeResponseSchema.safeParse({ ...trade, ...fields }).success, false);
  }
});

test('create and replay results wrap the public trade response, never the request body', () => {
  const body = { trade };
  assert.deepEqual(createTradeResponseSchema.parse(body), body);

  for (const kind of ['created', 'replayed']) {
    const result = { kind, body };
    assert.deepEqual(createTradeResultSchema.parse(result), result);
    assert.equal(createTradeResultSchema.safeParse({ kind, body: request }).success, false);
  }

  for (const kind of ['unknown-instrument', 'idempotency-conflict']) {
    assert.deepEqual(createTradeResultSchema.parse({ kind }), { kind });
  }

  assert.equal(createTradeResultSchema.safeParse({ kind: 'unexpected' }).success, false);
});
