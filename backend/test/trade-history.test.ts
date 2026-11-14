import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app';
import type { CurrentUser } from '../src/auth/auth-contract';
import { SESSION_IDLE_TIMEOUT_MS } from '../src/auth/session-config';
import type { TradeHistoryEntry } from '../src/trades/history/trade-history-contract';
import type { TradeHistoryResult, TradeRepository } from '../src/trades/trade-repository';
import { createAuthFixture, origin, user } from './auth-fixtures';

const tradeId = 'f1550000-0000-4000-8000-000000100001';
const now = new Date('2026-11-14T09:00:00.000Z');
// Shared trade visibility includes trades owned by someone other than the reader.
const actor = { id: '14cad115-cfe2-402f-9934-a97657f91162', displayName: 'ADOE' };
const snapshot = {
  id: tradeId, symbol: 'AAPL', side: 'BUY' as const, quantity: '5000.000000', price: '227.4500',
  trader: actor.displayName, ownerId: actor.id, book: 'EQUITIES_US', counterparty: null,
  tradeDate: '2026-08-18T09:15:23.000Z', status: 'ACTIVE' as const, version: 1,
  createdAt: '2026-08-18T09:16:00.000Z', updatedAt: '2026-08-18T09:16:00.000Z',
};
const created: TradeHistoryEntry = {
  id: 'a1111111-1111-4111-8111-111111111111', tradeVersion: 1, action: 'CREATED', actor,
  reason: null, recordedAt: snapshot.createdAt, snapshot, changes: [],
};
const amended: TradeHistoryEntry = {
  ...created, id: 'a2222222-2222-4222-8222-222222222222', tradeVersion: 2, action: 'AMENDED',
  reason: 'Correct price.', recordedAt: '2026-08-18T09:20:00.000Z',
  snapshot: { ...snapshot, version: 2, price: '230.0000', updatedAt: '2026-08-18T09:20:00.000Z' },
  changes: [{ field: 'price', before: '227.4500', after: '230.0000' }],
};
const cancelled: TradeHistoryEntry = {
  ...amended, id: 'a3333333-3333-4333-8333-333333333333', tradeVersion: 3, action: 'CANCELLED',
  reason: null, recordedAt: '2026-08-18T09:25:00.000Z',
  snapshot: { ...amended.snapshot, version: 3, status: 'CANCELLED', updatedAt: '2026-08-18T09:25:00.000Z' },
  changes: [{ field: 'status', before: 'ACTIVE', after: 'CANCELLED' }],
};
const entries = [cancelled, amended, created];

async function setup(options: { role?: CurrentUser['role']; result?: TradeHistoryResult; fail?: boolean } = {}) {
  const auth = createAuthFixture();
  auth.users.get('jsmith@example.com')!.role = options.role ?? 'TRADER';
  const token = 'a'.repeat(43);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const lastSeenAt = new Date(now.getTime() - 60_000);
  const calls: string[] = [];
  await auth.repository.createSession({
    userId: user.id, tokenHash, lastSeenAt,
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
  });
  const trades: TradeRepository = {
    listHistory: async (id) => {
      calls.push(id);
      if (options.fail) throw new Error('Private database credentials');
      return options.result ?? { kind: 'found', entries };
    },
    listFilterOptions: async () => { throw new Error('History must not load filter options.'); },
    list: async () => { throw new Error('History must not list current trades.'); },
    create: async () => { throw new Error('History must not create trades.'); },
    amend: async () => { throw new Error('History must not amend trades.'); },
    cancel: async () => { throw new Error('History must not cancel trades.'); },
  };
  const app = createApp({ auth: auth.repository, trades }, { origin, secureCookies: false, now: () => now });
  return {
    auth, calls, tokenHash, lastSeenAt,
    request: (id = tradeId, authenticated = true, background = false) => app.request(`/api/trades/${id}/history`, {
      headers: {
        ...(authenticated ? { Cookie: 'blotter_session=' + token } : {}),
        ...(background ? { 'X-Session-Activity': 'background' } : {}),
      },
    }),
  };
}

test('history requires authentication before reading the repository', async () => {
  const h = await setup();
  const response = await h.request(tradeId, false);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { code: 'UNAUTHENTICATED', message: 'Please log in again.' });
  assert.deepEqual(h.calls, []);
});

for (const expiry of ['idle', 'absolute'] as const) {
  test(`${expiry}-expired sessions cannot read history`, async () => {
    const h = await setup();
    const session = h.auth.sessions.get(h.tokenHash)!;
    if (expiry === 'idle') session.lastSeenAt = new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS);
    else session.expiresAt = now;
    assert.equal((await h.request()).status, 401);
    assert.deepEqual(h.calls, []);
  });
}

for (const role of ['TRADER', 'READ_ONLY'] as const) {
  test(`${role} can read another trader's complete history, including cancellation`, async () => {
    const h = await setup({ role });
    const response = await h.request(tradeId.toUpperCase());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(h.calls, [tradeId]);
    assert.deepEqual(await response.json(), {
      schemaVersion: 1, generatedAt: now.toISOString(), tradeId, entries,
    });
  });
}

test('an invalid trade ID is rejected before reading history', async () => {
  const h = await setup();
  const response = await h.request('TRD-100001');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: 'INVALID_INPUT', message: 'Provide a valid trade ID.' });
  assert.deepEqual(h.calls, []);
});

test('a missing trade returns the established not-found response', async () => {
  const h = await setup({ result: { kind: 'not-found' } });
  const response = await h.request();
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { code: 'TRADE_NOT_FOUND', message: 'Trade not found.' });
  assert.deepEqual(h.calls, [tradeId]);
});

test('an existing trade without retained history returns an empty entries array', async () => {
  const h = await setup({ result: { kind: 'found', entries: [] } });
  const response = await h.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    schemaVersion: 1, generatedAt: now.toISOString(), tradeId, entries: [],
  });
});

test('repository failures return a sanitized server error', async () => {
  const h = await setup({ fail: true });
  const response = await h.request();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
});

test('malformed repository output cannot escape as successful history', async () => {
  const privateActor = { ...actor, email: 'private@example.com', passwordHash: 'secret' };
  for (const invalidEntries of [
    [created, amended],
    [{ ...created, snapshot: { ...snapshot, id: actor.id } }],
    [{ ...created, actor: privateActor }],
  ]) {
    const h = await setup({ result: { kind: 'found', entries: invalidEntries } });
    const response = await h.request();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

test('opening history records activity while background refreshes preserve idle time', async () => {
  const foreground = await setup();
  assert.equal((await foreground.request()).status, 200);
  assert.equal(foreground.auth.sessions.get(foreground.tokenHash)?.lastSeenAt.getTime(), now.getTime());

  const background = await setup();
  assert.equal((await background.request(tradeId, true, true)).status, 200);
  assert.equal(background.auth.sessions.get(background.tokenHash)?.lastSeenAt.getTime(), background.lastSeenAt.getTime());
});
