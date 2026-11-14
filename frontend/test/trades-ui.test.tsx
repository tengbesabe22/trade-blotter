import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import App from '../src/App';
import { signedInTrader, sampleTrade, cancelledTrade, tradePage, tradeOptions } from './trade-fixtures';

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

const { render, screen, fireEvent, act, cleanup, waitFor, within } = await import('@testing-library/react');
afterEach(() => cleanup());
after(() => dom.window.close());

function showTrades(t: TestContext, tradeTransport: typeof fetch, role = 'TRADER') {
  const transport: typeof fetch = async (url, options) => {
    if (url === '/api/auth/me' || url === '/api/auth/login') {
      return Response.json({ user: { ...signedInTrader, role } });
    }

    if (url === '/api/trades/filter-options') return Response.json(tradeOptions);
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
  fireEvent.click(screen.getByRole('button', { name: 'Account for JSMITH' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Account for JSMITH' }));
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
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), false));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('TSLA');
  assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), true);
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await screen.findByText('MSFT');
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), false));
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


test('sorting and the open create form share a sidebar outside the trade display', async (t) => {
  showTrades(t, async () => Response.json(tradePage()));
  await screen.findByText('No trades yet');
  const sidebar = screen.getByRole('complementary', { name: 'Trade controls' });
  const tradeDisplay = screen.getByRole('region', { name: 'Trades' });
  assert.ok(within(sidebar).getByLabelText('Sort by'));
  assert.ok(within(sidebar).getByRole('button', { name: 'Create trade' }));
  assert.equal(within(tradeDisplay).queryByLabelText('Sort by') === null, true);
  assert.equal(within(tradeDisplay).queryByLabelText('Ticker') === null, true);
  assert.ok(within(tradeDisplay).getByRole('button', { name: 'Refresh trades' }));
});

test('a trader creates through the workspace and the current page refreshes after success', async (t) => {
  let created = false;
  let reads = 0;
  const mock = showTrades(t, async (_input, options) => {
    if (options?.method === 'POST') {
      created = true;
      return Response.json({ trade: sampleTrade }, { status: 201 });
    }
    reads += 1;
    return Response.json(tradePage(created ? [sampleTrade] : []));
  });
  await screen.findByText('No trades yet');
  const creation = within(screen.getByRole('region', { name: 'Create a trade' }));
  fireEvent.change(creation.getByLabelText('Ticker'), { target: { value: 'apple' } });
  fireEvent.click(creation.getByRole('option', { name: /AAPL/ }));
  for (const [label, value] of [['Quantity', '100'], ['Price (USD)', '227.45']]) {
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
  await screen.findByText(/Trade created:/);
  await screen.findByText('AAPL', { exact: true });
  assert.equal(reads, 2);
  assert.equal(mock.mock.calls.filter((call) => call.arguments[1]?.method === 'POST').length, 1);
});

test('the reviewer workspace does not offer trade creation', async (t) => {
  showTrades(t, async () => Response.json(tradePage()), 'READ_ONLY');
  await screen.findByText('No trades yet');
  assert.equal(screen.queryByRole('region', { name: 'Create a trade' }) === null, true);
  assert.equal(screen.queryByRole('button', { name: 'Create trade' }) === null, true);
  assert.ok(within(screen.getByRole('complementary', { name: 'Trade controls' })).getByLabelText('Sort by'));
});

for (const direction of ['Next', 'Previous'] as const) {
  test(`${direction} keeps the grid mounted and preserves scroll while loading and replacing rows`, async (t) => {
    const rows = (symbol: string, offset: number) => Array.from({ length: 100 }, (_, index) => ({
      ...sampleTrade, symbol,
      id: 'f1550000-0000-4000-8000-' + String(offset + index).padStart(12, '0'),
    })).reverse();
    const firstPage = tradePage(rows('AAPL', 1000), { nextCursor: 'next-token' });
    const secondPage = tradePage(rows('MSFT', 2000));
    let defer = false;
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    showTrades(t, async (input) => {
      if (defer) return pending;
      const after = new URL(String(input), 'http://localhost').searchParams.get('after');
      return Response.json(after ? secondPage : firstPage);
    });
    await screen.findByText('100 trades shown');
    await screen.findAllByText('AAPL', { exact: true });
    if (direction === 'Previous') {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      await screen.findAllByText('MSFT', { exact: true });
    }

    const grid = screen.getByRole('grid');
    const pagination = screen.getByRole('navigation', { name: 'Trade pages' });
    const gridWrapper = grid.closest('.ag-root-wrapper')!;
    const vertical = gridWrapper.querySelector<HTMLElement>('.ag-body-vertical-scroll-viewport');
    const horizontal = gridWrapper.querySelector<HTMLElement>('.ag-body-horizontal-scroll-viewport');
    assert.ok(vertical && horizontal);
    vertical.scrollTop = 220;
    horizontal.scrollLeft = 120;
    fireEvent.scroll(vertical);
    fireEvent.scroll(horizontal);

    defer = true;
    fireEvent.click(screen.getByRole('button', { name: direction }));
    await waitFor(() => {
      assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), true);
      assert.equal(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), true);
    });
    assert.ok(screen.queryByRole('grid') === grid, 'Loading another page must not remove the grid and collapse the layout.');
    assert.ok(screen.getByRole('navigation', { name: 'Trade pages' }) === pagination);
    assert.equal(screen.queryByText('Loading trades…'), null);

    await act(async () => { finish(Response.json(direction === 'Next' ? secondPage : firstPage)); });
    await screen.findAllByText(direction === 'Next' ? 'MSFT' : 'AAPL', { exact: true });
    assert.ok(screen.getByRole('grid') === grid, 'Keep the same grid when the requested rows arrive.');
    assert.equal(vertical.scrollTop, 220);
    assert.equal(horizontal.scrollLeft, 120);
  });
}


test('Status and Side filter all server results, reset pagination and survive sorting/page-size changes', async (t) => {
  const urls: URL[] = [];
  showTrades(t, async (input) => {
    const url = new URL(String(input), 'http://localhost');
    urls.push(url);
    return Response.json(tradePage(url.searchParams.has('status') ? [] : [
      { ...sampleTrade, side: url.searchParams.get('side') === 'SELL' ? 'SELL' : 'BUY' },
    ], { nextCursor: 'next' }));
  });
  await screen.findByText('AAPL');
  const controls = within(screen.getByRole('region', { name: 'Sort and filter' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('after'), 'next'));
  fireEvent.change(controls.getByLabelText('Status'), { target: { value: 'ACTIVE' } });
  await screen.findByText('No matching trades');
  assert.equal(urls.at(-1)?.searchParams.has('after'), false);
  assert.equal(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), true);
  fireEvent.change(controls.getByLabelText('Side'), { target: { value: 'SELL' } });
  await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('side'), 'SELL'));
  fireEvent.change(controls.getByLabelText('Sort by'), { target: { value: 'price' } });
  await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('sortBy'), 'price'));
  fireEvent.change(controls.getByLabelText('Rows per page'), { target: { value: '25' } });
  await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('limit'), '25'));
  assert.equal(urls.at(-1)?.searchParams.get('status'), 'ACTIVE');
  assert.equal(urls.at(-1)?.searchParams.get('side'), 'SELL');
  fireEvent.change(controls.getByLabelText('Status'), { target: { value: '' } });
  await screen.findByText('AAPL');
  assert.equal(urls.at(-1)?.searchParams.has('status'), false);
  assert.equal(urls.at(-1)?.searchParams.get('side'), 'SELL');
  fireEvent.change(controls.getByLabelText('Side'), { target: { value: '' } });
  await waitFor(() => assert.equal(urls.at(-1)?.searchParams.has('side'), false));
});


for (const role of ['TRADER', 'READ_ONLY']) {
  test(`${role} filters by ticker/trader using cached complete options and preserves all selections`, async (t) => {
    const urls: URL[] = [];
    const mock = showTrades(t, async (input) => {
      const url = new URL(String(input), 'http://localhost');
      urls.push(url);
      return Response.json(tradePage(url.searchParams.has('symbol') || url.searchParams.has('traderId') ? [] : [sampleTrade], { nextCursor: 'next' }));
    }, role);
    await screen.findByText('AAPL');
    const controls = within(screen.getByRole('region', { name: 'Sort and filter' }));
    await waitFor(() => assert.equal(controls.getByRole('combobox', { name: 'Ticker filter' }).hasAttribute('disabled'), false));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('after'), 'next'));
    fireEvent.change(controls.getByRole('combobox', { name: 'Ticker filter' }), { target: { value: 'MSFT' } });
    await screen.findByText('No matching trades');
    assert.equal(urls.at(-1)?.searchParams.get('symbol'), 'MSFT');
    assert.equal(urls.at(-1)?.searchParams.has('after'), false);
    assert.equal(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), true);
    fireEvent.change(controls.getByRole('combobox', { name: 'Trader filter' }), { target: { value: signedInTrader.id } });
    await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('traderId'), signedInTrader.id));
    fireEvent.change(controls.getByLabelText('Status'), { target: { value: 'ACTIVE' } });
    fireEvent.change(controls.getByLabelText('Side'), { target: { value: 'BUY' } });
    fireEvent.change(controls.getByLabelText('Sort by'), { target: { value: 'price' } });
    fireEvent.change(controls.getByLabelText('Rows per page'), { target: { value: '25' } });
    await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('limit'), '25'));
    assert.equal(urls.at(-1)?.searchParams.get('symbol'), 'MSFT');
    assert.equal(urls.at(-1)?.searchParams.get('traderId'), signedInTrader.id);
    assert.equal(urls.at(-1)?.searchParams.get('status'), 'ACTIVE');
    assert.equal(urls.at(-1)?.searchParams.get('side'), 'BUY');
    fireEvent.change(controls.getByRole('combobox', { name: 'Ticker filter' }), { target: { value: '' } });
    await waitFor(() => assert.equal(urls.at(-1)?.searchParams.has('symbol'), false));
    assert.equal(urls.at(-1)?.searchParams.get('traderId'), signedInTrader.id);
    fireEvent.change(controls.getByRole('combobox', { name: 'Trader filter' }), { target: { value: '' } });
    await screen.findByText('AAPL');
    assert.equal(urls.at(-1)?.searchParams.has('traderId'), false);
    assert.equal(mock.mock.calls.filter((call) => call.arguments[0] === '/api/trades/filter-options').length, 1);
  });
}

test('Clear filters makes one unfiltered page-one request while preserving sorting, page size and the Create draft', async (t) => {
  const urls: URL[] = [];
  const mock = showTrades(t, async (input) => {
    const url = new URL(String(input), 'http://localhost');
    urls.push(url);
    return Response.json(tradePage([{
      ...sampleTrade,
      symbol: url.searchParams.get('symbol') ?? sampleTrade.symbol,
      ownerId: url.searchParams.get('traderId') ?? sampleTrade.ownerId,
      status: url.searchParams.get('status') === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
      side: url.searchParams.get('side') === 'SELL' ? 'SELL' : 'BUY',
    }], { nextCursor: 'next' }));
  });
  await screen.findByText('AAPL');
  const controls = within(screen.getByRole('region', { name: 'Sort and filter' }));
  const creation = within(screen.getByRole('region', { name: 'Create a trade' }));
  fireEvent.change(creation.getByLabelText('Quantity'), { target: { value: '123' } });
  await waitFor(() => assert.equal(controls.getByRole('combobox', { name: 'Ticker filter' }).hasAttribute('disabled'), false));
  fireEvent.change(controls.getByRole('combobox', { name: 'Ticker filter' }), { target: { value: 'MSFT' } });
  fireEvent.change(controls.getByRole('combobox', { name: 'Trader filter' }), { target: { value: signedInTrader.id } });
  fireEvent.change(controls.getByLabelText('Status'), { target: { value: 'CANCELLED' } });
  fireEvent.change(controls.getByLabelText('Side'), { target: { value: 'SELL' } });
  fireEvent.change(controls.getByLabelText('Sort by'), { target: { value: 'price' } });
  fireEvent.change(controls.getByLabelText('Sort direction'), { target: { value: 'asc' } });
  fireEvent.change(controls.getByLabelText('Rows per page'), { target: { value: '25' } });
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), false));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('after'), 'next'));
  const requestsBeforeClear = urls.length;
  fireEvent.click(controls.getByRole('button', { name: 'Clear filters' }));
  await screen.findByText('AAPL');
  assert.equal(urls.length, requestsBeforeClear + 1);
  const query = urls.at(-1)!.searchParams;
  for (const name of ['symbol', 'traderId', 'status', 'side', 'after']) assert.equal(query.has(name), false);
  assert.equal(query.get('sortBy'), 'price');
  assert.equal(query.get('sortDirection'), 'asc');
  assert.equal(query.get('limit'), '25');
  for (const name of ['Ticker filter', 'Trader filter']) assert.equal((controls.getByRole('combobox', { name }) as HTMLSelectElement).value, '');
  for (const name of ['Status', 'Side']) assert.equal((controls.getByLabelText(name) as HTMLSelectElement).value, '');
  assert.equal(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), true);
  assert.equal((creation.getByLabelText('Quantity') as HTMLInputElement).value, '123');
  assert.equal(mock.mock.calls.filter((call) => call.arguments[0] === '/api/trades/filter-options').length, 1);
});


test('applying text and UTC dates makes one page-one request, preserves sorting and clears back to all trades', async (t) => {
  const urls: URL[] = [];
  showTrades(t, async (input) => {
    const url = new URL(String(input), 'http://localhost');
    urls.push(url);
    return Response.json(tradePage(url.searchParams.has('book') ? [] : [sampleTrade], { nextCursor: 'next' }));
  });
  await screen.findByText('AAPL');
  const controls = within(screen.getByRole('region', { name: 'Sort and filter' }));
  fireEvent.change(controls.getByLabelText('Sort by'), { target: { value: 'price' } });
  fireEvent.change(controls.getByLabelText('Rows per page'), { target: { value: '25' } });
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), false));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => assert.equal(urls.at(-1)?.searchParams.get('after'), 'next'));
  const requestsBeforeTyping = urls.length;
  fireEvent.change(controls.getByRole('textbox', { name: 'Book filter' }), { target: { value: '  Equities  ' } });
  fireEvent.change(controls.getByRole('textbox', { name: 'Counterparty filter' }), { target: { value: '  Goldman  ' } });
  fireEvent.change(controls.getByLabelText('From (UTC)'), { target: { value: '2026-11-14' } });
  fireEvent.change(controls.getByLabelText('Through (UTC)'), { target: { value: '2026-11-14' } });
  assert.equal(urls.length, requestsBeforeTyping);
  fireEvent.click(controls.getByRole('button', { name: 'Apply filters' }));
  await screen.findByText('No matching trades');
  assert.equal(urls.length, requestsBeforeTyping + 1);
  const query = urls.at(-1)!.searchParams;
  assert.equal(query.get('book'), 'equities');
  assert.equal(query.get('counterparty'), 'goldman');
  assert.equal(query.get('tradeDateFrom'), '2026-11-14T00:00:00.000Z');
  assert.equal(query.get('tradeDateTo'), '2026-11-15T00:00:00.000Z');
  assert.equal(query.has('after'), false);
  assert.equal(query.get('sortBy'), 'price');
  assert.equal(query.get('limit'), '25');
  assert.equal(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), true);
  fireEvent.click(controls.getByRole('button', { name: 'Clear filters' }));
  await screen.findByText('AAPL');
  assert.equal(urls.length, requestsBeforeTyping + 2);
  assert.equal(urls.at(-1)!.searchParams.has('book'), false);
  assert.equal(urls.at(-1)!.searchParams.has('counterparty'), false);
  assert.equal(urls.at(-1)!.searchParams.has('tradeDateFrom'), false);
  assert.equal(urls.at(-1)!.searchParams.has('tradeDateTo'), false);
});
