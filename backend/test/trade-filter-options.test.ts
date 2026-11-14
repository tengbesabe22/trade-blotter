import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app';
import type { CurrentUser } from '../src/auth/auth-contract';
import { SESSION_IDLE_TIMEOUT_MS } from '../src/auth/session-config';
import type { TradeRepository } from '../src/trades/trade-repository';
import { createAuthFixture, origin, user } from './auth-fixtures';

const expected = {
  instruments: [{ symbol: 'AAPL', name: 'Apple Inc.' }],
  traders: [{ id: user.id, displayName: 'JSMITH' }],
};

async function setup(role: CurrentUser['role'] = 'TRADER', result = expected, fail = false) {
  const auth = createAuthFixture();
  auth.users.get('jsmith@example.com')!.role = role;
  const now = new Date('2026-11-14T09:00:00Z');
  const token = 'a'.repeat(43);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const lastSeenAt = new Date(now.getTime() - 60_000);
  const calls = { options: 0 };
  await auth.repository.createSession({
    userId: user.id, tokenHash, lastSeenAt,
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
  });
  const trades: TradeRepository = {
    listSummaries: async () => { throw new Error('Unexpected summary lookup in this test.'); },
    listHistory: async () => { throw new Error('Unexpected history lookup in this test.'); },
    listFilterOptions: async () => {
      calls.options += 1;
      if (fail) throw new Error('Private database credentials');
      return result;
    },
    list: async () => { throw new Error('Options must not load trades.'); },
    create: async () => { throw new Error('Options must not create trades.'); },
    amend: async () => { throw new Error('Options must not amend trades.'); },
    cancel: async () => { throw new Error('Options must not cancel trades.'); },
  };
  const app = createApp({ auth: auth.repository, trades }, { origin, secureCookies: false, now: () => now });
  return {
    calls, auth, tokenHash, lastSeenAt, now,
    request: (authenticated = true) => app.request('/api/trades/filter-options', {
      headers: authenticated ? { Cookie: 'blotter_session=' + token } : {},
    }),
  };
}

test('filter options require a session before reading reference data', async () => {
  const h = await setup();
  const response = await h.request(false);
  assert.equal(response.status, 401);
  assert.equal(h.calls.options, 0);
});

test('an idle-expired session cannot read filter options', async () => {
  const h = await setup();
  h.auth.sessions.get(h.tokenHash)!.lastSeenAt = new Date(h.now.getTime() - SESSION_IDLE_TIMEOUT_MS);
  assert.equal((await h.request()).status, 401);
  assert.equal(h.calls.options, 0);
});

for (const role of ['TRADER', 'READ_ONLY'] as const) {
  test(`${role} can read the complete safe filter-options contract`, async () => {
    const optionsWithPrivateFields = {
      instruments: [{ ...expected.instruments[0]!, currency: 'USD' }],
      traders: [{ ...expected.traders[0]!, email: 'private@example.com', passwordHash: 'secret', role }],
    };
    const h = await setup(role, optionsWithPrivateFields);
    const response = await h.request();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), expected);
    assert.equal(h.calls.options, 1);
  });
}

test('empty reference tables return empty arrays', async () => {
  const h = await setup('TRADER', { instruments: [], traders: [] });
  const response = await h.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { instruments: [], traders: [] });
});

test('a reference-data failure returns the existing sanitized server error', async () => {
  const h = await setup('TRADER', expected, true);
  const response = await h.request();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
});

test('malformed repository output cannot escape as a successful lookup response', async () => {
  const h = await setup('TRADER', { ...expected, traders: [{ id: 'invalid-id', displayName: 'JSMITH' }] });
  const response = await h.request();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
});

test('automatic filter-option reads do not renew session idle time', async () => {
  const h = await setup();
  assert.equal((await h.request()).status, 200);
  assert.equal(h.auth.sessions.get(h.tokenHash)?.lastSeenAt.getTime(), h.lastSeenAt.getTime());
});
