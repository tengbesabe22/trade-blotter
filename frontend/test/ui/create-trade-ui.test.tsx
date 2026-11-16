import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { CreateTradeForm } from '../../src/trades/components/CreateTradeForm';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sampleTrade, tradeOptions } from '../fixtures/trade-fixtures';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
});
const { render, screen, fireEvent, act, cleanup, waitFor } = await import('@testing-library/react');
afterEach(() => cleanup());
after(() => dom.window.close());

async function setup(t: TestContext, transport: typeof fetch, preload = true) {
  const created: unknown[] = [];
  let expired = false;
  const mock = t.mock.method(globalThis, 'fetch', transport);
  const client = new QueryClient();
  if (preload) client.setQueryData(['trade-options'], tradeOptions);
  render(<QueryClientProvider client={client}><CreateTradeForm onCreated={(trade) => { created.push(trade); }}
    onSessionExpired={() => { expired = true; }} /></QueryClientProvider>);
  await screen.findByLabelText('Ticker');
  return { mock, client, created, isExpired: () => expired };
}

function fillTrade() {
  fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'apple' } });
  fireEvent.click(screen.getByRole('option', { name: /AAPL/ }));
  for (const [label, value] of [
    ['Quantity', '5000.000001'], ['Price (USD)', '227.4501'],
    ['Execution time (UTC)', '2026-11-13T09:00:00'], ['Book', ' EQUITIES_US '],
  ]) {
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  }
}

test('create is immediately available and Reset form clears inputs without closing it', async (t) => {
  const h = await setup(t, async () => { throw new Error('Unexpected API call.'); });
  fillTrade();
  fireEvent.click(screen.getByRole('button', { name: 'Reset form' }));
  assert.equal((screen.getByLabelText('Ticker') as HTMLInputElement).value, '');
  assert.equal((screen.getByLabelText('Quantity') as HTMLInputElement).value, '');
  assert.ok(screen.getByRole('button', { name: 'Create trade' }));
  assert.equal(h.mock.mock.callCount(), 0);
});

test('create validates fields before making a request', async (t) => {
  const h = await setup(t, async () => { throw new Error('Unexpected API call.'); });
  fillTrade();
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
  await screen.findByText(/Quantity must/);
  assert.equal(h.mock.mock.callCount(), 0);
});

test('create submits decimal strings, UTC time and an idempotency key, then reports success', async (t) => {
  const h = await setup(t, async () => Response.json({ trade: sampleTrade }, { status: 201 }));
  fillTrade();
  fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
  await screen.findByText(/Trade created/);
  const [url, options] = h.mock.mock.calls[0]!.arguments;
  assert.equal(url, '/api/trades');
  assert.equal(options?.method, 'POST');
  assert.equal(options?.credentials, 'include');
  assert.ok(new Headers(options?.headers).get('Idempotency-Key'));
  assert.deepEqual(JSON.parse(String(options?.body)), {
    symbol: 'AAPL', side: 'BUY', quantity: '5000.000001', price: '227.4501',
    tradeDate: '2026-11-13T09:00:00.000Z', book: 'EQUITIES_US', counterparty: null,
  });
  assert.deepEqual(h.created, [sampleTrade]);
  assert.equal((screen.getByLabelText('Ticker') as HTMLInputElement).value, '');
  assert.ok(screen.getByRole('button', { name: 'Create trade' }));
});

test('pending create prevents duplicate submission', async (t) => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  const h = await setup(t, async () => pending);
  fillTrade();
  fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
  const button = await screen.findByRole('button', { name: 'Saving trade…' });
  assert.equal(button.hasAttribute('disabled'), true);
  assert.equal((screen.getByLabelText('Ticker') as HTMLInputElement).disabled, true);
  fireEvent.click(button);
  assert.equal(h.mock.mock.callCount(), 1);
  await act(async () => { resolve(Response.json({ trade: sampleTrade }, { status: 201 })); });
  await screen.findByText(/Trade created/);
});

for (const failure of ['network', 'server', 'invalid-response']) {
  test(`an uncertain ${failure} result reuses the exact submission and key`, async (t) => {
    let calls = 0;
    const h = await setup(t, async () => {
      calls += 1;
      if (calls === 1) {
        if (failure === 'network') throw new TypeError('Failed to fetch');
        if (failure === 'server') return Response.json({ code: 'INTERNAL_ERROR', message: 'Failed.' }, { status: 500 });
        return Response.json({ trade: { ...sampleTrade, price: 227.45 } }, { status: 201 });
      }
      return Response.json({ trade: sampleTrade }, { status: 201 });
    });
    fillTrade();
    fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
    await screen.findByText(/outcome is unconfirmed/i);
    assert.equal(screen.getByLabelText('Ticker').closest('fieldset')?.disabled, true);
    act(() => { h.client.setQueryData(['trade-options'], { instruments: [], traders: [] }); });
    fireEvent.click(screen.getByRole('button', { name: 'Retry trade' }));
    await screen.findByText(/Trade created/);
    const requests = h.mock.mock.calls.map((call) => call.arguments[1]!);
    assert.equal(new Headers(requests[0]?.headers).get('Idempotency-Key'), new Headers(requests[1]?.headers).get('Idempotency-Key'));
    assert.equal(requests[0]?.body, requests[1]?.body);
    assert.equal(h.created.length, 1);
  });
}

test('unknown instruments show a useful error and preserve editable fields', async (t) => {
  const h = await setup(t, async () => Response.json({
    code: 'UNKNOWN_INSTRUMENT', message: 'The specified instrument does not exist.',
  }, { status: 400 }));
  fillTrade();
  fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
  await screen.findByText(/selected instrument is unavailable/i);
  assert.equal((screen.getByLabelText('Ticker') as HTMLInputElement).value, 'AAPL');
  await waitFor(() => assert.equal(screen.getByLabelText('Ticker').closest('fieldset')?.disabled, false));
  assert.equal(h.created.length, 0);
});

test('a create session error offers reauthentication', async (t) => {
  const h = await setup(t, async () => Response.json({ code: 'UNAUTHENTICATED', message: 'Please log in again.' }, { status: 401 }));
  fillTrade();
  fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
  await waitFor(() => assert.equal(h.isExpired(), true));
});


test('loading options blocks new creation, then company-name selection submits a symbol without refetching options', async (t) => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const h = await setup(t, async (url) => url === '/api/trades/filter-options'
    ? pending : Response.json({ trade: { ...sampleTrade, symbol: 'MSFT' } }, { status: 201 }), false);
  assert.ok(screen.getByText('Loading instruments…'));
  assert.equal(screen.getByLabelText('Ticker').hasAttribute('disabled'), true);
  assert.equal(screen.getByRole('button', { name: 'Create trade' }).hasAttribute('disabled'), true);
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '123' } });
  await act(async () => { finish(Response.json(tradeOptions)); });
  await waitFor(() => assert.equal(screen.getByLabelText('Ticker').hasAttribute('disabled'), false));
  fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'microsoft' } });
  const input = screen.getByRole('combobox', { name: 'Ticker' });
  fireEvent.keyDown(input, { key: 'Enter' });
  assert.equal(h.mock.mock.callCount(), 1);
  assert.equal((input as HTMLInputElement).value, 'MSFT');
  fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '400' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
  await screen.findByText(/Trade created: MSFT/);
  const body = JSON.parse(String(h.mock.mock.calls[1]?.arguments[1]?.body));
  assert.equal(body.symbol, 'MSFT');
  assert.equal(body.quantity, '123');
  assert.equal(h.mock.mock.callCount(), 2);
});

test('lookup failure preserves entered fields, blocks forced submission and supports explicit retry', async (t) => {
  let calls = 0;
  const h = await setup(t, async () => ++calls === 1
    ? Response.json({ code: 'UNAVAILABLE', message: 'Failed.' }, { status: 500 })
    : Response.json(tradeOptions), false);
  await screen.findByText('Unable to load instruments. Please try again.');
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '123' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Create trade' }).closest('form')!);
  assert.equal(h.mock.mock.callCount(), 1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry instruments' }));
  await waitFor(() => assert.equal(screen.getByLabelText('Ticker').hasAttribute('disabled'), false));
  assert.equal((screen.getByLabelText('Quantity') as HTMLInputElement).value, '123');
  assert.equal(h.mock.mock.callCount(), 2);
});

test('an empty catalogue explains why creation is unavailable', async (t) => {
  const h = await setup(t, async () => Response.json({ instruments: [], traders: [] }), false);
  await screen.findByText('No instruments available.');
  assert.equal(screen.getByLabelText('Ticker').hasAttribute('disabled'), true);
  assert.equal(screen.getByRole('button', { name: 'Create trade' }).hasAttribute('disabled'), true);
  assert.ok(screen.getByRole('button', { name: 'Retry instruments' }));
  assert.equal(h.mock.mock.callCount(), 1);
});

test('an expired lookup session uses the existing sign-in callback', async (t) => {
  const h = await setup(t, async () => Response.json({ code: 'UNAUTHENTICATED', message: 'Sign in.' }, { status: 401 }), false);
  await waitFor(() => assert.equal(h.isExpired(), true));
  assert.equal(h.mock.mock.callCount(), 1);
});

test('search text alone cannot create a trade and Reset clears an unfinished search', async (t) => {
  const h = await setup(t, async () => { throw new Error('Unexpected POST.'); });
  fillTrade();
  fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'not-a-ticker' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
  await screen.findByText('Choose an instrument from the list.');
  assert.equal(screen.getByLabelText('Ticker').getAttribute('aria-invalid'), 'true');
  assert.equal(h.mock.mock.callCount(), 0);
  fireEvent.click(screen.getByRole('button', { name: 'Reset form' }));
  assert.equal((screen.getByLabelText('Ticker') as HTMLInputElement).value, '');
  assert.equal(screen.queryByRole('listbox') === null, true);
  assert.equal((screen.getByLabelText('Quantity') as HTMLInputElement).value, '');
});
