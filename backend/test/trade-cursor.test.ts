import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeTradeCursor, encodeTradeCursor, InvalidTradeCursorError } from '../src/trades/trade-cursor';
import type { TradeCursorBoundary } from '../src/trades/trade-cursor';
import { tradeListQuerySchema } from '../src/trades/trade-query-contract';
import type { NormalizedTradeListQuery } from '../src/trades/trade-query-contract';

const tradeId = 'f1550000-0000-4000-8000-000000100001';
const query = tradeListQuerySchema.parse({});
const boundary: TradeCursorBoundary = {
  sortBy: 'tradeDate', value: '2026-11-13T01:00:00.000Z', id: tradeId,
};

function issueCursor(overrides: Partial<NormalizedTradeListQuery> = {}) {
  return encodeTradeCursor({ ...query, ...overrides }, boundary);
}

function withCursor(token: string) {
  return { ...query, after: token };
}

function assertInvalid(token: string, requestedQuery: NormalizedTradeListQuery = withCursor(token)) {
  assert.throws(
    () => decodeTradeCursor(requestedQuery),
    (error: unknown) => error instanceof InvalidTradeCursorError && error.code === 'INVALID_CURSOR',
  );
}

function replacePayload(token: string, change: (payload: Record<string, unknown>) => unknown) {
  const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  return Buffer.from(JSON.stringify(change(payload))).toString('base64url');
}

test('a first-page query has no cursor boundary', () => {
  assert.equal(decodeTradeCursor(query), null);
});

test('cursor is one plain base64url JSON boundary without a signature', () => {
  const token = issueCursor();
  assert.doesNotMatch(token, /\./);
  assert.deepEqual(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')), {
    version: 1, sortDirection: 'desc', boundary,
  });
});

const boundaries: TradeCursorBoundary[] = [
  boundary,
  { sortBy: 'symbol', value: 'AAPL', id: tradeId },
  { sortBy: 'trader', value: 'JSMITH', id: tradeId },
  { sortBy: 'quantity', value: '999999999.999999', id: tradeId },
  { sortBy: 'price', value: '227.4500', id: tradeId },
  { sortBy: 'status', value: 'CANCELLED', id: tradeId },
];

for (const anchor of boundaries) {
  for (const sortDirection of ['asc', 'desc'] as const) {
    test(`${anchor.sortBy} boundary round-trips for ${sortDirection} without losing precision`, () => {
      const requestedQuery = { ...query, sortBy: anchor.sortBy, sortDirection };
      const token = encodeTradeCursor(requestedQuery, anchor);

      assert.deepEqual(decodeTradeCursor({ ...requestedQuery, after: token }), anchor);
    });
  }
}

test('a cursor cannot be used with a different sort field or direction', () => {
  const token = issueCursor();
  assertInvalid(token, { ...withCursor(token), sortBy: 'price' });
  assertInvalid(token, { ...withCursor(token), sortDirection: 'asc' });
});

test('boundary encoding is independent of filters and page size', () => {
  assert.equal(issueCursor({ symbols: ['AAPL'], limit: 50 }), issueCursor());
});

test('non-JSON cursor content is rejected', () => {
  assertInvalid(Buffer.from('{broken').toString('base64url'));
});

test('cursor issuance rejects a boundary that disagrees with the requested sort', () => {
  assert.throws(() => issueCursor({ sortBy: 'price' }), InvalidTradeCursorError);
});

for (const token of ['', 'not-a-token', 'a.b.c', 'a.!', 'a'.repeat(2049)]) {
  test(`malformed cursor is rejected (length ${token.length})`, () => {
    assertInvalid(token);
  });
}

const invalidPayloads: [string, (payload: Record<string, unknown>) => unknown][] = [
  ['unsupported version', (p) => ({ ...p, version: 2 })],
  ['unknown field', (p) => ({ ...p, extra: true })],
  ['invalid sort direction', (p) => ({ ...p, sortDirection: 'down' })],
  ['invalid trade ID', (p) => ({ ...p, boundary: { ...boundary, id: 'not-a-uuid' } })],
  ['invalid timestamp', (p) => ({ ...p, boundary: { ...boundary, value: 'yesterday' } })],
  ['wrong value type', (p) => ({ ...p, boundary: { ...boundary, value: 123 } })],
  ['invalid status', (p) => ({ ...p, boundary: { ...boundary, sortBy: 'status', value: 'PENDING' } })],
  ['unscaled price', (p) => ({ ...p, boundary: { ...boundary, sortBy: 'price', value: '1.2' } })],
  ['unscaled quantity', (p) => ({ ...p, boundary: { ...boundary, sortBy: 'quantity', value: '1.2' } })],
  ['non-object payload', () => null],
];

for (const [name, change] of invalidPayloads) {
  test(`invalid payload is rejected: ${name}`, () => {
    assertInvalid(replacePayload(issueCursor(), change));
  });
}

for (const [sortBy, invalidValues] of [
  ['price', ['abc', '1.2', '0.0000', '1000000.0001']],
  ['quantity', ['abc', '1.2', '0.000000', '1000000000.000001']],
  ['status', ['PENDING']],
] as const) {
  test(`${sortBy} boundaries reject invalid values under the matching query`, () => {
    const anchor = boundaries.find((candidate) => candidate.sortBy === sortBy)!;
    const requestedQuery = { ...query, sortBy };
    const token = encodeTradeCursor(requestedQuery, anchor);

    for (const value of invalidValues) {
      const invalidToken = replacePayload(token, (payload) => ({
        ...payload, boundary: { ...anchor, value },
      }));
      assertInvalid(invalidToken, {
        ...requestedQuery, after: invalidToken,
      });
    }
  });
}
