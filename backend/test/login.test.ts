import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app';
import type { AuthRepository } from '../src/auth/auth-repository';
import { verifyPassword } from '../src/auth/password-utils';
import { createAuthFixture, origin, password, user } from './auth-fixtures';

const credentials = { email: 'jsmith@example.com', password };

function setup(overrides: Partial<AuthRepository> = {}, secureCookies = false) {
  const fixture = createAuthFixture();
  const app = createApp(
    {
      auth: { ...fixture.repository, ...overrides },
      trades: {
        list: async () => [],
        create: async () => {
          throw new Error('Unexpected trade creation in auth test.');
        },
      },
    },
    { origin, secureCookies },
  );

  return { app, sessions: fixture.createdSessions, lookups: fixture.lookups };
}

function login(
  app: ReturnType<typeof createApp>,
  body: unknown = credentials,
  requestOrigin: string | null = origin,
  contentType = 'application/json',
) {
  const headers = new Headers({ 'Content-Type': contentType });
  if (requestOrigin !== null) headers.set('Origin', requestOrigin);
  return app.request('/api/auth/login', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('login normalizes email, persists only the token hash, and returns safe user fields', async () => {
  const { app, sessions, lookups } = setup();
  const before = Date.now();
  const response = await login(app, { ...credentials, email: '  JSMITH@EXAMPLE.COM  ' });

  assert.equal(response.status, 200);
  assert.deepEqual(lookups, ['jsmith@example.com']);
  assert.deepEqual(await response.json(), {
    user: { id: user.id, displayName: 'JSMITH', role: 'TRADER' },
  });

  const cookie = response.headers.get('Set-Cookie')!;
  const token = /^blotter_session=([A-Za-z0-9_-]{43});/.exec(cookie)![1];
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\/api/i);
  assert.match(cookie, /Max-Age=28800/i);
  assert.doesNotMatch(cookie, /; Secure/i);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].userId, user.id);
  assert.equal(sessions[0].tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(sessions[0].tokenHash, token);
  assert.ok(sessions[0].expiresAt.getTime() >= before + 8 * 60 * 60 * 1000);
  assert.ok(sessions[0].expiresAt.getTime() <= Date.now() + 8 * 60 * 60 * 1000);
});

test('unknown email and wrong password return the same error and create no session', async () => {
  const { app, sessions } = setup();
  const wrong = await login(app, { ...credentials, password: 'wrong password' });
  const unknown = await login(app, { email: 'missing@example.com', password });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json());
  assert.equal(wrong.headers.get('Set-Cookie'), null);
  assert.equal(unknown.headers.get('Set-Cookie'), null);
  assert.equal(sessions.length, 0);
});

test('invalid bodies and unsupported content types fail before database access', async () => {
  const { app, lookups } = setup();
  for (const body of [
    '{',
    null,
    [],
    {},
    { email: credentials.email },
    { password },
    { email: 42, password },
    { email: 'invalid', password },
    { email: '   ', password },
    { email: 'a'.repeat(109) + '@example.com', password },
    { ...credentials, password: null },
    { ...credentials, password: '' },
    { ...credentials, password: 'a'.repeat(1025) },
    { ...credentials, password: '😀'.repeat(257) },
  ]) {
    assert.equal((await login(app, body)).status, 400);
  }
  assert.equal((await login(app, credentials, origin, 'text/plain')).status, 400);
  assert.deepEqual(lookups, []);
});

test('oversized JSON is rejected', async () => {
  const { app, lookups } = setup();
  assert.equal((await login(app, { ...credentials, password: 'a'.repeat(5000) })).status, 413);
  assert.deepEqual(lookups, []);
});

test('untrusted, null, and missing origins are rejected before database access', async () => {
  const { app, lookups } = setup();
  for (const requestOrigin of ['https://evil.example', `${origin}.evil.example`, 'null', null]) {
    assert.equal((await login(app, credentials, requestOrigin)).status, 403);
  }
  assert.deepEqual(lookups, []);
});

test('a failed session insert produces a sanitized error and no cookie', async () => {
  const { app } = setup({
    createSession: async () => {
      throw new Error('private database detail');
    },
  });
  const response = await login(app);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  });
  assert.equal(response.headers.get('Set-Cookie'), null);
});

test('production cookie configuration adds Secure', async () => {
  const { app } = setup({}, true);
  const response = await login(app);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie')!, /; Secure/i);
});

test('reviewer login returns the database role even if the client submits another role', async () => {
  const { app } = setup({ findUser: async () => ({ ...user, role: 'READ_ONLY' }) });

  const response = await login(app, { ...credentials, role: 'TRADER', userId: 'forged-user-id' });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.role, 'READ_ONLY');
});

test('every successful login generates a fresh session token', async () => {
  const { app, sessions } = setup();
  const first = await login(app);
  const second = await login(app);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(sessions[0].tokenHash, sessions[1].tokenHash);
});

test('unsupported stored hash formats are rejected safely', async () => {
  assert.equal(await verifyPassword(password, 'invalid'), false);
  assert.equal(
    await verifyPassword(password, user.passwordHash.replace('131072', '999999999')),
    false,
  );
});

test('a failed user lookup creates no session or cookie and hides database details', async () => {
  const { app, sessions } = setup({
    findUser: async () => {
      throw new Error('private connection detail');
    },
  });

  const response = await login(app);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  });
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(sessions.length, 0);
});

test('valid email and UTF-8 password boundaries reach authentication with JSON charset', async () => {
  const { app, lookups, sessions } = setup();
  const email = 'a'.repeat(108) + '@example.com'; // Exactly 120 characters.
  const password = 'é'.repeat(512); // Exactly 1024 UTF-8 bytes.

  const response = await login(app, { email, password }, origin, 'application/json; charset=UTF-8');

  // The unknown account fails authentication, rather than input validation.
  assert.equal(response.status, 401);
  assert.deepEqual(lookups, [email]);
  assert.equal(sessions.length, 0);
});

test('password whitespace is significant', async () => {
  assert.equal(await verifyPassword(password.trim(), user.passwordHash), false);
});

test('login preserves the existing email syntax and UTF-16 length boundaries', async () => {
  const { app, lookups } = setup();
  const allowedEmail = 'first..last@example.com';
  const longEmail = '😀'.repeat(55) + '@example.com'; // 122 UTF-16 code units.

  // Keep the current format rule; switching to a stricter email validator is separate work.
  assert.equal((await login(app, { email: allowedEmail, password })).status, 401);
  assert.equal((await login(app, { email: longEmail, password })).status, 400);
  assert.deepEqual(lookups, [allowedEmail]);
});
