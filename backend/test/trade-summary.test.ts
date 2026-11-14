import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app';
import type { CurrentUser } from '../src/auth/auth-contract';
import { SESSION_IDLE_TIMEOUT_MS } from '../src/auth/session-config';
import type { TradeRepository } from '../src/trades/trade-repository';
import type { SymbolSummary } from '../src/trades/summaries/trade-summary-contract';
import { createAuthFixture, origin, user } from './auth-fixtures';

const now = new Date('2026-11-15T09:00:00.000Z');
const summary: SymbolSummary = {
  instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: 'AAPL', currency: 'USD',
  buyQuantity: '100.000000', sellQuantity: '30.000000', netQuantity: '70.000000',
  buyValue: '22745.0000000000', sellValue: '6900.0000000000',
  version: 3, updatedAt: '2026-11-15T08:59:00.000Z',
};
const summaries: SymbolSummary[] = [summary, {
  ...summary, instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d06', symbol: 'MSFT',
  buyQuantity: '20.000000', sellQuantity: '50.000000', netQuantity: '-30.000000',
  buyValue: '8000.0000000000', sellValue: '20500.0000000000', version: 7,
}];
const serverError = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };

async function setup(options: { role?: CurrentUser['role']; result?: SymbolSummary[]; fail?: boolean } = {}) {
  const auth = createAuthFixture();
  auth.users.get('jsmith@example.com')!.role = options.role ?? 'TRADER';
  const token = 'a'.repeat(43);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const lastSeenAt = new Date(now.getTime() - 60_000);
  const calls = { summaries: 0 };
  await auth.repository.createSession({
    userId: user.id, tokenHash, lastSeenAt,
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
  });
  const trades: TradeRepository = {
    listSummaries: async () => {
      calls.summaries += 1;
      if (options.fail) throw new Error('Private database credentials');
      return options.result ?? summaries;
    },
    listHistory: async () => { throw new Error('Summary reads must not load history.'); },
    listFilterOptions: async () => { throw new Error('Summary reads must not load options.'); },
    list: async () => { throw new Error('Summary reads must not list trades.'); },
    create: async () => { throw new Error('Summary reads must not create trades.'); },
    amend: async () => { throw new Error('Summary reads must not amend trades.'); },
    cancel: async () => { throw new Error('Summary reads must not cancel trades.'); },
  };
  const app = createApp({ auth: auth.repository, trades }, { origin, secureCookies: false, now: () => now });
  return {
    calls, auth, tokenHash, lastSeenAt,
    request: (authenticated = true, background = false) => app.request('/api/summaries', {
      headers: {
        ...(authenticated ? { Cookie: 'blotter_session=' + token } : {}),
        ...(background ? { 'X-Session-Activity': 'background' } : {}),
      },
    }),
  };
}

test('summary reads require a session before calling the repository', async () => {
  const h = await setup();
  const response = await h.request(false);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { code: 'UNAUTHENTICATED', message: 'Please log in again.' });
  assert.equal(h.calls.summaries, 0);
});

for (const expiry of ['idle', 'absolute'] as const) {
  test(`${expiry}-expired sessions cannot read summaries, even in the background`, async () => {
    const h = await setup();
    const session = h.auth.sessions.get(h.tokenHash)!;
    if (expiry === 'idle') session.lastSeenAt = new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS);
    else session.expiresAt = now;
    assert.equal((await h.request(true, true)).status, 401);
    assert.equal(h.calls.summaries, 0);
  });
}

test('a revoked session cannot read summaries', async () => {
  const h = await setup();
  h.auth.sessions.delete(h.tokenHash);
  assert.equal((await h.request()).status, 401);
  assert.equal(h.calls.summaries, 0);
});

for (const role of ['TRADER', 'READ_ONLY'] as const) {
  test(`${role} receives the complete desk summary with exact decimal strings and metadata`, async () => {
    const h = await setup({ role });
    const response = await h.request();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { schemaVersion: 1, generatedAt: now.toISOString(), summaries });
    assert.equal(h.calls.summaries, 1);
  });
}

test('an empty summary returns a successful empty envelope', async () => {
  const h = await setup({ result: [] });
  const response = await h.request();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { schemaVersion: 1, generatedAt: now.toISOString(), summaries: [] });
});

test('summary repository failures return the existing sanitized server error', async () => {
  const h = await setup({ fail: true });
  const response = await h.request();
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), serverError);
});

test('malformed or duplicate summary rows cannot escape as a successful response', async () => {
  for (const result of [
    [{ ...summary, netQuantity: '70' }],
    [{ ...summary, email: 'private@example.com' }],
    [summary, summary],
  ]) {
    const h = await setup({ result });
    const response = await h.request();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), serverError);
  }
});

test('foreground summary reads record session activity', async () => {
  const h = await setup();
  assert.equal((await h.request()).status, 200);
  assert.equal(h.auth.sessions.get(h.tokenHash)?.lastSeenAt.getTime(), now.getTime());
});

test('background summary reads preserve the session idle deadline', async () => {
  const h = await setup();
  assert.equal((await h.request(true, true)).status, 200);
  assert.equal(h.auth.sessions.get(h.tokenHash)?.lastSeenAt.getTime(), h.lastSeenAt.getTime());
});
