import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import App from '../src/App';
import { signedInTrader, sampleTrade, cancelledTrade, tradePage } from './trade-fixtures';

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
    assert.ok(String(url).startsWith('/api/trades'));
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

  await act(async () => { resolveTrades(Response.json(tradePage())); });
  await screen.findByText('No trades yet');
});

test('a reviewer can view populated trade rows with exact quantities and clear display guidance', async (t) => {
  showTrades(t, async () => Response.json(tradePage([sampleTrade, cancelledTrade])), 'READ_ONLY');

  await screen.findByText('2 trades shown');
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
  showTrades(t, async () => Response.json(tradePage()));

  await screen.findByText('No trades yet');
  assert.ok(screen.getByText('0 trades shown'));
  assert.equal(screen.queryByRole('alert'), null);
});

for (const failure of ['network', 'server', 'invalid response']) {
  test(`initial ${failure} failure offers a working retry`, async (t) => {
    let attempts = 0;
    showTrades(t, async () => {
      attempts += 1;
      if (attempts > 1) return Response.json(tradePage());
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
    if (attempts === 1) return Response.json(tradePage([sampleTrade]));
    if (attempts === 2) return pending;
    return Response.json(tradePage([cancelledTrade]));
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
      ? Response.json(tradePage([sampleTrade]))
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

    return Response.json(tradePage());
  });
  await screen.findByText('Loading trades…');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByLabelText('Email');
  assert.equal(pendingSignal?.aborted, true);

  await act(async () => { resolveOldTrades(Response.json(tradePage([sampleTrade]))); });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jsmith@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByText('No trades yet');
  assert.equal(screen.queryByText('AAPL'), null);
  await waitFor(() => assert.equal(attempts, 2));
});

test('Previous reuses earlier forward requests across three visited pages', async (t) => {
  const urls: URL[] = [];
  const thirdTrade = { ...sampleTrade, id: 'f1550000-0000-4000-8000-000000100003', symbol: 'TSLA' };
  showTrades(t, async (input) => {
    const url = new URL(String(input), 'http://localhost');
    urls.push(url);
    const after = url.searchParams.get('after');
    if (after === 'cursor-B') return Response.json(tradePage([thirdTrade]));
    if (after === 'cursor-A') return Response.json(tradePage([cancelledTrade], { nextCursor: 'cursor-B' }));
    return Response.json(tradePage([sampleTrade], { nextCursor: 'cursor-A' }));
  });
  await screen.findByText('AAPL');
  assert.equal(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), true);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('MSFT');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('TSLA');
  assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), true);
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await screen.findByText('MSFT');
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await screen.findByText('AAPL');
  assert.equal(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), true);
  assert.deepEqual(urls.map((url) => url.searchParams.get('after')), [null, 'cursor-A', 'cursor-B', 'cursor-A', null]);
  assert.ok(urls.every((url) => !url.searchParams.has('before')));
});

test('changing sorting or page size starts a new server-side traversal', async (t) => {
  const urls: URL[] = [];
  showTrades(t, async (input) => {
    urls.push(new URL(String(input), 'http://localhost'));
    return Response.json(tradePage([sampleTrade], { nextCursor: 'next-token' }));
  });
  await screen.findByText('AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('after'), 'next-token'));
  fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'price' } });
  await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('sortBy'), 'price'));
  assert.equal(urls.at(-1)?.searchParams.has('after'), false);
  fireEvent.change(screen.getByLabelText('Sort direction'), { target: { value: 'asc' } });
  await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('sortDirection'), 'asc'));
  fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '25' } });
  await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('limit'), '25'));
  assert.equal(urls.at(-1)?.searchParams.has('before'), false);
  assert.equal(urls.at(-1)?.searchParams.has('after'), false);
  assert.equal(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), true);
});

test('a failed historical page keeps Previous and First page recovery available', async (t) => {
  showTrades(t, async (input) => new URL(String(input), 'http://localhost').searchParams.has('after')
    ? Response.json({ code: 'INVALID_CURSOR', message: 'Return to the first page.' }, { status: 400 })
    : Response.json(tradePage([sampleTrade], { nextCursor: 'next-token' })));
  await screen.findByText('AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await screen.findByText('AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'First page' }));
  await screen.findByText('AAPL');
});

test('an empty historical page is distinguished from an empty blotter', async (t) => {
  showTrades(t, async (input) => new URL(String(input), 'http://localhost').searchParams.has('after')
    ? Response.json(tradePage())
    : Response.json(tradePage([sampleTrade], { nextCursor: 'next-token' })));
  await screen.findByText('AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('No trades on this page');
  assert.equal(screen.queryByText('No trades yet'), null);
  fireEvent.click(screen.getByRole('button', { name: 'First page' }));
  await screen.findByText('AAPL');
});

test('a sort change aborts the old request and ignores its late result', async (t) => {
  let resolveOld!: (response: Response) => void;
  let oldSignal: AbortSignal | null | undefined;
  const pending = new Promise<Response>((resolve) => { resolveOld = resolve; });
  showTrades(t, async (input, options) => {
    if (new URL(String(input), 'http://localhost').searchParams.get('sortBy') === 'tradeDate') {
      oldSignal = options?.signal;
      return pending;
    }
    return Response.json(tradePage([cancelledTrade]));
  });
  await screen.findByText('Loading trades…');
  fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'price' } });
  await screen.findByText('MSFT');
  assert.equal(oldSignal?.aborted, true);
  await act(async () => { resolveOld(Response.json(tradePage([sampleTrade]))); });
  assert.equal(screen.queryByText('AAPL'), null);
});


test('refresh does not add a cursor-history entry', async (t) => {
  const cursors: (string | null)[] = [];
  showTrades(t, async (input) => {
    const after = new URL(String(input), 'http://localhost').searchParams.get('after');
    cursors.push(after);
    return after
      ? Response.json(tradePage([cancelledTrade]))
      : Response.json(tradePage([sampleTrade], { nextCursor: 'cursor-A' }));
  });
  await screen.findByText('AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('MSFT');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' }));
  await waitFor(() => assert.equal(cursors.length, 3));
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Refresh trades' }).hasAttribute('disabled'), false));
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await screen.findByText('AAPL');
  assert.deepEqual(cursors, [null, 'cursor-A', 'cursor-A', null]);
});
