import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TradesPage } from '../src/trades/TradesPage';
import { TradeWorkspace } from '../src/trades/TradeWorkspace';
import type { SymbolSummary } from '../src/api/trade-summary-contract';
import { signedInTrader, sampleTrade, tradePage, tradeOptions } from './trade-fixtures';
import { sampleSummary, shortSummary, flatSummary, summaryResponse } from './trade-summary-fixtures';

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
  serverTime: '2026-11-15T09:00:00.000Z',
};
const queryKey = ['position-summaries'];
function changed(summary: SymbolSummary, tradeVersion = 1) {
  return { changeId: 'd197282d-99ca-4260-833a-702f97d1cba9', type: 'TRADE_AMENDED',
    occurredAt: ready.serverTime, trade: { ...sampleTrade, version: tradeVersion }, summaries: [summary] };
}
function setup(t: TestContext, transport: typeof fetch, role: 'TRADER' | 'READ_ONLY' = 'TRADER', onSessionExpired = () => {}) {
  const client = new QueryClient();
  client.setQueryData(['trade-options'], tradeOptions);
  t.mock.method(globalThis, 'fetch', transport);
  const view = render(<QueryClientProvider client={client}><TradesPage
    user={{ ...signedInTrader, role }} onSessionExpired={onSessionExpired} /></QueryClientProvider>);
  const source = FakeEventSource.sources.at(-1)!;
  return { ...view, client, source };
}
const openPositions = () => fireEvent.click(screen.getByRole('tab', { name: 'Position Summary' }));
const positions = () => within(screen.getByRole('tabpanel', { name: 'Position Summary' }));
const positionRow = (symbol: string) => within(positions().getByRole('rowheader', { name: symbol }).closest('tr')!);

for (const role of ['TRADER', 'READ_ONLY'] as const) {
  test(`${role} loads positions on first open, retains filters, and switches tabs without extra connections or reads`, async (t) => {
    const reads: RequestInit[] = [];
    const h = setup(t, async (url, options) => {
      if (url === '/api/summaries') {
        reads.push(options ?? {});
        return Response.json(summaryResponse([sampleSummary, shortSummary, flatSummary]));
      }
      return Response.json(tradePage([sampleTrade]));
    }, role);
    await act(async () => { h.source.emit('stream.ready', ready); });
    await screen.findByText('1 trade shown');
    fireEvent.change(screen.getByRole('combobox', { name: 'Side' }), { target: { value: 'BUY' } });
    assert.equal(reads.length, 0);
    openPositions();
    await positions().findByRole('rowheader', { name: 'AAPL' });
    assert.ok(positionRow('AAPL').getByRole('cell', { name: '70' }));
    assert.ok(positionRow('AAPL').getByRole('cell', { name: 'Long' }));
    assert.ok(positionRow('MSFT').getByRole('cell', { name: '-30' }));
    assert.ok(positionRow('MSFT').getByRole('cell', { name: 'Short' }));
    assert.ok(positionRow('TSLA').getByRole('cell', { name: 'Flat' }));
    assert.ok(positions().getByText(/All traders and books.*All dates/));
    fireEvent.click(screen.getByRole('tab', { name: 'Trades' }));
    assert.equal((screen.getByRole('combobox', { name: 'Side' }) as HTMLSelectElement).value, 'BUY');
    openPositions();
    assert.equal(reads.length, 1);
    assert.equal(new Headers(reads[0]!.headers).get('X-Session-Activity'), null);
    assert.equal(FakeEventSource.sources.filter((source) => !source.closed).length, 1);
  });
}

test('events before/during the baseline survive an older snapshot, independently of trade versions', async (t) => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  let reads = 0;
  const h = setup(t, async (url) => {
    if (url === '/api/summaries') { reads += 1; return pending; }
    return Response.json(tradePage([sampleTrade]));
  });
  await act(async () => { h.source.emit('stream.ready', ready); });
  await screen.findByText('1 trade shown');
  await act(async () => { h.source.emit('trade.changed', changed({ ...sampleSummary, version: 10 }, 20)); });
  assert.equal(reads, 0);
  openPositions();
  await positions().findByText('Loading positions…');
  const newest = { ...sampleSummary, buyQuantity: '150.000000', netQuantity: '120.000000', version: 12 };
  await act(async () => {
    h.source.emit('trade.changed', changed(newest, 2));
    h.source.emit('trade.changed', changed({ ...sampleSummary, version: 11 }, 1));
    finish(Response.json(summaryResponse([sampleSummary, shortSummary])));
  });
  await positions().findByRole('rowheader', { name: 'MSFT' });
  assert.ok(positionRow('AAPL').getByRole('cell', { name: '120' }));
  assert.equal(h.client.getQueryData<SymbolSummary[]>(queryKey)?.find((row) => row.symbol === 'AAPL')?.version, 12);
  assert.equal(reads, 1);
  await act(async () => { h.source.emit('trade.changed', changed(newest, 2)); });
  assert.equal(reads, 1);
});

test('reconnect refreshes the complete summary passively and merges events received during recovery', async (t) => {
  let finish!: (response: Response) => void;
  const recovery = new Promise<Response>((resolve) => { finish = resolve; });
  const reads: RequestInit[] = [];
  const h = setup(t, async (url, options) => {
    if (url !== '/api/summaries') return Response.json(tradePage([sampleTrade]));
    reads.push(options ?? {});
    return reads.length === 1 ? Response.json(summaryResponse()) : recovery;
  });
  await act(async () => { h.source.emit('stream.ready', ready); });
  openPositions();
  await positions().findByRole('rowheader', { name: 'AAPL' });
  await act(async () => { h.source.emit('error'); });
  assert.ok(positions().getByText(/reconnecting/));
  await act(async () => { h.source.emit('stream.ready', ready); });
  await waitFor(() => assert.equal(reads.length, 2));
  await positions().findByText('Synchronising positions…');
  const updated = { ...sampleSummary, buyQuantity: '130.000000', netQuantity: '100.000000', version: 11 };
  await act(async () => {
    h.source.emit('trade.changed', changed(updated));
    finish(Response.json(summaryResponse([{ ...sampleSummary, version: 10 }])));
  });
  await waitFor(() => assert.equal(h.client.getQueryData<SymbolSummary[]>(queryKey)?.[0]?.version, 11));
  assert.ok(positionRow('AAPL').getByRole('cell', { name: '100' }));
  assert.equal(new Headers(reads[1]!.headers).get('X-Session-Activity'), 'background');
  assert.equal(FakeEventSource.sources.length, 1);
});

test('a cancelled old summary request cannot replace the reconnect baseline', async (t) => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const reads: RequestInit[] = [];
  const h = setup(t, async (url, options) => {
    if (url !== '/api/summaries') return Response.json(tradePage([sampleTrade]));
    reads.push(options ?? {});
    return reads.length === 1 ? pending : Response.json(summaryResponse([{ ...sampleSummary, version: 12 }]));
  });
  await act(async () => { h.source.emit('stream.ready', ready); });
  openPositions();
  await waitFor(() => assert.equal(reads.length, 1));
  await act(async () => { h.source.emit('error'); h.source.emit('stream.ready', ready); });
  await positions().findByRole('rowheader', { name: 'AAPL' });
  assert.equal(reads[0]!.signal?.aborted, true);
  await act(async () => { finish(Response.json(summaryResponse())); });
  assert.equal(h.client.getQueryData<SymbolSummary[]>(queryKey)?.[0]?.version, 12);
});

test('failed reads show retry states and preserve a failed recovery warning until the next snapshot succeeds', async (t) => {
  let reads = 0;
  const h = setup(t, async (url) => {
    if (url !== '/api/summaries') return Response.json(tradePage([sampleTrade]));
    reads += 1;
    return reads % 2 === 1 ? Response.json({ code: 'INTERNAL_ERROR', message: 'Unavailable' }, { status: 500 })
      : Response.json(summaryResponse());
  });
  await act(async () => { h.source.emit('stream.ready', ready); });
  openPositions();
  await positions().findByText('Unable to load positions. Please try again.');
  fireEvent.click(positions().getByRole('button', { name: 'Refresh positions' }));
  await positions().findByRole('rowheader', { name: 'AAPL' });
  fireEvent.click(positions().getByRole('button', { name: 'Refresh positions' }));
  await positions().findByText('Unable to refresh positions. Showing the last received data. Please try again.');
  await act(async () => { h.source.emit('trade.changed', changed({ ...sampleSummary, version: 12 })); });
  assert.ok(positions().getByText(/Unable to refresh positions/));
  fireEvent.click(positions().getByRole('button', { name: 'Refresh positions' }));
  await waitFor(() => assert.equal(h.client.getQueryData<SymbolSummary[]>(queryKey)?.[0]?.version, 12));
  assert.equal(reads, 4);
});

test('empty summaries and exact large quantities have explicit display states', async (t) => {
  let response = summaryResponse([]);
  const h = setup(t, async (url) => Response.json(url === '/api/summaries' ? response : tradePage([])));
  await act(async () => { h.source.emit('stream.ready', ready); });
  openPositions();
  await positions().findByText('No positions yet');
  response = summaryResponse([{ ...sampleSummary, buyQuantity: '9999999999999999999999.999999',
    sellQuantity: '0.000000', netQuantity: '9999999999999999999999.999999' }]);
  fireEvent.click(positions().getByRole('button', { name: 'Refresh positions' }));
  await positions().findByRole('rowheader', { name: 'AAPL' });
  assert.equal(positionRow('AAPL').getAllByRole('cell', { name: '9,999,999,999,999,999,999,999.999999' }).length, 2);
});

test('expired summary sessions hide positions and offer sign-in', async (t) => {
  let expired = 0;
  const h = setup(t, async (url) => url === '/api/summaries'
    ? Response.json({ code: 'UNAUTHENTICATED', message: 'Please log in again.' }, { status: 401 })
    : Response.json(tradePage([sampleTrade])), 'READ_ONLY', () => { expired += 1; });
  await act(async () => { h.source.emit('stream.ready', ready); });
  openPositions();
  await positions().findByText('Your session has expired. Sign in again to view positions.');
  assert.equal(positions().queryByRole('table'), null);
  fireEvent.click(positions().getByRole('button', { name: 'Sign in again' }));
  assert.equal(expired, 1);
});

test('tabs support arrow/Home/End keys and preserve the same loaded summary', async (t) => {
  let reads = 0;
  const h = setup(t, async (url) => {
    if (url === '/api/summaries') { reads += 1; return Response.json(summaryResponse()); }
    return Response.json(tradePage([]));
  });
  await act(async () => { h.source.emit('stream.ready', ready); });
  const tradesTab = screen.getByRole('tab', { name: 'Trades' });
  const summaryTab = screen.getByRole('tab', { name: 'Position Summary' });
  tradesTab.focus();
  fireEvent.keyDown(tradesTab, { key: 'ArrowRight' });
  await positions().findByRole('rowheader', { name: 'AAPL' });
  assert.equal(document.activeElement, summaryTab);
  assert.equal(summaryTab.getAttribute('aria-selected'), 'true');
  fireEvent.keyDown(summaryTab, { key: 'Home' });
  assert.equal(document.activeElement, tradesTab);
  fireEvent.keyDown(tradesTab, { key: 'End' });
  assert.equal(document.activeElement, summaryTab);
  assert.equal(reads, 1);
});

test('switching tabs preserves the actual Create Trade draft', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL) => Response.json(url === '/api/summaries' ? summaryResponse()
    : url === '/api/trades/filter-options' ? tradeOptions : tradePage([sampleTrade])));
  render(<TradeWorkspace user={{ ...signedInTrader, role: 'TRADER' }} onSignedOut={() => {}} />);
  const source = FakeEventSource.sources.at(-1)!;
  await act(async () => { source.emit('stream.ready', ready); });
  const quantity = await screen.findByRole('textbox', { name: 'Quantity' });
  fireEvent.change(quantity, { target: { value: '123.5' } });
  openPositions();
  await positions().findByRole('rowheader', { name: 'AAPL' });
  fireEvent.click(screen.getByRole('tab', { name: 'Trades' }));
  assert.equal((screen.getByRole('textbox', { name: 'Quantity' }) as HTMLInputElement).value, '123.5');
  assert.equal(FakeEventSource.sources.length, 1);
});


test('create, amend and cancel snapshots update positions on either tab without fetching again', async (t) => {
  let reads = 0;
  const zero = { ...flatSummary, instrumentId: sampleSummary.instrumentId, symbol: 'AAPL' };
  const h = setup(t, async (url) => {
    if (url === '/api/summaries') { reads += 1; return Response.json(summaryResponse([zero])); }
    return Response.json(tradePage([]));
  });
  await act(async () => { h.source.emit('stream.ready', ready); });
  openPositions();
  await positions().findByRole('rowheader', { name: 'AAPL' });
  const created = { ...sampleTrade, id: 'f1550000-0000-4000-8000-000000100005',
    quantity: '100.000000', price: '227.4500', version: 1 };
  const bought = { ...zero, buyQuantity: '100.000000', netQuantity: '100.000000',
    buyValue: '22745.0000000000', version: 1 };
  await act(async () => { h.source.emit('trade.changed', { ...changed(bought), type: 'TRADE_CREATED', trade: created }); });
  await positionRow('AAPL').findByRole('cell', { name: 'Long' });
  const amended = { ...created, quantity: '125.000000', version: 2 };
  const increased = { ...bought, buyQuantity: '125.000000', netQuantity: '125.000000',
    buyValue: '28431.2500000000', version: 2 };
  await act(async () => {
    h.source.emit('trade.changed', { ...changed(increased), trade: amended });
    h.source.emit('trade.changed', { ...changed(increased), trade: amended });
    h.source.emit('trade.changed', { ...changed(bought), trade: created });
  });
  await waitFor(() => assert.equal(positionRow('AAPL').getAllByRole('cell', { name: '125' }).length, 2));
  await act(async () => { h.source.emit('trade.changed', { ...changed(increased), trade: { ...amended, book: 'NEW', version: 3 }, summaries: [] }); });
  assert.equal(h.client.getQueryData<SymbolSummary[]>(queryKey)?.[0]?.version, 2);
  fireEvent.click(screen.getByRole('tab', { name: 'Trades' }));
  await act(async () => { h.source.emit('trade.changed', { ...changed({ ...zero, version: 3 }),
    type: 'TRADE_CANCELLED', trade: { ...amended, book: 'NEW', status: 'CANCELLED', version: 4 } }); });
  openPositions();
  await positionRow('AAPL').findByRole('cell', { name: 'Flat' });
  assert.equal(positionRow('AAPL').getAllByRole('cell', { name: '0' }).length, 3);
  assert.equal(reads, 1);
  assert.equal(FakeEventSource.sources.length, 1);
});

test('positions remain available through HTTP when the live stream is unavailable', async (t) => {
  let reads = 0;
  const h = setup(t, async (url) => {
    if (url === '/api/summaries') { reads += 1; return Response.json(summaryResponse()); }
    return Response.json(tradePage([]));
  });
  await act(async () => { h.source.close(); h.source.emit('error'); });
  openPositions();
  await positions().findByRole('rowheader', { name: 'AAPL' });
  assert.ok(positions().getByText(/Live updates unavailable/));
  fireEvent.click(positions().getByRole('button', { name: 'Refresh positions' }));
  await waitFor(() => assert.equal(reads, 2));
});
