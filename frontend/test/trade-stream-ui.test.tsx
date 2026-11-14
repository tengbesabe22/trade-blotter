import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TradesPage } from '../src/trades/TradesPage';
import type { LiveTradePage } from '../src/trades/trade-merge';
import { signedInTrader, sampleTrade, cancelledTrade, tradePage, tradeOptions } from './trade-fixtures';

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

class FakeEventSource extends dom.window.EventTarget {
  static sources: FakeEventSource[] = [];
  static CLOSED = 2;
  closed = false;
  readyState = 0;
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
    FakeEventSource.sources.push(this);
  }
  emit(name: string, data: unknown = {}) {
    if (name === 'stream.ready') this.readyState = 1;
    if (name === 'error' && !this.closed) this.readyState = 0;
    this.dispatchEvent(new dom.window.MessageEvent(name, { data: JSON.stringify(data) }));
  }
  close() { this.closed = true; this.readyState = FakeEventSource.CLOSED; }
}
Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource });
const { render, screen, fireEvent, act, cleanup, waitFor, within } = await import('@testing-library/react');
afterEach(() => { cleanup(); FakeEventSource.sources = []; });
after(() => dom.window.close());

const ready = {
  schemaVersion: 1, connectionId: 'd197282d-99ca-4260-833a-702f97d1cba8',
  serverTime: '2026-11-13T09:00:00.000Z',
};
const newer = {
  ...sampleTrade, id: 'f1550000-0000-4000-8000-000000100003', symbol: 'TSLA',
  tradeDate: '2026-11-13T09:00:00.000Z',
};
const change = {
  schemaVersion: 1, changeId: 'd197282d-99ca-4260-833a-702f97d1cba9',
  type: 'TRADE_CREATED', occurredAt: ready.serverTime, trade: newer,
};

function setup(t: TestContext, transport: typeof fetch = async () => Response.json(tradePage([sampleTrade]))) {
  const client = new QueryClient();
  client.setQueryData(['trade-options'], tradeOptions);
  const fetchMock = t.mock.method(globalThis, 'fetch', transport);
  const view = render(<QueryClientProvider client={client}><TradesPage user={{ ...signedInTrader, role: 'TRADER' }} onSessionExpired={() => {}} /></QueryClientProvider>);
  const source = FakeEventSource.sources.at(-1);
  assert.ok(source, 'The signed-in trade page must open an EventSource.');
  assert.equal(source.url, '/api/events');
  const page = () => client.getQueriesData<LiveTradePage>({ queryKey: ['trades'] })[0]?.[1];
  return { ...view, client, source, fetchMock, page };
}

test('ready starts the snapshot; incoming trades update the Query cache and table without another GET', async (t) => {
  const h = setup(t);
  assert.equal(h.fetchMock.mock.callCount(), 0);
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');

  await act(async () => { h.source.emit('trade.changed', change); });
  await screen.findByText('TSLA');
  assert.equal(h.fetchMock.mock.callCount(), 1);
  assert.deepEqual(h.page()?.trades.map((trade) => trade.symbol), ['TSLA', 'AAPL']);
  await act(async () => { h.source.emit('trade.changed', change); });
  assert.equal(h.page()?.trades.length, 2);
  assert.equal(h.fetchMock.mock.callCount(), 1);
});

test('events during initial load and a manual refresh survive older HTTP responses', async (t) => {
  let finish!: (response: Response) => void;
  let pending = new Promise<Response>((resolve) => { finish = resolve; });
  const h = setup(t, async () => pending);
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('Loading trades…');
  await act(async () => {
    h.source.emit('trade.changed', change);
    finish(Response.json(tradePage([sampleTrade])));
  });
  await screen.findByText('TSLA');

  pending = new Promise<Response>((resolve) => { finish = resolve; });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' }));
  const updated = { ...newer, version: 2, price: '250.0000' };
  await act(async () => {
    h.source.emit('trade.changed', { ...change, trade: updated });
    finish(Response.json(tradePage([sampleTrade, newer])));
  });
  await waitFor(() => assert.equal(h.page()?.trades.find((trade) => trade.id === newer.id)?.version, 2));
  assert.equal(h.page()?.trades[0]?.price, '250.0000');
});

test('older pages keep their rows, show a notice, and reuse the same connection', async (t) => {
  const h = setup(t, async (input) => {
    const olderPage = new URL(String(input), 'http://localhost').searchParams.has('after');
    return Response.json(olderPage
      ? tradePage([cancelledTrade])
      : tradePage([sampleTrade], { nextCursor: 'older-page' }));
  });
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('MSFT');
  await act(async () => { h.source.emit('trade.changed', change); });
  assert.ok(await screen.findByText(/New trades received/));
  assert.equal(screen.queryByText('TSLA'), null);
  assert.deepEqual(h.page()?.trades.map((trade) => trade.symbol), ['MSFT']);
  assert.equal(FakeEventSource.sources.length, 1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' }));
  await waitFor(() => assert.equal(h.page()?.hasNewTrades, false));
  assert.equal(screen.queryByText(/New trades received/), null);
});

test('reconnection retains rows, labels them stale, and fetches a new snapshot after ready', async (t) => {
  let snapshots = 0;
  const h = setup(t, async () => Response.json(tradePage(++snapshots === 1 ? [sampleTrade] : [newer, sampleTrade])));
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  await act(async () => { h.source.emit('error'); });
  assert.ok(screen.getByText(/Live connection lost/));
  assert.ok(screen.getByText('AAPL'));

  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('TSLA');
  assert.equal(snapshots, 2);
  for (const call of h.fetchMock.mock.calls) {
    assert.equal(new Headers(call.arguments[1]?.headers).get('X-Session-Activity'), 'background');
  }
});

test('invalid event data closes the source and leaves cached trades intact', async (t) => {
  const h = setup(t);
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  await act(async () => { h.source.emit('trade.changed', { ...change, trade: { ...newer, price: 250 } }); });
  assert.equal(h.source.closed, true);
  assert.ok(screen.getByText(/Live updates unavailable/));
  assert.deepEqual(h.page()?.trades, [sampleTrade]);
});

test('unmount closes the stream and late events cannot recreate the signed-out cache', async (t) => {
  const h = setup(t);
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  h.unmount();
  assert.equal(h.source.closed, true);
  h.client.clear();
  await act(async () => { h.source.emit('trade.changed', change); });
  assert.equal(h.client.getQueryCache().getAll().length, 0);
});

test('a terminal stream error offers manual refresh instead of claiming automatic reconnection', async (t) => {
  const h = setup(t);
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  await act(async () => { h.source.close(); h.source.emit('error'); });
  assert.ok(screen.getByText(/Live updates unavailable/));
  assert.equal(screen.queryByText(/reconnecting/), null);
});

test('Strict Mode leaves only one active connection and ignores the obsolete connection', async (t) => {
  const client = new QueryClient();
  client.setQueryData(['trade-options'], tradeOptions);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(tradePage([sampleTrade])));
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}><TradesPage user={{ ...signedInTrader, role: 'TRADER' }} onSessionExpired={() => {}} /></QueryClientProvider>
    </StrictMode>,
  );
  assert.equal(FakeEventSource.sources.filter((source) => !source.closed).length, 1);
  const obsolete = FakeEventSource.sources[0]!;
  const active = FakeEventSource.sources.at(-1)!;
  await act(async () => { obsolete.emit('stream.ready', ready); });
  assert.equal(fetchMock.mock.callCount(), 0);
  await act(async () => { active.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  assert.equal(fetchMock.mock.callCount(), 1);
  view.unmount();
  assert.ok(FakeEventSource.sources.every((source) => source.closed));
});

test('a full first page shows the live row without the new-trade notice', async (t) => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    ...sampleTrade,
    id: `f1550000-0000-4000-8000-${String(100 - index).padStart(12, '0')}`,
    symbol: `ROW${100 - index}`,
  }));
  const h = setup(t, async () => Response.json(tradePage(rows, { nextCursor: 'old-boundary' })));
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('100 trades shown');
  assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), false);

  await act(async () => { h.source.emit('trade.changed', change); });
  await screen.findByText('TSLA');
  assert.equal(h.page()?.hasNewTrades, true); // Pagination still needs a fresh boundary.
  assert.equal(screen.queryByText(/New trades received/) === null, true);
  assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), true);
});

test('manual refresh, navigation and sort changes remain user-initiated requests', async (t) => {
  const h = setup(t, async (input) => {
    const older = new URL(String(input), 'http://localhost').searchParams.has('after');
    return Response.json(older
      ? tradePage([cancelledTrade])
      : tradePage([sampleTrade], { nextCursor: 'older-page' }));
  });
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');

  async function expectUserRequest(action: () => void, expectedSymbol: string) {
    const before = h.fetchMock.mock.callCount();
    action();
    await waitFor(() => assert.equal(h.fetchMock.mock.callCount(), before + 1));
    await screen.findByText(expectedSymbol);
    const options = h.fetchMock.mock.calls.at(-1)?.arguments[1];
    assert.equal(new Headers(options?.headers).get('X-Session-Activity'), null);
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Refresh trades' }).hasAttribute('disabled'), false));
  }

  await expectUserRequest(() => fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' })), 'AAPL');
  await expectUserRequest(() => fireEvent.click(screen.getByRole('button', { name: 'Next' })), 'MSFT');
  await expectUserRequest(() => fireEvent.click(screen.getByRole('button', { name: 'Previous' })), 'AAPL');
  await expectUserRequest(() => fireEvent.click(screen.getByRole('button', { name: 'Next' })), 'MSFT');
  await expectUserRequest(() => fireEvent.click(screen.getByRole('button', { name: 'First page' })), 'AAPL');
  await expectUserRequest(() => fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'price' } }), 'AAPL');
});


test('amendment events update an existing cached row without another GET or closing the stream', async (t) => {
  const h = setup(t);
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  const amended = { ...sampleTrade, price: '228.5000', version: 2 };
  await act(async () => {
    h.source.emit('trade.changed', { ...change, type: 'TRADE_AMENDED', trade: amended });
  });
  assert.deepEqual(h.page()?.trades, [amended]);
  assert.equal(h.fetchMock.mock.callCount(), 1);
  assert.equal(h.source.closed, false);
});

test('a page waiting for SSE reconnection cannot reuse the previous page cursor', async (t) => {
  const h = setup(t, async (input) => new URL(String(input), 'http://localhost').searchParams.has('after')
    ? Response.json(tradePage([cancelledTrade], { nextCursor: 'third-page' }))
    : Response.json(tradePage([sampleTrade], { nextCursor: 'second-page' })));
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  await act(async () => { h.source.emit('error'); });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  assert.ok(screen.getByRole('grid'));
  assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), true);
  assert.equal(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled'), true);
  assert.equal(h.fetchMock.mock.callCount(), 1);

  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('MSFT');
  assert.equal(h.fetchMock.mock.callCount(), 2);
  assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), false);
});


test('cancellation SSE retains the row, blocks its open amendment and ignores older or duplicate updates without a GET', async (t) => {
  const owned = { ...sampleTrade, ownerId: signedInTrader.id };
  const h = setup(t, async () => Response.json(tradePage([owned])));
  await act(async () => { h.source.emit('stream.ready', ready); });
  fireEvent.click(await screen.findByRole('button', { name: `Amend AAPL trade ${owned.id}` }));
  fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '230' } });
  const cancelled = { ...owned, status: 'CANCELLED', version: 2 };
  const cancellation = { ...change, type: 'TRADE_CANCELLED', trade: cancelled };
  await act(async () => { h.source.emit('trade.changed', cancellation); });

  await screen.findByText(/This trade has been cancelled/);
  assert.deepEqual(h.page()?.trades, [cancelled]);
  assert.equal((screen.getByLabelText('Price (USD)') as HTMLInputElement).value, '230');
  assert.equal(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled'), true);
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  await screen.findByText('AAPL', { exact: true });
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: /^Amend / }), null));

  await act(async () => {
    h.source.emit('trade.changed', cancellation);
    h.source.emit('trade.changed', { ...change, type: 'TRADE_AMENDED', trade: owned });
  });
  assert.deepEqual(h.page()?.trades, [cancelled]);
  assert.equal(h.fetchMock.mock.callCount(), 1);
  assert.equal(h.source.closed, false);
});


async function selectStatus(value: string) {
  const controls = within(screen.getByRole('region', { name: 'Sort and filter' }));
  fireEvent.change(controls.getByLabelText('Status'), { target: { value } });
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Refresh trades' }).hasAttribute('disabled'), false));
}

test('filtered SSE ignores unrelated trades and inserts matching trades without another GET', async (t) => {
  const h = setup(t, async () => Response.json(tradePage([])));
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('No trades yet');
  await selectStatus('ACTIVE');
  await screen.findByText('No matching trades');
  await act(async () => { h.source.emit('trade.changed', { ...change, type: 'TRADE_CANCELLED', trade: { ...newer, status: 'CANCELLED', version: 2 } }); });
  assert.deepEqual(h.page()?.trades, []);
  await act(async () => { h.source.emit('trade.changed', { ...change, trade: { ...sampleTrade, id: cancelledTrade.id } }); });
  await screen.findByText('AAPL');
  assert.equal(h.fetchMock.mock.callCount(), 2);
  assert.equal(FakeEventSource.sources.length, 1);
});

test('filter exits remove rows immediately and coalesce a passive bounded refill protected by newer events', async (t) => {
  let activeReads = 0;
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const h = setup(t, async (input) => {
    if (new URL(String(input), 'http://localhost').searchParams.has('status') && ++activeReads === 2) return pending;
    return Response.json(tradePage([sampleTrade, newer], { nextCursor: 'next' }));
  });
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  await selectStatus('ACTIVE');
  const cancellation = { ...change, type: 'TRADE_CANCELLED', trade: { ...sampleTrade, version: 2, status: 'CANCELLED' } };
  await act(async () => {
    h.source.emit('trade.changed', cancellation);
    h.source.emit('trade.changed', cancellation);
    h.source.emit('trade.changed', { ...cancellation, trade: { ...newer, version: 2, status: 'CANCELLED' } });
  });
  assert.deepEqual(h.page()?.trades, []);
  assert.equal(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled'), true);
  await waitFor(() => assert.equal(activeReads, 2));
  const replacement = { ...cancelledTrade, status: 'ACTIVE' as const, version: 1 };
  await act(async () => {
    h.source.emit('trade.changed', { ...change, type: 'TRADE_AMENDED', trade: { ...replacement, price: '450.0000', version: 2 } });
    finish(Response.json(tradePage([replacement])));
  });
  await waitFor(() => assert.equal(h.page()?.trades[0]?.price, '450.0000'));
  assert.equal(h.page()?.trades.length, 1);
  assert.equal(h.fetchMock.mock.callCount(), 3);
  const [url, options] = h.fetchMock.mock.calls[2]!.arguments;
  assert.equal(new URL(String(url), 'http://localhost').searchParams.get('limit'), '100');
  assert.equal(new Headers(options?.headers).get('X-Session-Activity'), 'background');
});

test('a failed refill preserves event-applied rows and waits for manual retry', async (t) => {
  let activeReads = 0;
  const h = setup(t, async (input) => {
    const filtered = new URL(String(input), 'http://localhost').searchParams.has('status');
    if (filtered && ++activeReads === 2) return Response.json({ code: 'INTERNAL_ERROR', message: 'Failed.' }, { status: 500 });
    return Response.json(tradePage(filtered && activeReads > 1 ? [newer] : [sampleTrade, newer]));
  });
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  await selectStatus('ACTIVE');
  await act(async () => { h.source.emit('trade.changed', { ...change, type: 'TRADE_CANCELLED', trade: { ...sampleTrade, version: 2, status: 'CANCELLED' } }); });
  await screen.findByText(/Unable to refresh trades/);
  assert.deepEqual(h.page()?.trades.map((trade) => trade.symbol), ['TSLA']);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(activeReads, 2);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' }));
  await waitFor(() => assert.equal(activeReads, 3));
  await waitFor(() => assert.equal(screen.queryByRole('alert') === null, true));
});

test('changing filters cancels a queued refill for the old selection', async (t) => {
  const cancelled = { ...sampleTrade, status: 'CANCELLED' as const, version: 2 };
  const h = setup(t, async (input) => Response.json(tradePage(
    new URL(String(input), 'http://localhost').searchParams.get('status') === 'CANCELLED' ? [cancelled] : [sampleTrade],
  )));
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  await selectStatus('ACTIVE');
  await act(async () => { h.source.emit('trade.changed', { ...change, type: 'TRADE_CANCELLED', trade: cancelled }); });
  await selectStatus('CANCELLED');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(h.fetchMock.mock.callCount(), 3);
  assert.equal(h.page()?.trades[0]?.status, 'CANCELLED');
});


test('ticker/trader changes hide previous-filter placeholders and SSE keeps matching versions without another connection', async (t) => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const matching = { ...cancelledTrade, status: 'ACTIVE' as const, side: 'BUY' as const, version: 1,
    ownerId: signedInTrader.id, trader: signedInTrader.displayName, tradeDate: newer.tradeDate };
  const h = setup(t, async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.searchParams.has('traderId')) return Response.json(tradePage([matching]));
    if (url.searchParams.has('symbol')) return pending;
    return Response.json(tradePage([sampleTrade]));
  });
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('AAPL');
  const controls = within(screen.getByRole('region', { name: 'Sort and filter' }));
  fireEvent.change(controls.getByRole('combobox', { name: 'Ticker filter' }), { target: { value: 'MSFT' } });
  await waitFor(() => assert.equal(h.fetchMock.mock.callCount(), 2));
  assert.equal(screen.queryByText('AAPL') === null, true);
  await act(async () => {
    h.source.emit('trade.changed', { ...change, trade: { ...matching, price: '450.0000', version: 2 } });
    finish(Response.json(tradePage([])));
  });
  await screen.findByText('MSFT');
  fireEvent.change(controls.getByRole('combobox', { name: 'Trader filter' }), { target: { value: signedInTrader.id } });
  await waitFor(() => assert.equal(h.fetchMock.mock.callCount(), 3));
  await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Refresh trades' }).hasAttribute('disabled'), false));
  await act(async () => {
    h.source.emit('trade.changed', { ...change, trade: { ...matching, id: 'f1550000-0000-4000-8000-000000100004', ownerId: sampleTrade.ownerId } });
    h.source.emit('trade.changed', { ...change, trade: { ...matching, id: 'f1550000-0000-4000-8000-000000100005', symbol: 'TSLA' } });
    h.source.emit('trade.changed', { ...change, trade: { ...matching, id: 'f1550000-0000-4000-8000-000000100006' } });
  });
  assert.equal(h.page()?.trades.length, 2);
  assert.ok(h.page()?.trades.every((trade) => trade.symbol === 'MSFT' && trade.ownerId === signedInTrader.id));
  assert.equal(h.page()?.trades.find((trade) => trade.id === matching.id)?.price, '450.0000');
  assert.equal(h.fetchMock.mock.callCount(), 3);
  assert.equal(FakeEventSource.sources.length, 1);
});
