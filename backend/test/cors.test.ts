import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app';
import { createAuthFixture } from './auth-fixtures';

const origin = 'https://app.teng.website';

function setup() {
  const auth = createAuthFixture();
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected trade access.'); };
  const app = createApp({
    auth: auth.repository,
    trades: {
      list: unexpected, create: unexpected, amend: unexpected, cancel: unexpected,
      listHistory: unexpected, listSummaries: unexpected, listFilterOptions: unexpected,
    },
  }, { origin, secureCookies: true });
  return { app, auth };
}

test('CORS allows the configured frontend to read an unauthenticated error', async () => {
  const { app } = setup();
  const response = await app.request('/api/auth/me', { headers: { Origin: origin } });

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.match(response.headers.get('Vary') ?? '', /Origin/i);
  assert.equal((await response.json()).code, 'UNAUTHENTICATED');
});

for (const [path, method, headers] of [
  ['/api/auth/login', 'POST', ['content-type']],
  ['/api/trades', 'POST', ['content-type', 'idempotency-key']],
  ['/api/trades/trade-id', 'PATCH', ['content-type']],
  ['/api/trades', 'GET', ['x-session-activity']],
] as const) {
  test(`CORS handles ${method} ${path} preflight before authentication`, async () => {
    const { app, auth } = setup();
    const response = await app.request(path, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': headers.join(','),
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Max-Age'), '600');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
    assert.ok(response.headers.get('Access-Control-Allow-Methods')?.split(',').includes(method));
    const allowed = response.headers.get('Access-Control-Allow-Headers')?.toLowerCase().split(',') ?? [];
    for (const header of headers) assert.ok(allowed.includes(header));
    assert.deepEqual(auth.lookups, []);
    assert.equal(auth.createdSessions.length, 0);
  });
}

test('CORS grants no browser access to untrusted origins', async () => {
  const { app } = setup();
  for (const untrusted of ['https://evil.example', `${origin}.evil.example`, 'null']) {
    const response = await app.request('/api/health', { headers: { Origin: untrusted } });
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('CORS preserves trusted-Origin enforcement for mutations', async () => {
  const { app } = setup();
  const response = await app.request('/api/auth/logout', {
    method: 'POST', headers: { Origin: 'https://evil.example' },
  });

  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await response.json()).code, 'FORBIDDEN_ORIGIN');
});

test('CORS makes validation errors readable to the configured frontend', async () => {
  const { app } = setup();
  const response = await app.request('/api/auth/login', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{',
  });

  assert.equal(response.status, 400);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
});


test('CORS makes sanitized server errors readable to the configured frontend', async () => {
  const { app, auth } = setup();
  auth.repository.findUser = async () => { throw new Error('Private database detail'); };
  const response = await app.request('/api/auth/login', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'jsmith@example.com', password: 'password' }),
  });

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
  assert.deepEqual(await response.json(), {
    code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.',
  });
});
