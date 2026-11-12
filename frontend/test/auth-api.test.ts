import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ApiError } from '../src/api/api-client';
import { authApi } from '../src/api/auth-api';

const user = { id: 'user-1', displayName: 'JSMITH', role: 'TRADER' };

function stubResponse(t: TestContext, response: Response) {
  const fakeFetch: typeof fetch = async () => response;
  return t.mock.method(globalThis, 'fetch', fakeFetch);
}

test('login posts unchanged credentials through /api and validates the returned user', async (t) => {
  const fetchMock = stubResponse(t, Response.json({ user }));
  const credentials = { email: 'jsmith@example.com', password: ' Password with spaces ' };

  assert.deepEqual(await authApi.login(credentials), { user });

  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, '/api/auth/login');
  assert.equal(options?.method, 'POST');
  assert.equal(options?.credentials, 'same-origin');
  assert.equal(new Headers(options?.headers).get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(String(options?.body)), credentials);
});

test('me loads the current account using the browser session cookie', async (t) => {
  const fetchMock = stubResponse(t, Response.json({ user }));

  assert.deepEqual(await authApi.me(), { user });

  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, '/api/auth/me');
  assert.equal(options?.method ?? 'GET', 'GET');
  assert.equal(options?.credentials, 'same-origin');
});

test('logout posts with the session cookie and accepts an empty 204 response', async (t) => {
  const fetchMock = stubResponse(t, new Response(null, { status: 204 }));

  assert.equal(await authApi.logout(), undefined);

  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, '/api/auth/logout');
  assert.equal(options?.method, 'POST');
  assert.equal(options?.credentials, 'same-origin');
});

test('HTTP failures preserve the server error code, status, and safe message', async (t) => {
  stubResponse(t, Response.json({
    code: 'UNAUTHENTICATED', message: 'Please log in again.',
  }, { status: 401 }));

  await assert.rejects(authApi.me(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, 'UNAUTHENTICATED');
    assert.equal(error.message, 'Please log in again.');
    return true;
  });
});

test('non-JSON HTTP failures produce a useful fallback rather than leaking an HTML page', async (t) => {
  stubResponse(t, new Response('<html>Upstream failed</html>', { status: 502 }));

  await assert.rejects(authApi.me(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 502);
    assert.equal(error.code, 'REQUEST_FAILED');
    assert.equal(error.message, 'The request failed. Please try again.');
    return true;
  });
});

test('invalid success payloads are rejected before reaching UI state', async (t) => {
  stubResponse(t, Response.json({ user: { ...user, role: 'UNKNOWN' } }));

  await assert.rejects(authApi.me(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'INVALID_RESPONSE');
    return true;
  });
});

test('network failures propagate to the caller for UI error handling', async (t) => {
  const failure = new TypeError('Failed to fetch');
  const fakeFetch: typeof fetch = async () => { throw failure; };
  t.mock.method(globalThis, 'fetch', fakeFetch);

  await assert.rejects(authApi.me(), (error) => error === failure);
});
