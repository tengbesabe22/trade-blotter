import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TradeHistoryPage } from '../src/trades/pages/TradeHistoryPage';
import { TradesPage } from '../src/trades/pages/TradesPage';
import { sampleTrade, cancelledTrade, signedInTrader, tradePage, tradeOptions } from './trade-fixtures';
import { sampleHistory } from './trade-history-fixtures';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:5173', pretendToBeVisual: true,
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

function showHistory(t: TestContext, transport: typeof fetch) {
  const client = new QueryClient();
  const events = { back: 0, expired: 0 };
  const fetchMock = t.mock.method(globalThis, 'fetch', transport);
  const view = render(<QueryClientProvider client={client}>
    <TradeHistoryPage trade={sampleTrade} onBack={() => { events.back += 1; }}
      onSessionExpired={() => { events.expired += 1; }} />
  </QueryClientProvider>);
  return { ...view, client, events, fetchMock };
}

test('history shows loading before rendering ordered actions, actor, UTC time, exact changes and creation terms', async (t) => {
  let finish!: (response: Response) => void;
  const h = showHistory(t, async () => new Promise((resolve) => { finish = resolve; }));
  assert.ok(screen.getByRole('status', { name: '' }));
  assert.ok(screen.getByText('Loading trade history…'));
  assert.equal(screen.queryByText('No history recorded'), null);
  assert.equal(document.activeElement?.textContent, 'Trade history');
  await act(async () => { finish(Response.json(sampleHistory)); });
  const articles = screen.getAllByRole('article');
  assert.deepEqual(articles.map((article) => within(article).getByRole('heading').textContent), [
    'Cancelled · Version 3', 'Amended · Version 2', 'Created · Version 1',
  ]);
  const amendment = within(articles[1]);
  assert.ok(amendment.getByText('Correct price and book.'));
  assert.ok(amendment.getByText('227.4501'));
  assert.ok(amendment.getByText('230.0000'));
  assert.ok(amendment.getByText('—'));
  assert.match(articles[1].textContent ?? '', /ADOE/);
  assert.match(articles[1].textContent ?? '', /2026-08-18 09:20:00.000 UTC/);
  assert.ok(within(articles[2]).getByText('5000.000001'));
  fireEvent.click(screen.getByRole('button', { name: /Back to trades/ }));
  assert.equal(h.events.back, 1);
});

test('history has an explicit empty state', async (t) => {
  showHistory(t, async () => Response.json({ ...sampleHistory, entries: [] }));
  assert.ok(await screen.findByText('No history recorded'));
  assert.equal(screen.queryAllByRole('article').length, 0);
});

test('an unavailable predecessor is explained and its recorded snapshot remains visible', async (t) => {
  showHistory(t, async () => Response.json({
    ...sampleHistory, entries: [{ ...sampleHistory.entries[1], changes: null }],
  }));
  assert.ok(await screen.findByText('Previous version unavailable. Showing the recorded trade.'));
  assert.ok(screen.getByText('230.0000'));
});

test('an initial failure offers a working retry without automatic retry requests', async (t) => {
  let attempts = 0;
  showHistory(t, async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('Connection lost.');
    return Response.json(sampleHistory);
  });
  assert.match((await screen.findByRole('alert')).textContent ?? '', /Unable to load trade history/);
  assert.equal(attempts, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  assert.ok(await screen.findByText('Cancelled · Version 3'));
  assert.equal(attempts, 2);
});

test('a failed refresh keeps loaded history and prevents duplicate refresh requests', async (t) => {
  let attempts = 0;
  let finish!: (response: Response) => void;
  showHistory(t, async () => {
    attempts += 1;
    return attempts === 1 ? Response.json(sampleHistory) : new Promise((resolve) => { finish = resolve; });
  });
  await screen.findByText('Cancelled · Version 3');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  const refresh = await screen.findByRole('button', { name: 'Refreshing history…' });
  assert.equal(refresh.hasAttribute('disabled'), true);
  fireEvent.click(refresh);
  assert.equal(attempts, 2);
  await act(async () => { finish(Response.json({ code: 'INTERNAL_ERROR', message: 'Failed.' }, { status: 500 })); });
  assert.match((await screen.findByRole('alert')).textContent ?? '', /Showing the last loaded history/);
  assert.ok(screen.getByText('Cancelled · Version 3'));
});

test('session expiry hides cached history and offers sign-in', async (t) => {
  let attempts = 0;
  const h = showHistory(t, async () => ++attempts === 1
    ? Response.json(sampleHistory)
    : Response.json({ code: 'UNAUTHENTICATED', message: 'Please log in again.' }, { status: 401 }));
  await screen.findByText('Cancelled · Version 3');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  await screen.findByRole('alert');
  assert.equal(screen.queryByText('Cancelled · Version 3'), null);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
  assert.equal(h.events.expired, 1);
});

test('a missing trade gets a clear message and a way back', async (t) => {
  showHistory(t, async () => Response.json({ code: 'TRADE_NOT_FOUND', message: 'Trade not found.' }, { status: 404 }));
  assert.match((await screen.findByRole('alert')).textContent ?? '', /This trade could not be found/);
  assert.ok(screen.getByRole('button', { name: /Back to trades/ }));
});

for (const role of ['TRADER', 'READ_ONLY'] as const) {
  test(`${role} can open history for another trader's cancelled trade without mutation controls`, async (t) => {
    const client = new QueryClient();
    client.setQueryData(['trade-options'], tradeOptions);
    const history = {
      ...sampleHistory, tradeId: cancelledTrade.id,
      entries: sampleHistory.entries.map((entry) => ({ ...entry, snapshot: { ...entry.snapshot, id: cancelledTrade.id, symbol: cancelledTrade.symbol } })),
    };
    const urls: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return Response.json(url.endsWith('/history') ? history : tradePage([cancelledTrade]));
    });
    render(<QueryClientProvider client={client}>
      <TradesPage user={{ ...signedInTrader, role }} onSessionExpired={() => {}} />
    </QueryClientProvider>);
    const historyButton = await screen.findByRole('button', { name: `History MSFT trade ${cancelledTrade.id}` });
    assert.equal(urls.some((url) => url.endsWith('/history')), false);
    assert.equal(screen.queryByRole('button', { name: /^Amend / }), null);
    assert.equal(screen.queryByRole('button', { name: /^Cancel / }), null);
    fireEvent.click(historyButton);
    assert.ok(await screen.findByRole('region', { name: 'Trade history' }));
    await screen.findByText('Cancelled · Version 3');
    assert.equal(screen.queryByRole('complementary', { name: 'Trade controls' }), null);
    assert.equal(urls.filter((url) => url.endsWith('/history')).length, 1);
  });
}

test('returning from history preserves filters, cursor navigation and a creation draft without refetching trades', async (t) => {
  const client = new QueryClient();
  client.setQueryData(['trade-options'], tradeOptions);
  const tradeUrls: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/history')) return Response.json(sampleHistory);
    tradeUrls.push(new URL(url, 'http://localhost'));
    return Response.json(tradePage([sampleTrade], { nextCursor: 'page-two' }));
  });
  render(<QueryClientProvider client={client}>
    <TradesPage user={{ ...signedInTrader, role: 'TRADER' }} onSessionExpired={() => {}}
      tradePanel={<label>Draft quantity<input defaultValue="" /></label>} />
  </QueryClientProvider>);
  await screen.findByText('AAPL');
  fireEvent.change(screen.getByLabelText('Draft quantity'), { target: { value: '123' } });
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ACTIVE' } });
  await waitFor(() => assert.equal(tradeUrls.at(-1)?.searchParams.get('status'), 'ACTIVE'));
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), false));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => assert.equal(tradeUrls.at(-1)?.searchParams.get('after'), 'page-two'));
  fireEvent.click(await screen.findByRole('button', { name: `History AAPL trade ${sampleTrade.id}` }));
  await screen.findByText('Cancelled · Version 3');
  const readsBeforeBack = tradeUrls.length;
  fireEvent.click(screen.getByRole('button', { name: /Back to trades/ }));
  assert.equal((screen.getByLabelText('Status') as HTMLSelectElement).value, 'ACTIVE');
  assert.equal((screen.getByLabelText('Draft quantity') as HTMLInputElement).value, '123');
  assert.equal(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), false);
  assert.equal(tradeUrls.length, readsBeforeBack);
  await waitFor(() => assert.equal(document.activeElement?.id, 'trades-title'));
});

test('leaving history cancels the pending request', async (t) => {
  let signal: AbortSignal | null | undefined;
  const h = showHistory(t, async (_url, options) => {
    signal = options?.signal;
    return new Promise<Response>(() => {});
  });
  assert.ok(signal);
  h.unmount();
  assert.equal(signal.aborted, true);
});
