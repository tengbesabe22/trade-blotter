import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { StrictMode } from 'react';
import App from '../src/App';
import { tradePage } from './trade-fixtures';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:5173',
});
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
});

// Bind the testing library to our DOM before importing its screen helpers.
const { render, screen, fireEvent, act, cleanup } = await import('@testing-library/react');
afterEach(() => cleanup());
after(() => dom.window.close());

const trader = { id: 'user-1', displayName: 'JSMITH', role: 'TRADER' };
const credentials = { email: 'jsmith@example.com', password: ' Password with spaces ' };

function withEmptyTrades(implementation: typeof fetch): typeof fetch {
  return async (url, options) => String(url).startsWith('/api/trades')
    ? Response.json(tradePage())
    : implementation(url, options);
}

async function showLogin(t: TestContext, implementation: typeof fetch) {
  const transport: typeof fetch = async (url, options) => {
    if (url === '/api/auth/me') {
      return Response.json({ code: 'UNAUTHENTICATED', message: 'Please log in again.' }, { status: 401 });
    }

    return implementation(url, options);
  };
  const fetchMock = t.mock.method(globalThis, 'fetch', withEmptyTrades(transport));
  render(<App />);
  await screen.findByLabelText('Email');
  return fetchMock;
}

function submitLogin() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: credentials.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: credentials.password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

test('login has labelled required fields and password-manager hints', async (t) => {
  await showLogin(t, async () => { throw new Error('Unexpected request.'); });

  const email = screen.getByLabelText('Email');
  const password = screen.getByLabelText('Password');
  assert.equal(email.getAttribute('type'), 'email');
  assert.equal(email.getAttribute('autocomplete'), 'username');
  assert.equal(email.hasAttribute('required'), true);
  assert.equal(password.getAttribute('type'), 'password');
  assert.equal(password.getAttribute('autocomplete'), 'current-password');
  assert.equal(password.hasAttribute('required'), true);
});

test('successful login posts entered credentials and shows the account and server role', async (t) => {
  const reviewer = { ...trader, displayName: 'REVIEWER', role: 'READ_ONLY' };
  const fetchMock = await showLogin(t, async () => Response.json({ user: reviewer }));
  submitLogin();

  await screen.findByText('REVIEWER');
  assert.ok(screen.getByText('Read-only reviewer'));
  assert.equal(screen.queryByLabelText('Password'), null);
  const loginCall = fetchMock.mock.calls.find((call) => call.arguments[0] === '/api/auth/login');
  assert.ok(loginCall);
  const [url, options] = loginCall.arguments;
  assert.equal(url, '/api/auth/login');
  assert.deepEqual(JSON.parse(String(options?.body)), credentials);
});

test('pending login disables submission and does not send a second request', async (t) => {
  let resolveResponse!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  const fetchMock = await showLogin(t, async () => pending);
  submitLogin();

  const button = screen.getByRole('button', { name: 'Signing in…' });
  assert.equal(button.hasAttribute('disabled'), true);
  fireEvent.click(button);
  assert.equal(fetchMock.mock.calls.filter((call) => call.arguments[0] === '/api/auth/login').length, 1);

  await act(async () => { resolveResponse(Response.json({ user: trader })); });
  await screen.findByText('JSMITH');
});

test('rejected credentials show the server message and allow retry without losing the email', async (t) => {
  await showLogin(t, async () => Response.json({
    code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.',
  }, { status: 401 }));
  submitLogin();

  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, 'Invalid email or password.');
  assert.equal((screen.getByLabelText('Email') as HTMLInputElement).value, credentials.email);
  assert.equal(screen.getByRole('button', { name: 'Sign in' }).hasAttribute('disabled'), false);
});

test('network failure shows a useful message and keeps the form usable', async (t) => {
  await showLogin(t, async () => { throw new TypeError('Failed to fetch'); });
  submitLogin();

  assert.equal((await screen.findByRole('alert')).textContent, 'Unable to connect. Please try again.');
  assert.equal(screen.getByRole('button', { name: 'Sign in' }).hasAttribute('disabled'), false);
});

test('logout waits for the server before returning to a fresh login form', async (t) => {
  let resolveLogout!: (response: Response) => void;
  const pendingLogout = new Promise<Response>((resolve) => { resolveLogout = resolve; });
  const fetchMock = await showLogin(t, async (url) => url === '/api/auth/logout'
    ? pendingLogout
    : Response.json({ user: trader }));
  submitLogin();
  await screen.findByText('JSMITH');

  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  assert.equal(screen.getByRole('button', { name: 'Signing out…' }).hasAttribute('disabled'), true);
  assert.ok(screen.getByText('JSMITH'));

  await act(async () => { resolveLogout(new Response(null, { status: 204 })); });
  const email = await screen.findByLabelText('Email');
  assert.equal((email as HTMLInputElement).value, '');
  assert.equal(fetchMock.mock.calls.at(-1)?.arguments[0], '/api/auth/logout');
});

test('failed logout keeps the account visible and offers another attempt', async (t) => {
  await showLogin(t, async (url) => url === '/api/auth/logout'
    ? Response.json({ code: 'INTERNAL_ERROR', message: 'Please try signing out again.' }, { status: 500 })
    : Response.json({ user: trader }));
  submitLogin();
  await screen.findByText('JSMITH');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

  assert.equal((await screen.findByRole('alert')).textContent, 'Please try signing out again.');
  assert.ok(screen.getByText('JSMITH'));
  assert.equal(screen.getByRole('button', { name: 'Sign out' }).hasAttribute('disabled'), false);
});


test('session restoration shows a checking state without flashing the login form', async (t) => {
  let resolveSession!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveSession = resolve; });
  const fakeFetch: typeof fetch = async () => pending;
  const fetchMock = t.mock.method(globalThis, 'fetch', withEmptyTrades(fakeFetch));
  render(<App />);

  assert.match(screen.getByRole('status').textContent ?? '', /Checking your session/);
  assert.equal(screen.queryByLabelText('Email'), null);
  assert.equal(fetchMock.mock.calls[0].arguments[0], '/api/auth/me');

  await act(async () => { resolveSession(Response.json({ user: trader })); });
  await screen.findByText('JSMITH');
  assert.equal(screen.queryByLabelText('Password'), null);
});

test('a fresh app mount restores the account again using me', async (t) => {
  const fakeFetch: typeof fetch = async () => Response.json({ user: trader });
  const fetchMock = t.mock.method(globalThis, 'fetch', withEmptyTrades(fakeFetch));
  const first = render(<App />);
  await screen.findByText('JSMITH');
  first.unmount();

  render(<App />);
  await screen.findByText('JSMITH');

  assert.equal(fetchMock.mock.calls.filter((call) => call.arguments[0] === '/api/auth/me').length, 2);
});

test('an absent or expired session shows the login form without an error', async (t) => {
  const fakeFetch: typeof fetch = async () => Response.json({
    code: 'UNAUTHENTICATED', message: 'Please log in again.',
  }, { status: 401 });
  const fetchMock = t.mock.method(globalThis, 'fetch', withEmptyTrades(fakeFetch));
  render(<App />);

  await screen.findByLabelText('Email');
  assert.equal(screen.queryByRole('alert'), null);
  assert.equal(fetchMock.mock.calls.length, 1);
});

const failedSessionChecks = [
  { name: 'server error', fail: async () => Response.json({ code: 'INTERNAL_ERROR', message: 'Failed.' }, { status: 500 }) },
  { name: 'network failure', fail: async () => { throw new TypeError('Failed to fetch'); } },
  { name: 'invalid response', fail: async () => Response.json({ user: { ...trader, role: 'UNKNOWN' } }) },
];

for (const { name, fail } of failedSessionChecks) {
  test(`${name} during restoration offers retry instead of pretending the user is signed out`, async (t) => {
    let attempts = 0;
    const fakeFetch: typeof fetch = async () => {
      attempts += 1;
      return attempts === 1 ? fail() : Response.json({ user: trader });
    };
    t.mock.method(globalThis, 'fetch', withEmptyTrades(fakeFetch));
    render(<App />);

    await screen.findByRole('alert');
    assert.equal(screen.queryByLabelText('Email'), null);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByText('JSMITH');
    assert.equal(attempts, 2);
  });
}

test('an obsolete Strict Mode session check cannot sign the user back in after logout', async (t) => {
  let resolveOldCheck!: (response: Response) => void;
  const oldCheck = new Promise<Response>((resolve) => { resolveOldCheck = resolve; });
  let sessionChecks = 0;
  const fakeFetch: typeof fetch = async (url) => {
    if (url === '/api/auth/logout') return new Response(null, { status: 204 });
    sessionChecks += 1;
    return sessionChecks === 1 ? oldCheck : Response.json({ user: trader });
  };
  const fetchMock = t.mock.method(globalThis, 'fetch', withEmptyTrades(fakeFetch));
  render(<StrictMode><App /></StrictMode>);
  await screen.findByText('JSMITH');
  assert.equal(fetchMock.mock.calls[0].arguments[1]?.signal?.aborted, true);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByLabelText('Email');

  await act(async () => { resolveOldCheck(Response.json({ user: trader })); });

  assert.ok(screen.getByLabelText('Email'));
  assert.equal(screen.queryByText('JSMITH'), null);
});
