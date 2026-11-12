import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import App from '../src/App';

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

function mockFetch(t: TestContext, implementation: typeof fetch) {
  return t.mock.method(globalThis, 'fetch', implementation);
}

function submitLogin() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: credentials.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: credentials.password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

test('login has labelled required fields and password-manager hints', () => {
  render(<App />);

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
  const fetchMock = mockFetch(t, async () => Response.json({ user: reviewer }));
  render(<App />);
  submitLogin();

  await screen.findByText('REVIEWER');
  assert.ok(screen.getByText('Read-only reviewer'));
  assert.equal(screen.queryByLabelText('Password'), null);
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, '/api/auth/login');
  assert.deepEqual(JSON.parse(String(options?.body)), credentials);
});

test('pending login disables submission and does not send a second request', async (t) => {
  let resolveResponse!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  const fetchMock = mockFetch(t, async () => pending);
  render(<App />);
  submitLogin();

  const button = screen.getByRole('button', { name: 'Signing in…' });
  assert.equal(button.hasAttribute('disabled'), true);
  fireEvent.click(button);
  assert.equal(fetchMock.mock.calls.length, 1);

  await act(async () => { resolveResponse(Response.json({ user: trader })); });
  await screen.findByText('JSMITH');
});

test('rejected credentials show the server message and allow retry without losing the email', async (t) => {
  mockFetch(t, async () => Response.json({
    code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.',
  }, { status: 401 }));
  render(<App />);
  submitLogin();

  const alert = await screen.findByRole('alert');
  assert.equal(alert.textContent, 'Invalid email or password.');
  assert.equal((screen.getByLabelText('Email') as HTMLInputElement).value, credentials.email);
  assert.equal(screen.getByRole('button', { name: 'Sign in' }).hasAttribute('disabled'), false);
});

test('network failure shows a useful message and keeps the form usable', async (t) => {
  mockFetch(t, async () => { throw new TypeError('Failed to fetch'); });
  render(<App />);
  submitLogin();

  assert.equal((await screen.findByRole('alert')).textContent, 'Unable to connect. Please try again.');
  assert.equal(screen.getByRole('button', { name: 'Sign in' }).hasAttribute('disabled'), false);
});

test('logout waits for the server before returning to a fresh login form', async (t) => {
  let resolveLogout!: (response: Response) => void;
  const pendingLogout = new Promise<Response>((resolve) => { resolveLogout = resolve; });
  const fetchMock = mockFetch(t, async (url) => url === '/api/auth/logout'
    ? pendingLogout
    : Response.json({ user: trader }));
  render(<App />);
  submitLogin();
  await screen.findByText('JSMITH');

  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  assert.equal(screen.getByRole('button', { name: 'Signing out…' }).hasAttribute('disabled'), true);
  assert.ok(screen.getByText('JSMITH'));

  await act(async () => { resolveLogout(new Response(null, { status: 204 })); });
  const email = await screen.findByLabelText('Email');
  assert.equal((email as HTMLInputElement).value, '');
  assert.equal(fetchMock.mock.calls[1].arguments[0], '/api/auth/logout');
});

test('failed logout keeps the account visible and offers another attempt', async (t) => {
  mockFetch(t, async (url) => url === '/api/auth/logout'
    ? Response.json({ code: 'INTERNAL_ERROR', message: 'Please try signing out again.' }, { status: 500 })
    : Response.json({ user: trader }));
  render(<App />);
  submitLogin();
  await screen.findByText('JSMITH');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

  assert.equal((await screen.findByRole('alert')).textContent, 'Please try signing out again.');
  assert.ok(screen.getByText('JSMITH'));
  assert.equal(screen.getByRole('button', { name: 'Sign out' }).hasAttribute('disabled'), false);
});
