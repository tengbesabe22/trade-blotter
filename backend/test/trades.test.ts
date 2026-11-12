import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Prisma } from '@trade-blotter/database';
import { createApp } from '../src/app';
import type { CurrentUser } from '../src/auth/auth-repository';
import { toTradeResponse, type TradeResponse } from '../src/trades/trade-contract';
import type { TradeRecord, TradeRepository } from '../src/trades/trade-repository';
import { createAuthFixture, origin, user } from './auth-fixtures';

function tradeRecord(overrides: Partial<TradeRecord> = {}): TradeRecord {
  // Extra private relation fields ensure the mapper explicitly selects public data.
  const trader = {
    displayName: 'JSMITH',
    email: 'private@example.com',
    passwordHash: 'private-password-hash',
  };

  return {
    id: 'f1550000-0000-4000-8000-000000100001',
    userId: user.id,
    instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05',
    instrument: { symbol: 'AAPL' },
    user: trader,
    side: 'BUY',
    quantity: new Prisma.Decimal('5000'),
    price: new Prisma.Decimal('227.45'),
    book: 'EQUITIES_UK',
    counterparty: 'Goldman Sachs',
    tradeDate: new Date('2026-08-18T17:15:23+08:00'),
    status: 'ACTIVE',
    version: 1,
    createdAt: new Date('2026-08-18T09:16:00Z'),
    updatedAt: new Date('2026-08-18T09:16:00Z'),
    ...overrides,
  };
}

const expectedTrade: TradeResponse = {
  id: 'f1550000-0000-4000-8000-000000100001',
  symbol: 'AAPL',
  side: 'BUY',
  quantity: '5000.000000',
  price: '227.4500',
  trader: 'JSMITH',
  ownerId: user.id,
  book: 'EQUITIES_UK',
  counterparty: 'Goldman Sachs',
  tradeDate: '2026-08-18T09:15:23.000Z',
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-08-18T09:16:00.000Z',
  updatedAt: '2026-08-18T09:16:00.000Z',
};

const otherOwnerId = '14cad115-cfe2-402f-9934-a97657f91162';
const cancelledId = 'f1550000-0000-4000-8000-000000100002';

function cancelledTrade(): TradeRecord {
  return tradeRecord({
    id: cancelledId,
    userId: otherOwnerId,
    user: { displayName: 'ADOE' },
    side: 'SELL',
    status: 'CANCELLED',
    version: 2,
    book: null,
    counterparty: null,
    updatedAt: new Date('2026-08-18T10:00:00Z'),
  });
}

type SetupOptions = {
  role?: CurrentUser['role'];
  records?: TradeRecord[];
  failListing?: boolean;
};

async function setup(options: SetupOptions = {}) {
  const auth = createAuthFixture();
  auth.users.get('jsmith@example.com')!.role = options.role ?? 'TRADER';
  const now = new Date('2026-11-11T09:00:00Z');
  const token = 'a'.repeat(43);
  const calls = { list: 0 };

  await auth.repository.createSession({
    userId: user.id,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
  });

  // Persistence is fake. Decimal values are real value objects, not DB connections.
  const trades: TradeRepository = {
    list: async () => {
      calls.list += 1;

      if (options.failListing) {
        throw new Error('Private database connection details');
      }

      return options.records ?? [tradeRecord(), cancelledTrade()];
    },
  };

  const app = createApp(
    { auth: auth.repository, trades },
    { origin, secureCookies: false, now: () => now },
  );

  function request(authenticated = true) {
    return app.request('/api/trades', {
      headers: authenticated ? { Cookie: `blotter_session=${token}` } : {},
    });
  }

  return { request, calls };
}

test('GET /api/trades rejects unauthenticated requests before loading trades', async () => {
  const h = await setup();

  const response = await h.request(false);

  assert.equal(response.status, 401);
  assert.equal(h.calls.list, 0);
});

for (const role of ['TRADER', 'READ_ONLY'] as const) {
  test(`GET /api/trades lets ${role} view all owners and cancelled trades`, async () => {
    const h = await setup({ role });

    const response = await h.request();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {
      trades: [
        expectedTrade,
        {
          ...expectedTrade,
          id: cancelledId,
          ownerId: otherOwnerId,
          trader: 'ADOE',
          side: 'SELL',
          status: 'CANCELLED',
          version: 2,
          book: null,
          counterparty: null,
          updatedAt: '2026-08-18T10:00:00.000Z',
        },
      ],
    });
  });
}

test('GET /api/trades returns an empty trades array when there are no records', async () => {
  const h = await setup({ records: [] });

  const response = await h.request();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { trades: [] });
});

test('GET /api/trades returns a sanitized server error if listing fails', async () => {
  const h = await setup({ failListing: true });

  const response = await h.request();

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  });
});

test('trade mapping exposes only the public contract with fixed-scale decimals and UTC dates', () => {
  const response = toTradeResponse(tradeRecord());

  assert.deepEqual(response, expectedTrade);
});

test('trade mapping preserves fractional precision and nullable metadata', () => {
  const response = toTradeResponse(
    tradeRecord({
      quantity: new Prisma.Decimal('999999999.999999'),
      price: new Prisma.Decimal('999999.9999'),
      book: null,
      counterparty: null,
    }),
  );

  assert.equal(response.quantity, '999999999.999999');
  assert.equal(response.price, '999999.9999');
  assert.equal(response.book, null);
  assert.equal(response.counterparty, null);
});
