import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { AmendTradeForm } from '../src/trades/AmendTradeForm';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TradesPage } from '../src/trades/TradesPage';
import type { LiveTradePage } from '../src/trades/trade-merge';
import type { Trade } from '../src/api/trade-contract';
import { signedInTrader, sampleTrade, cancelledTrade, tradePage } from './trade-fixtures';

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
const { render, screen, fireEvent, act, cleanup, waitFor } = await import('@testing-library/react');
afterEach(() => cleanup());
after(() => dom.window.close());

const owned: Trade = {
  ...sampleTrade, ownerId: signedInTrader.id, trader: signedInTrader.displayName,
  quantity: '5000.000000', price: '227.4500', tradeDate: '2026-08-18T09:15:23.123Z',
};
const updated: Trade = { ...owned, price: '228.5000', version: 2 };

function showForm(t: TestContext, transport: typeof fetch) {
  const amended: Trade[] = [];
  const events = { discarded: false, expired: false };
  const fetchMock = t.mock.method(globalThis, 'fetch', transport);
  const props = {
    trade: owned,
    onAmended: (trade: Trade) => { amended.push(trade); },
    onDiscard: () => { events.discarded = true; },
    onSessionExpired: () => { events.expired = true; },
  };
  const view = render(<AmendTradeForm {...props} />);
  return { ...view, props, fetchMock, amended, events };
}

function editPrice(value = '228.5') {
  fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value } });
}

function showWorkspace(t: TestContext, transport: typeof fetch, role: 'TRADER' | 'READ_ONLY' = 'TRADER') {
  const fetchMock = t.mock.method(globalThis, 'fetch', transport);
  const client = new QueryClient();
  render(<QueryClientProvider client={client}>
    <TradesPage user={{ ...signedInTrader, role }} onSessionExpired={() => {}} />
  </QueryClientProvider>);
  const page = () => client.getQueriesData<LiveTradePage>({ queryKey: ['trades'] })[0]?.[1];
  return { fetchMock, page };
}

test('only own ACTIVE rows offer Amend, opening the selected trade in the right-hand panel', async (t) => {
  const cancelled = { ...cancelledTrade, ownerId: signedInTrader.id };
  const other = { ...sampleTrade, id: 'f1550000-0000-4000-8000-000000100003', symbol: 'TSLA' };
  showWorkspace(t, async () => Response.json(tradePage([owned, other, cancelled])));
  const button = await screen.findByRole('button', { name: `Amend AAPL trade ${owned.id}` });
  assert.equal(screen.getAllByRole('button', { name: /^Amend / }).length, 1);
  const actionCells = screen.getByRole('grid').querySelectorAll('[role="gridcell"][col-id="actions"]');
  const unavailable = [...actionCells].filter((cell) => !cell.querySelector('button'));
  assert.equal(unavailable.length, 2);
  assert.equal(unavailable.every((cell) => cell.textContent === ''), true);
  fireEvent.click(button);
  const form = await screen.findByRole('form', { name: 'Amend trade' });
  assert.equal((screen.getByLabelText('Price (USD)') as HTMLInputElement).value, '227.4500');
  assert.equal(screen.queryByLabelText('Ticker'), null);
  assert.equal(screen.getByRole('complementary', { name: 'Trade controls' }).contains(form), true);
  assert.equal(screen.getByRole('region', { name: 'Trades' }).contains(form), false);
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  assert.equal(screen.queryByRole('form', { name: 'Amend trade' }), null);
  assert.equal(document.activeElement?.id, 'trades-title');
});

test('reviewers have no Actions column or amendment controls', async (t) => {
  showWorkspace(t, async () => Response.json(tradePage([owned])), 'READ_ONLY');
  await screen.findByText('AAPL');
  assert.equal(screen.queryByRole('columnheader', { name: 'Actions' }), null);
  assert.equal(screen.queryByRole('button', { name: /^Amend / }), null);
});

test('saving merges the PATCH response immediately without waiting for SSE or fetching the page again', async (t) => {
  const h = showWorkspace(t, async (_input, options) => options?.method === 'PATCH'
    ? Response.json({ trade: updated }) : Response.json(tradePage([owned])));
  fireEvent.click(await screen.findByRole('button', { name: `Amend AAPL trade ${owned.id}` }));
  editPrice();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText(/Trade amended: AAPL/);
  await waitFor(() => assert.equal(h.page()?.trades[0]?.price, '228.5000'));
  assert.equal(screen.queryByRole('form', { name: 'Amend trade' }), null);
  assert.equal(h.fetchMock.mock.callCount(), 2);
  const [url, options] = h.fetchMock.mock.calls.find((call) => call.arguments[1]?.method === 'PATCH')!.arguments;
  assert.equal(url, '/api/trades/' + owned.id);
  assert.deepEqual(JSON.parse(String(options?.body)), {
    expectedVersion: 1, changes: { price: '228.5' }, reason: null,
  });
});

test('a late pre-amendment page response cannot overwrite the saved trade', async (t) => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  let reads = 0;
  const h = showWorkspace(t, async (_input, options) => {
    if (options?.method === 'PATCH') return Response.json({ trade: updated });
    reads += 1;
    return reads === 1 ? Response.json(tradePage([owned])) : pending;
  });
  fireEvent.click(await screen.findByRole('button', { name: `Amend AAPL trade ${owned.id}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' }));
  await waitFor(() => assert.equal(reads, 2));
  editPrice();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText(/Trade amended:/);
  await act(async () => { finish(Response.json(tradePage([owned]))); });
  await waitFor(() => assert.equal(h.page()?.trades[0]?.price, '228.5000'));
  assert.equal(h.page()?.trades[0]?.version, 2);
});

test('unchanged fields, equivalent decimals and reason-only edits make no request', async (t) => {
  const h = showForm(t, async () => { throw new Error('Unexpected request.'); });
  editPrice('227.45');
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5000' } });
  fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value: 'Only a comment.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Change at least one trade field.');
  assert.equal(h.fetchMock.mock.callCount(), 0);
});

test('field validation preserves the draft and avoids an API call', async (t) => {
  const h = showForm(t, async () => { throw new Error('Unexpected request.'); });
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText(/Quantity must/);
  assert.equal(screen.getByLabelText('Quantity').getAttribute('aria-invalid'), 'true');
  assert.equal(h.fetchMock.mock.callCount(), 0);
});

test('saving prevents duplicate submissions and disables discard until the request finishes', async (t) => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const h = showForm(t, async () => pending);
  editPrice();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  const saving = await screen.findByRole('button', { name: 'Saving changes…' });
  fireEvent.click(saving);
  assert.equal(saving.hasAttribute('disabled'), true);
  assert.equal(screen.getByRole('button', { name: 'Discard changes' }).hasAttribute('disabled'), true);
  assert.equal(h.fetchMock.mock.callCount(), 1);
  await act(async () => { finish(Response.json({ trade: updated })); });
  assert.deepEqual(h.amended, [updated]);
});

test('a conflict keeps the draft and original version until Load latest is chosen explicitly', async (t) => {
  const latest = { ...updated, price: '229.0000' };
  let calls = 0;
  const h = showForm(t, async () => ++calls === 1
    ? Response.json({ code: 'TRADE_CONFLICT', message: 'Trade changed.', currentTrade: latest }, { status: 409 })
    : Response.json({ trade: { ...latest, price: '231.0000', version: 3 } }));
  editPrice('230');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText(/This trade has changed/);
  assert.equal((screen.getByLabelText('Price (USD)') as HTMLInputElement).value, '230');
  assert.equal(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled'), true);
  fireEvent.click(screen.getByRole('button', { name: 'Load latest' }));
  assert.equal((screen.getByLabelText('Price (USD)') as HTMLInputElement).value, '229.0000');
  editPrice('231');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(h.amended.length, 1));
  const bodies = h.fetchMock.mock.calls.map((call) => JSON.parse(String(call.arguments[1]?.body)));
  assert.deepEqual(bodies.map((body) => body.expectedVersion), [1, 2]);
});

test('live updates warn without replacing the draft; a live cancellation prevents saving', async (t) => {
  const h = showForm(t, async () => { throw new Error('Unexpected request.'); });
  editPrice('230');
  h.rerender(<AmendTradeForm {...h.props} latestTrade={updated} />);
  await screen.findByText(/This trade has changed/);
  assert.equal((screen.getByLabelText('Price (USD)') as HTMLInputElement).value, '230');
  h.rerender(<AmendTradeForm {...h.props} latestTrade={{ ...updated, status: 'CANCELLED' }} />);
  await screen.findByText(/This trade has been cancelled/);
  assert.equal(screen.getByRole('button', { name: 'Save changes' }).hasAttribute('disabled'), true);
  assert.equal(screen.queryByRole('button', { name: 'Load latest' }), null);
  assert.equal(h.fetchMock.mock.callCount(), 0);
});

for (const failure of ['network', 'server', 'invalid-response']) {
  test(`an unconfirmed ${failure} outcome preserves the draft and does not retry automatically`, async (t) => {
    const h = showForm(t, async () => {
      if (failure === 'network') throw new TypeError('Connection lost.');
      return failure === 'server'
        ? Response.json({ code: 'INTERNAL_ERROR', message: 'Failed.' }, { status: 500 })
        : Response.json({ trade: { ...updated, price: 228.5 } });
    });
    editPrice('230');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/outcome is unconfirmed/i);
    assert.equal((screen.getByLabelText('Price (USD)') as HTMLInputElement).value, '230');
    assert.equal(h.fetchMock.mock.callCount(), 1);
    assert.deepEqual(h.amended, []);
  });
}

test('session expiry returns to sign-in', async (t) => {
  const h = showForm(t, async () => Response.json({ code: 'UNAUTHENTICATED', message: 'Sign in.' }, { status: 401 }));
  editPrice();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(h.events.expired, true));
});
