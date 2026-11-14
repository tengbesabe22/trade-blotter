import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { CreateTradeForm } from '../src/trades/CreateTradeForm';
import { sampleTrade } from './trade-fixtures';

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

async function setup(t: TestContext, transport: typeof fetch) {
  const created: unknown[] = [];
  let expired = false;
  const mock = t.mock.method(globalThis, 'fetch', transport);
  render(<CreateTradeForm onCreated={(trade) => { created.push(trade); }}
    onSessionExpired={() => { expired = true; }} />);
  await screen.findByLabelText('Ticker');
  return { mock, created, isExpired: () => expired };
}

function fillTrade() {
  for (const [label, value] of [
    ['Ticker', 'aapl'], ['Quantity', '5000.000001'], ['Price (USD)', '227.4501'],
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
  assert.equal(options?.credentials, 'same-origin');
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
  await screen.findByText(/seeded instrument/i);
  assert.equal((screen.getByLabelText('Ticker') as HTMLInputElement).value, 'aapl');
  await waitFor(() => assert.equal(screen.getByLabelText('Ticker').closest('fieldset')?.disabled, false));
  assert.equal(h.created.length, 0);
});

test('a create session error offers reauthentication', async (t) => {
  const h = await setup(t, async () => Response.json({ code: 'UNAUTHENTICATED', message: 'Please log in again.' }, { status: 401 }));
  fillTrade();
  fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
  await waitFor(() => assert.equal(h.isExpired(), true));
});
