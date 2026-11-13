import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Hono } from 'hono';
import { createApp } from '../src/app';
import type { AuthRepository } from '../src/auth/auth-repository';
import type { AuthEnv } from '../src/auth/auth-contract';
import { requireSession, requireTrader } from '../src/auth/auth-middleware';
import { createAuthFixture, origin, password, user } from './auth-fixtures';

const minute = 60 * 1000;
const hour = 60 * minute;

async function setup(overrides: Partial<AuthRepository> = {}) {
  const fixture = createAuthFixture();
  let time = Date.parse('2026-11-11T09:00:00Z');
  const options = { origin, secureCookies: false, now: () => new Date(time) };
  const token = 'a'.repeat(43);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const cookie = `blotter_session=${token}`;

  await fixture.repository.createSession({
    userId: user.id,
    tokenHash,
    lastSeenAt: options.now(),
    expiresAt: new Date(time + 8 * hour),
  });

  const repository = { ...fixture.repository, ...overrides };
  const app = createApp(
    {
      auth: repository,
      trades: {
        list: async () => ({ records: [], hasNextPage: false }),
        create: async () => {
          throw new Error('Unexpected trade creation in auth test.');
        },
      },
    },
    options,
  );

  function request(path = '/api/auth/me', init: RequestInit = {}) {
    const headers = new Headers({ Cookie: cookie, Origin: origin });
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));

    return app.request(path, { ...init, headers });
  }

  return {
    ...fixture,
    app,
    repository,
    options,
    cookie,
    tokenHash,
    request,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

test('/me returns safe account fields and records authenticated activity', async () => {
  const h = await setup();
  h.advance(minute);

  const response = await h.request();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    user: { id: user.id, displayName: user.displayName, role: 'TRADER' },
  });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(h.sessions.get(h.tokenHash)!.lastSeenAt.getTime(), h.options.now().getTime());
});

test('idle sessions expire at exactly five minutes and cannot be revived', async () => {
  const h = await setup();
  const before = h.sessions.get(h.tokenHash)!.lastSeenAt.getTime();
  h.advance(5 * minute);

  for (let i = 0; i < 2; i += 1) {
    const response = await h.request();

    assert.equal(response.status, 401);
    assert.match(response.headers.get('Set-Cookie')!, /Max-Age=0/i);
    assert.match(response.headers.get('Set-Cookie')!, /Path=\/api/i);
  }
  assert.equal(h.sessions.get(h.tokenHash)!.lastSeenAt.getTime(), before);
});

test('activity before the idle deadline renews idle time without changing the hard expiry', async () => {
  const h = await setup();
  const expiresAt = h.sessions.get(h.tokenHash)!.expiresAt.getTime();
  h.advance(5 * minute - 1);

  assert.equal((await h.request()).status, 200);

  h.advance(5 * minute);

  assert.equal((await h.request()).status, 401);
  assert.equal(h.sessions.get(h.tokenHash)!.expiresAt.getTime(), expiresAt);
});

test('the eight-hour maximum expires even when activity was recent', async () => {
  const h = await setup();
  h.advance(8 * hour - minute);
  h.sessions.get(h.tokenHash)!.lastSeenAt = h.options.now();
  h.advance(minute);

  assert.equal((await h.request()).status, 401);
});

test('missing, malformed, bearer, and URL tokens do not authenticate', async () => {
  const h = await setup();
  const responses = [
    await h.app.request('/api/auth/me'),
    await h.app.request('/api/auth/me', { headers: { Authorization: `Bearer ${'a'.repeat(43)}` } }),
    await h.app.request(`/api/auth/me?token=${'a'.repeat(43)}`),
  ];

  for (const token of ['bad', '%ZZ', 'a'.repeat(44)]) {
    responses.push(
      await h.request('/api/auth/me', { headers: { Cookie: `blotter_session=${token}` } }),
    );
  }

  for (const response of responses) {
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('an unknown well-formed session token is rejected', async () => {
  const h = await setup();
  const response = await h.request('/api/auth/me', {
    headers: { Cookie: `blotter_session=${'b'.repeat(43)}` },
  });

  assert.equal(response.status, 401);
});

test('/me loads the current account role instead of trusting cookie claims', async () => {
  const h = await setup();
  h.users.get('jsmith@example.com')!.role = 'READ_ONLY';

  const response = await h.request();

  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.role, 'READ_ONLY');
});

test('logout revokes the current session and repeated logout is harmless', async () => {
  const h = await setup();

  const response = await h.request('/api/auth/logout', { method: 'POST' });

  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.match(response.headers.get('Set-Cookie')!, /Max-Age=0/i);
  assert.match(response.headers.get('Set-Cookie')!, /HttpOnly/i);
  assert.equal(h.sessions.has(h.tokenHash), false);
  assert.equal((await h.request()).status, 401);
  assert.equal((await h.request('/api/auth/logout', { method: 'POST' })).status, 204);
});

test('logout without a valid token succeeds without a database delete', async () => {
  const h = await setup({
    deleteSession: async () => {
      throw new Error('Unexpected delete');
    },
  });
  const missing = await h.app.request('/api/auth/logout', {
    method: 'POST',
    headers: { Origin: origin },
  });
  const malformed = await h.request('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: 'blotter_session=invalid' },
  });

  assert.equal(missing.status, 204);
  assert.equal(malformed.status, 204);
});

test('logout rejects missing and untrusted origins without revoking the session', async () => {
  const h = await setup();
  const missing = await h.app.request('/api/auth/logout', {
    method: 'POST',
    headers: { Cookie: h.cookie },
  });

  assert.equal(missing.status, 403);

  for (const requestOrigin of ['https://evil.example', 'null']) {
    const response = await h.request('/api/auth/logout', {
      method: 'POST',
      headers: { Origin: requestOrigin },
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
  assert.equal(h.sessions.has(h.tokenHash), true);
});

test('a session lookup failure is a sanitized server error rather than an expiry', async () => {
  const h = await setup({
    findSession: async () => {
      throw new Error('Private database details');
    },
  });
  const response = await h.request();

  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, 'INTERNAL_ERROR');
  assert.equal(response.headers.get('Set-Cookie'), null);
});

test('a session revoked between lookup and activity update is rejected', async () => {
  const h = await setup();
  h.repository.touchSession = async () => {
    h.sessions.delete(h.tokenHash);
    return false;
  };

  const response = await h.request();

  assert.equal(response.status, 401);
  assert.equal(h.sessions.size, 0);
});

test('an activity update failure returns a server error without pretending logout succeeded', async () => {
  const h = await setup({
    touchSession: async () => {
      throw new Error('Private database details');
    },
  });
  const response = await h.request();

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Set-Cookie'), null);
});

test('logout reports database failure without clearing a still-valid cookie', async () => {
  const h = await setup({
    deleteSession: async () => {
      throw new Error('Private database details');
    },
  });
  const response = await h.request('/api/auth/logout', { method: 'POST' });

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(h.sessions.has(h.tokenHash), true);
});

test('background/stream validation does not renew idle time', async () => {
  const h = await setup();
  const app = new Hono<AuthEnv>();
  app.get('/stream-check', requireSession(h.repository, h.options, { recordActivity: false }), (c) =>
    c.text('ok'),
  );
  const before = h.sessions.get(h.tokenHash)!.lastSeenAt.getTime();
  h.advance(minute);

  assert.equal((await app.request('/stream-check', { headers: { Cookie: h.cookie } })).status, 200);
  assert.equal(h.sessions.get(h.tokenHash)!.lastSeenAt.getTime(), before);

  h.advance(4 * minute);

  assert.equal((await app.request('/stream-check', { headers: { Cookie: h.cookie } })).status, 401);
});

test('the trader guard allows traders and denies reviewers after authentication', async () => {
  const h = await setup();
  const app = new Hono<AuthEnv>();
  app.post('/write-check', requireSession(h.repository, h.options), requireTrader, (c) => c.text('ok'));

  assert.equal(
    (await app.request('/write-check', { method: 'POST', headers: { Cookie: h.cookie } })).status,
    200,
  );

  h.users.get('jsmith@example.com')!.role = 'READ_ONLY';

  assert.equal(
    (await app.request('/write-check', { method: 'POST', headers: { Cookie: h.cookie } })).status,
    403,
  );
  assert.equal((await app.request('/write-check', { method: 'POST' })).status, 401);
});

test('a new login cookie works for /me and logout only revokes that login', async () => {
  const h = await setup();
  const login = await h.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'jsmith@example.com', password }),
  });
  const cookie = login.headers.get('Set-Cookie')!.split(';')[0];

  assert.equal(login.status, 200);
  assert.equal((await h.request('/api/auth/me', { headers: { Cookie: cookie } })).status, 200);
  assert.equal(
    (await h.request('/api/auth/logout', { method: 'POST', headers: { Cookie: cookie } })).status,
    204,
  );
  assert.equal((await h.request('/api/auth/me', { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await h.request()).status, 200); // The original independent session remains valid.
});

test('background trade snapshots validate the session without extending idle expiry', async () => {
  const h = await setup();
  const original = h.sessions.get(h.tokenHash)!.lastSeenAt.getTime();
  const background = { headers: { 'X-Session-Activity': 'background' } };

  h.advance(minute);
  assert.equal((await h.request('/api/trades', background)).status, 200);
  h.advance(3 * minute);
  assert.equal((await h.request('/api/trades', background)).status, 200);
  assert.equal(h.sessions.get(h.tokenHash)!.lastSeenAt.getTime(), original);

  h.advance(minute);
  assert.equal((await h.request('/api/trades', background)).status, 401);
});

test('normal, explicit user and unknown activity headers still renew idle time', async () => {
  for (const activity of [undefined, 'user', 'unknown']) {
    const h = await setup();
    const expiresAt = h.sessions.get(h.tokenHash)!.expiresAt.getTime();
    h.advance(minute);
    const headers = new Headers();
    if (activity) headers.set('X-Session-Activity', activity);

    assert.equal((await h.request('/api/trades', { headers })).status, 200);
    assert.equal(h.sessions.get(h.tokenHash)!.lastSeenAt.getTime(), h.options.now().getTime());
    assert.equal(h.sessions.get(h.tokenHash)!.expiresAt.getTime(), expiresAt);
  }
});

test('the background hint cannot bypass missing, revoked or expired sessions', async () => {
  for (const reason of ['missing', 'revoked', 'idle', 'maximum']) {
    const h = await setup();
    const headers = new Headers({ 'X-Session-Activity': 'background' });
    if (reason === 'missing') headers.set('Cookie', '');
    if (reason === 'revoked') h.sessions.clear();
    if (reason === 'idle') h.advance(5 * minute);
    if (reason === 'maximum') {
      h.advance(8 * hour);
      h.sessions.get(h.tokenHash)!.lastSeenAt = h.options.now(); // Isolate hard expiry.
    }
    assert.equal((await h.request('/api/trades', { headers })).status, 401);
  }
});
