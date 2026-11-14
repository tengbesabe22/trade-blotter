import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app';
import type { CurrentUser } from '../src/auth/auth-contract';
import type { AmendTradeCommand, AmendTradeResult } from '../src/trades/amendments/trade-amend-contract';
import type { TradeResponse } from '../src/trades/trade-contract';
import type { TradeRepository } from '../src/trades/trade-repository';
import { createAuthFixture, origin, user } from './auth-fixtures';

const tradeId = 'f1550000-0000-4000-8000-000000100001';
const requestBody = { expectedVersion: 3, changes: { price: '228.5' } };
const amendedTrade: TradeResponse = {
  id: tradeId, symbol: 'AAPL', side: 'BUY', quantity: '5000.000000', price: '228.5000',
  trader: user.displayName, ownerId: user.id, book: null, counterparty: 'Example Bank',
  tradeDate: '2026-08-18T09:15:23.000Z', status: 'ACTIVE', version: 4,
  createdAt: '2026-08-18T09:16:00.000Z', updatedAt: '2026-11-14T09:00:00.000Z',
};

type Options = {
  role?: CurrentUser['role'];
  onTradeChanged?: () => void;
  amend?: (command: AmendTradeCommand) => Promise<AmendTradeResult>;
};

async function setup(options: Options = {}) {
  const auth = createAuthFixture();
  auth.users.get('jsmith@example.com')!.role = options.role ?? 'TRADER';
  const now = new Date('2026-11-14T09:00:00Z');
  const token = 'a'.repeat(43);
  const commands: AmendTradeCommand[] = [];
  const notifications: string[] = [];

  await auth.repository.createSession({
    userId: user.id,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
  });

  // HTTP validation and guards are real; the repository supplies controlled outcomes.
  const trades: TradeRepository = {
    listSummaries: async () => { throw new Error('Unexpected summary lookup in this test.'); },
    listHistory: async () => { throw new Error('Unexpected history lookup in this test.'); },
    listFilterOptions: async () => { throw new Error('Unexpected filter-options lookup in this test.'); },
    cancel: async () => { throw new Error('Unexpected trade cancellation in this test.'); },
    list: async () => { throw new Error('Amendment must not list trades.'); },
    create: async () => { throw new Error('Amendment must not create trades.'); },
    amend: async (command) => {
      commands.push(command);
      return options.amend ? options.amend(command) : { kind: 'amended', body: { trade: amendedTrade } };
    },
  };
  const app = createApp(
    { auth: auth.repository, trades },
    { origin, secureCookies: false, now: () => now },
    { onTradeChanged: () => {
      notifications.push('amended');
      return options.onTradeChanged?.();
    } },
  );

  function request(
    body: unknown = requestBody,
    overrides: Record<string, string | null> = {},
    id = tradeId,
  ) {
    const headers = new Headers({
      Cookie: `blotter_session=${token}`, Origin: origin, 'Content-Type': 'application/json',
    });
    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) headers.delete(key);
      else headers.set(key, value);
    }
    return app.request('/api/trades/' + id, {
      method: 'PATCH', headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  return { request, commands, notifications };
}

async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const body = await response.json() as { code: string; message: string };
  assert.equal(body.code, code);
  assert.equal(typeof body.message, 'string');
}

test('amend rejects unauthenticated requests before persistence', async () => {
  const h = await setup();
  await expectError(await h.request(requestBody, { Cookie: null }), 401, 'UNAUTHENTICATED');
  assert.deepEqual(h.commands, []);
});

test('read-only users cannot amend trades', async () => {
  const h = await setup({ role: 'READ_ONLY' });
  await expectError(await h.request(), 403, 'FORBIDDEN');
  assert.deepEqual(h.commands, []);
});

test('amend rejects missing and untrusted origins before persistence', async () => {
  const h = await setup();
  for (const value of [null, 'null', 'https://other.example']) {
    await expectError(await h.request(requestBody, { Origin: value }), 403, 'FORBIDDEN_ORIGIN');
  }
  assert.deepEqual(h.commands, []);
});

test('amend checks origin before processing an oversized body', async () => {
  const h = await setup();
  await expectError(await h.request(' '.repeat(4097), { Origin: 'https://other.example' }), 403, 'FORBIDDEN_ORIGIN');
  assert.deepEqual(h.commands, []);
});

test('amend returns 200 and passes normalized changes, path ID and session owner without an idempotency key', async () => {
  const h = await setup();
  const response = await h.request({
    expectedVersion: 3,
    changes: { price: '228.5', book: '  ', tradeDate: '2026-08-18T17:15:23+08:00' },
    reason: ' Correct execution. ',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { trade: amendedTrade });
  assert.deepEqual(h.commands, [{
    userId: user.id, tradeId,
    input: {
      expectedVersion: 3,
      changes: { price: '228.5000', book: null, tradeDate: '2026-08-18T09:15:23.000Z' },
      reason: 'Correct execution.',
    },
  }]);
});

test('amend rejects malformed path IDs before persistence', async () => {
  const h = await setup();
  for (const id of ['not-a-uuid', '123', 'f1550000-0000-9000-8000-000000100001']) {
    await expectError(await h.request(requestBody, {}, id), 400, 'INVALID_INPUT');
  }
  assert.deepEqual(h.commands, []);
});

test('amend rejects malformed, invalid and immutable fields before persistence', async () => {
  const h = await setup();
  for (const body of [
    null, [], '{broken', {},
    { ...requestBody, expectedVersion: '3' },
    { ...requestBody, changes: {} },
    { ...requestBody, changes: { price: 228.5 } },
    { ...requestBody, changes: { price: '0' } },
    { ...requestBody, changes: { symbol: 'AAPL' } },
    { ...requestBody, changes: { symbol: 'MSFT', price: '228.5' } },
    { ...requestBody, changes: { instrumentId: tradeId } },
    { ...requestBody, changes: { status: 'CANCELLED' } },
    { ...requestBody, userId: 'spoofed-owner' },
  ]) {
    await expectError(await h.request(body), 400, 'INVALID_INPUT');
  }
  assert.deepEqual(h.commands, []);
});

test('amend requires JSON and accepts charset parameters', async () => {
  const h = await setup();
  for (const contentType of [null, 'text/plain']) {
    await expectError(await h.request(requestBody, { 'Content-Type': contentType }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  assert.deepEqual(h.commands, []);
  assert.equal((await h.request(requestBody, { 'Content-Type': 'application/json; charset=utf-8' })).status, 200);
});

test('amend rejects bodies over 4 KiB before persistence', async () => {
  const h = await setup();
  await expectError(await h.request(' '.repeat(4097)), 413, 'PAYLOAD_TOO_LARGE');
  assert.deepEqual(h.commands, []);
});

for (const outcome of [
  { kind: 'not-found', status: 404, code: 'TRADE_NOT_FOUND' },
  { kind: 'forbidden', status: 403, code: 'FORBIDDEN' },
  { kind: 'no-changes', status: 400, code: 'NO_CHANGES' },
] as const) {
  test(`amend maps ${outcome.kind} to its public error`, async () => {
    const h = await setup({ amend: async () => ({ kind: outcome.kind }) });
    await expectError(await h.request(), outcome.status, outcome.code);
    assert.equal(h.commands.length, 1);
  });
}

for (const status of ['ACTIVE', 'CANCELLED'] as const) {
  test(`amend returns the current ${status} trade on a version/status conflict`, async () => {
    const currentTrade = { ...amendedTrade, status };
    const h = await setup({ amend: async () => ({ kind: 'conflict', currentTrade }) });
    const response = await h.request();
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, 'TRADE_CONFLICT');
    assert.equal(typeof body.message, 'string');
    assert.deepEqual(body.currentTrade, currentTrade);
    assert.equal(h.commands.length, 1);
  });
}

test('amend hides unexpected persistence errors', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = await setup({ amend: async () => { throw new Error('Private database details'); } });
  const response = await h.request();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.',
  });
  assert.deepEqual(h.notifications, []);
});


test('amend wakes delivery only after commit and does not wait for delivery', async () => {
  let commit!: (result: AmendTradeResult) => void;
  const pending = new Promise<AmendTradeResult>((resolve) => { commit = resolve; });
  const h = await setup({
    amend: () => pending,
    onTradeChanged: () => new Promise<void>(() => {}),
  });
  const response = h.request();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(h.notifications, []);

  commit({ kind: 'amended', body: { trade: amendedTrade } });
  const completed = await Promise.race([
    response,
    new Promise<never>((_, reject) => {
      setImmediate(() => reject(new Error('The HTTP response must not wait for delivery.')));
    }),
  ]);
  assert.equal(completed.status, 200);
  assert.deepEqual(h.notifications, ['amended']);
});

test('rejected and invalid amendments never wake delivery', async () => {
  const outcomes: [AmendTradeResult, number][] = [
    [{ kind: 'not-found' }, 404], [{ kind: 'forbidden' }, 403],
    [{ kind: 'no-changes' }, 400], [{ kind: 'conflict', currentTrade: amendedTrade }, 409],
  ];
  for (const [result, status] of outcomes) {
    const h = await setup({ amend: async () => result });
    assert.equal((await h.request()).status, status);
    assert.deepEqual(h.notifications, []);
  }
  const invalid = await setup();
  assert.equal((await invalid.request({})).status, 400);
  assert.deepEqual(invalid.notifications, []);
});
