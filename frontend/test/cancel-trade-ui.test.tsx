import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { CancelTradePanel } from '../src/trades/CancelTradePanel';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TradesPage } from '../src/trades/TradesPage';
import type { LiveTradePage } from '../src/trades/trade-merge';
import type { Trade } from '../src/api/trade-contract';
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
const { render, screen, fireEvent, act, cleanup, waitFor } = await import('@testing-library/react');
afterEach(() => cleanup());
after(() => dom.window.close());

const owned: Trade = {
  ...sampleTrade, ownerId: signedInTrader.id, trader: signedInTrader.displayName,
  quantity: '5000.000000', price: '227.4500', tradeDate: '2026-08-18T09:15:23.123Z',
};
const cancelledResult: Trade = { ...owned, status: 'CANCELLED', version: 2 };

function showPanel(t: TestContext, transport: typeof fetch) {
  const cancelled: Trade[] = [];
  const events = { closed: false, expired: false };
  const fetchMock = t.mock.method(globalThis, 'fetch', transport);
  const props = {
    trade: owned,
    onCancelled: (trade: Trade) => { cancelled.push(trade); },
    onClose: () => { events.closed = true; },
    onSessionExpired: () => { events.expired = true; },
  };
  const view = render(<CancelTradePanel {...props} />);
  return { ...view, props, fetchMock, cancelled, events };
}

function enterReason(value = ' Duplicate booking. ') {
  fireEvent.change(screen.getByLabelText('Reason (optional)'), { target: { value } });
}

function showWorkspace(t: TestContext, transport: typeof fetch, role: 'TRADER' | 'READ_ONLY' = 'TRADER') {
  const fetchMock = t.mock.method(globalThis, 'fetch', transport);
  const client = new QueryClient();
  client.setQueryData(['trade-options'], tradeOptions);
  render(<QueryClientProvider client={client}>
    <TradesPage user={{ ...signedInTrader, role }} onSessionExpired={() => {}} />
  </QueryClientProvider>);
  const page = () => client.getQueriesData<LiveTradePage>({ queryKey: ['trades'] })[0]?.[1];
  return { fetchMock, page };
}

test('only own ACTIVE rows offer Cancel trade, opening a read-only summary without submitting', async (t) => {
  const other = { ...sampleTrade, id: 'f1550000-0000-4000-8000-000000100003', symbol: 'TSLA' };
  const h = showWorkspace(t, async () => Response.json(tradePage([
    owned, other, { ...cancelledTrade, ownerId: signedInTrader.id },
  ])));
  fireEvent.click(await screen.findByRole('button', { name: `Cancel AAPL trade ${owned.id}` }));
  const form = await screen.findByRole('form', { name: 'Cancel trade' });
  assert.equal(screen.getAllByRole('button', { name: /^Cancel .* trade / }).length, 1);
  assert.equal(screen.getByRole('complementary', { name: 'Trade controls' }).contains(form), true);
  assert.equal(screen.getByRole('region', { name: 'Trades' }).contains(form), false);
  assert.ok(screen.getByText('Cancel AAPL trade?'));
  assert.equal(screen.queryByLabelText('Price (USD)') === null, true);
  assert.equal(screen.getByRole('button', { name: /^Amend / }).hasAttribute('disabled'), true);
  assert.equal(h.fetchMock.mock.callCount(), 1);
  fireEvent.click(screen.getByRole('button', { name: 'Keep trade' }));
  assert.equal(screen.queryByRole('form', { name: 'Cancel trade' }) === null, true);
  assert.equal(document.activeElement?.id, 'trades-title');
  assert.equal(h.fetchMock.mock.callCount(), 1);
});

test('reviewers have no cancellation action or Actions column', async (t) => {
  showWorkspace(t, async () => Response.json(tradePage([owned])), 'READ_ONLY');
  await screen.findByText('AAPL');
  assert.equal(screen.queryByRole('columnheader', { name: 'Actions' }) === null, true);
  assert.equal(screen.queryByRole('button', { name: /^Cancel .* trade / }) === null, true);
});

test('confirmation posts only version/reason and immediately retains the CANCELLED row without another GET', async (t) => {
  const h = showWorkspace(t, async (_input, options) => options?.method === 'POST'
    ? Response.json({ trade: cancelledResult }) : Response.json(tradePage([owned])));
  fireEvent.click(await screen.findByRole('button', { name: `Cancel AAPL trade ${owned.id}` }));
  enterReason();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await screen.findByText(/Trade cancelled: AAPL/);
  await waitFor(() => assert.deepEqual(h.page()?.trades, [cancelledResult]));
  assert.equal(screen.queryByRole('form', { name: 'Cancel trade' }) === null, true);
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: /^Cancel .* trade / }) === null, true));
  assert.equal(screen.queryByRole('button', { name: /^Amend / }) === null, true);
  assert.equal(h.fetchMock.mock.callCount(), 2);
  const [url, options] = h.fetchMock.mock.calls.find((call) => call.arguments[1]?.method === 'POST')!.arguments;
  assert.equal(url, '/api/trades/' + owned.id + '/cancel');
  assert.deepEqual(JSON.parse(String(options?.body)), { expectedVersion: 1, reason: 'Duplicate booking.' });
});

test('an older in-flight refresh cannot undo the confirmed cancellation', async (t) => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  let reads = 0;
  const h = showWorkspace(t, async (_input, options) => {
    if (options?.method === 'POST') return Response.json({ trade: cancelledResult });
    return ++reads === 1 ? Response.json(tradePage([owned])) : pending;
  });
  fireEvent.click(await screen.findByRole('button', { name: `Cancel AAPL trade ${owned.id}` }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' }));
  await waitFor(() => assert.equal(reads, 2));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await screen.findByText(/Trade cancelled:/);
  await act(async () => { finish(Response.json(tradePage([owned]))); });
  await waitFor(() => assert.deepEqual(h.page()?.trades, [cancelledResult]));
});

test('reason validation preserves the entered value without submitting', async (t) => {
  const h = showPanel(t, async () => { throw new Error('Unexpected request.'); });
  enterReason('R'.repeat(501));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await screen.findByText('Reason must be at most 500 characters.');
  assert.equal(screen.getByLabelText('Reason (optional)').getAttribute('aria-invalid'), 'true');
  assert.equal(h.fetchMock.mock.callCount(), 0);
});

test('a pending cancellation blocks duplicate submits, editing and closing', async (t) => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const h = showPanel(t, async () => pending);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  assert.equal((await screen.findByRole('button', { name: 'Cancelling trade…' })).hasAttribute('disabled'), true);
  assert.equal((screen.getByLabelText('Reason (optional)') as HTMLTextAreaElement).disabled, true);
  assert.equal(screen.getByRole('button', { name: 'Keep trade' }).hasAttribute('disabled'), true);
  fireEvent.submit(screen.getByRole('form', { name: 'Cancel trade' }));
  assert.equal(h.fetchMock.mock.callCount(), 1);
  await act(async () => { finish(Response.json({ trade: cancelledResult })); });
  assert.deepEqual(h.cancelled, [cancelledResult]);
});

test('an ACTIVE conflict requires explicit review before confirming the newer version', async (t) => {
  const latest = { ...owned, price: '230.0000', version: 2 };
  let calls = 0;
  const h = showPanel(t, async () => ++calls === 1
    ? Response.json({ code: 'TRADE_CONFLICT', message: 'Trade changed.', currentTrade: latest }, { status: 409 })
    : Response.json({ trade: { ...latest, status: 'CANCELLED', version: 3 } }));
  enterReason();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await screen.findByText(/This trade has changed/);
  assert.equal(screen.getByRole('button', { name: 'Confirm cancellation' }).hasAttribute('disabled'), true);
  assert.equal((screen.getByLabelText('Reason (optional)') as HTMLTextAreaElement).value, ' Duplicate booking. ');
  fireEvent.click(screen.getByRole('button', { name: 'Review latest' }));
  await screen.findByText('230.0000');
  assert.equal(h.fetchMock.mock.callCount(), 1);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await waitFor(() => assert.equal(h.cancelled.length, 1));
  const versions = h.fetchMock.mock.calls.map((call) => JSON.parse(String(call.arguments[1]?.body)).expectedVersion);
  assert.deepEqual(versions, [1, 2]);
});

test('an already-CANCELLED conflict disables confirmation and offers Close', async (t) => {
  const h = showPanel(t, async () => Response.json({
    code: 'TRADE_CONFLICT', message: 'Already cancelled.', currentTrade: cancelledResult,
  }, { status: 409 }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await screen.findByText(/This trade is already cancelled/);
  assert.equal(screen.getByRole('button', { name: 'Confirm cancellation' }).hasAttribute('disabled'), true);
  assert.equal(screen.queryByRole('button', { name: 'Review latest' }) === null, true);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  assert.equal(h.events.closed, true);
  assert.deepEqual(h.cancelled, []);
});

test('live changes preserve the reason and do not silently replace the captured version', async (t) => {
  const h = showPanel(t, async () => { throw new Error('Unexpected request.'); });
  enterReason();
  h.rerender(<CancelTradePanel {...h.props} latestTrade={{ ...owned, version: 2 }} />);
  await screen.findByText(/This trade has changed/);
  assert.equal((screen.getByLabelText('Reason (optional)') as HTMLTextAreaElement).value, ' Duplicate booking. ');
  assert.equal(screen.getByRole('button', { name: 'Confirm cancellation' }).hasAttribute('disabled'), true);
  h.rerender(<CancelTradePanel {...h.props} latestTrade={{ ...cancelledResult, version: 3 }} />);
  await screen.findByText(/This trade is already cancelled/);
  assert.equal(screen.queryByRole('button', { name: 'Review latest' }) === null, true);
  assert.equal(h.fetchMock.mock.callCount(), 0);
});

test('a conflict for a different trade cannot replace the confirmation target', async (t) => {
  const h = showPanel(t, async () => Response.json({
    code: 'TRADE_CONFLICT', message: 'Trade changed.', currentTrade: cancelledTrade,
  }, { status: 409 }));
  enterReason();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await screen.findByText(/Unable to read the current trade/);
  assert.equal(screen.queryByRole('button', { name: 'Review latest' }) === null, true);
  assert.deepEqual(h.cancelled, []);
});

for (const failure of ['network', 'server', 'invalid-response']) {
  test(`an unconfirmed ${failure} outcome retains the reason without automatically retrying`, async (t) => {
    const h = showPanel(t, async () => {
      if (failure === 'network') throw new TypeError('Connection lost.');
      return failure === 'server'
        ? Response.json({ code: 'INTERNAL_ERROR', message: 'Failed.' }, { status: 500 })
        : Response.json({ trade: owned });
    });
    enterReason();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    await screen.findByText(/outcome is unconfirmed/i);
    assert.equal((screen.getByLabelText('Reason (optional)') as HTMLTextAreaElement).value, ' Duplicate booking. ');
    assert.equal(h.fetchMock.mock.callCount(), 1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    assert.equal(h.events.closed, true);
    assert.deepEqual(h.cancelled, []);
  });
}

test('a definite rejection preserves the reason and displays the API message', async (t) => {
  const h = showPanel(t, async () => Response.json({ code: 'FORBIDDEN', message: 'Only the owner can cancel.' }, { status: 403 }));
  enterReason();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await screen.findByText('Only the owner can cancel.');
  assert.equal((screen.getByLabelText('Reason (optional)') as HTMLTextAreaElement).value, ' Duplicate booking. ');
  assert.deepEqual(h.cancelled, []);
});

test('session expiry returns to sign-in', async (t) => {
  const h = showPanel(t, async () => Response.json({ code: 'UNAUTHENTICATED', message: 'Sign in.' }, { status: 401 }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
  await waitFor(() => assert.equal(h.events.expired, true));
});
