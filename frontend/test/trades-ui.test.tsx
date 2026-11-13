import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import App from '../src/App';
import { signedInTrader, sampleTrade, cancelledTrade } from './trade-fixtures';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:5173',
  pretendToBeVisual: true,
});

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  Element: { configurable: true, value: dom.window.Element },
  MutationObserver: { configurable: true, value: dom.window.MutationObserver },
  getComputedStyle: { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) },
  requestAnimationFrame: { configurable: true, value: dom.window.requestAnimationFrame.bind(dom.window) },
  cancelAnimationFrame: { configurable: true, value: dom.window.cancelAnimationFrame.bind(dom.window) },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
});

const { render, screen, fireEvent, act, cleanup, waitFor } = await import('@testing-library/react');
afterEach(() => cleanup());
after(() => dom.window.close());

function showTrades(t: TestContext, tradeTransport: typeof fetch, role = 'TRADER') {
  const transport: typeof fetch = async (url, options) => {
    if (url === '/api/auth/me' || url === '/api/auth/login') {
      return Response.json({ user: { ...signedInTrader, role } });
    }

    if (url === '/api/auth/logout') return new Response(null, { status: 204 });
    assert.equal(url, '/api/trades');
    return tradeTransport(url, options);
  };

  const fetchMock = t.mock.method(globalThis, 'fetch', transport);
  render(<App />);
  return fetchMock;
}

test('trades show a loading state without an empty-state flash', async (t) => {
  let resolveTrades!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveTrades = resolve; });
  showTrades(t, async () => pending);

  await screen.findByText('Loading trades…');
  assert.equal(screen.queryByText('No trades yet'), null);
  assert.equal(screen.getByRole('button', { name: 'Refresh trades' }).hasAttribute('disabled'), true);

  await act(async () => { resolveTrades(Response.json({ trades: [] })); });
  await screen.findByText('No trades yet');
});

test('a reviewer can view populated trade rows with exact quantities and clear display guidance', async (t) => {
  showTrades(t, async () => Response.json({ trades: [sampleTrade, cancelledTrade] }), 'READ_ONLY');

  await screen.findByText('2 trades');
  assert.ok(await screen.findByText('AAPL'));
  assert.ok(screen.getByText('MSFT'));
  assert.ok(screen.getByText('5000.000001'));
  assert.ok(screen.getByText('BUY'));
  assert.ok(screen.getByText('SELL'));
  assert.ok(screen.getByText('Read-only reviewer'));
  assert.ok(screen.getByText(/Prices in USD/));
  assert.ok(screen.getByText(/Scroll horizontally/));
});

test('an empty successful response shows a useful empty state', async (t) => {
  showTrades(t, async () => Response.json({ trades: [] }));

  await screen.findByText('No trades yet');
  assert.ok(screen.getByText('0 trades'));
  assert.equal(screen.queryByRole('alert'), null);
});

for (const failure of ['network', 'server', 'invalid response']) {
  test(`initial ${failure} failure offers a working retry`, async (t) => {
    let attempts = 0;
    showTrades(t, async () => {
      attempts += 1;
      if (attempts > 1) return Response.json({ trades: [] });
      if (failure === 'network') throw new TypeError('Failed to fetch');
      if (failure === 'invalid response') return Response.json({ trades: [null] });
      return Response.json({ code: 'INTERNAL_ERROR', message: 'Failed.' }, { status: 500 });
    });

    await screen.findByRole('alert');
    assert.equal(screen.queryByText('No trades yet'), null);
    assert.equal(attempts, 1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' }));
    await screen.findByText('No trades yet');
    assert.equal(attempts, 2);
  });
}

test('refresh keeps existing rows, prevents duplicate requests, and warns if it fails', async (t) => {
  let attempts = 0;
  let resolveRefresh!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveRefresh = resolve; });
  showTrades(t, async () => {
    attempts += 1;
    if (attempts === 1) return Response.json({ trades: [sampleTrade] });
    if (attempts === 2) return pending;
    return Response.json({ trades: [cancelledTrade] });
  });
  await screen.findByText('AAPL');

  fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' }));
  const refreshButton = await screen.findByRole('button', { name: 'Refreshing…' });
  assert.equal(refreshButton.hasAttribute('disabled'), true);
  assert.ok(screen.getByText('AAPL'));
  fireEvent.click(refreshButton);
  assert.equal(attempts, 2);

  await act(async () => {
    resolveRefresh(Response.json({ code: 'INTERNAL_ERROR', message: 'Failed.' }, { status: 500 }));
  });
  assert.match((await screen.findByRole('alert')).textContent ?? '', /Showing the last loaded data/);
  assert.ok(screen.getByText('AAPL'));
  assert.equal(screen.getByRole('button', { name: 'Refresh trades' }).hasAttribute('disabled'), false);

  fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' }));
  await screen.findByText('MSFT');
  // AG Grid removes outgoing rows after its transition completes.
  await waitFor(() => assert.equal(screen.queryByText('AAPL') === null, true));
  assert.equal(attempts, 3);
});

test('an expired session hides cached trades and offers sign-in instead of a generic retry', async (t) => {
  let attempts = 0;
  showTrades(t, async () => {
    attempts += 1;
    return attempts === 1
      ? Response.json({ trades: [sampleTrade] })
      : Response.json({ code: 'UNAUTHENTICATED', message: 'Please log in again.' }, { status: 401 });
  });
  await screen.findByText('AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' }));

  assert.match((await screen.findByRole('alert')).textContent ?? '', /session has expired/);
  assert.equal(screen.queryByText('AAPL'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
  await screen.findByLabelText('Email');
});

test('signing out cancels a pending trade request and a new login starts with an empty cache', async (t) => {
  let resolveOldTrades!: (response: Response) => void;
  let pendingSignal: AbortSignal | null | undefined;
  let attempts = 0;
  const pending = new Promise<Response>((resolve) => { resolveOldTrades = resolve; });
  showTrades(t, async (_url, options) => {
    attempts += 1;
    if (attempts === 1) {
      pendingSignal = options?.signal;
      return pending;
    }

    return Response.json({ trades: [] });
  });
  await screen.findByText('Loading trades…');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByLabelText('Email');
  assert.equal(pendingSignal?.aborted, true);

  await act(async () => { resolveOldTrades(Response.json({ trades: [sampleTrade] })); });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jsmith@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByText('No trades yet');
  assert.equal(screen.queryByText('AAPL'), null);
  await waitFor(() => assert.equal(attempts, 2));
});
