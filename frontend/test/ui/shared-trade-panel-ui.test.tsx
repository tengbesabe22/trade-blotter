import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { TradeWorkspace } from '../../src/trades/TradeWorkspace';
import { signedInTrader, sampleTrade, tradePage, tradeOptions } from '../fixtures/trade-fixtures';

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

const owned = { ...sampleTrade, ownerId: signedInTrader.id };

function showWorkspace(t: TestContext, transport: typeof fetch) {
  const requests = t.mock.fn(transport);
  const lookups = t.mock.fn(async () => Response.json(tradeOptions));
  const fetcher: typeof fetch = (url, options) => url === '/api/trades/filter-options' ? lookups() : requests(url, options);
  t.mock.method(globalThis, 'fetch', fetcher);
  render(<TradeWorkspace user={{ ...signedInTrader, role: 'TRADER' }} onSignedOut={() => {}} />);
  return { requests, lookups };
}

function createDraft() {
  const panel = screen.getByRole('region', { name: 'Create a trade' });
  fireEvent.change(within(panel).getByLabelText('Ticker'), { target: { value: 'microsoft' } });
  fireEvent.click(within(panel).getByRole('option', { name: /MSFT/ }));
  for (const [label, value] of [['Quantity', '321'], ['Price (USD)', '400']]) {
    fireEvent.change(within(panel).getByLabelText(label!), { target: { value } });
  }
  return panel;
}

for (const action of ['amend', 'cancel'] as const) {
  const actionName = action === 'amend' ? 'Amend' : 'Cancel';
  const formName = action === 'amend' ? 'Amend trade' : 'Cancel trade';
  const closeName = action === 'amend' ? 'Discard changes' : 'Keep trade';

  test(`${action} replaces creation in the sidebar and closing restores its draft`, async (t) => {
    const h = showWorkspace(t, async () => Response.json(tradePage([owned])));
    const button = await screen.findByRole('button', { name: `${actionName} AAPL trade ${owned.id}` });
    createDraft();
    const grid = screen.getByRole('grid');
    fireEvent.click(button);
    const form = await screen.findByRole('form', { name: formName });
    assert.equal(screen.getByRole('complementary', { name: 'Trade controls' }).contains(form), true);
    assert.equal(screen.queryByRole('region', { name: 'Create a trade' }) === null, true);
    assert.equal(screen.getByRole('button', { name: /^Amend .* trade / }).hasAttribute('disabled'), true);
    assert.equal(screen.getByRole('button', { name: /^Cancel .* trade / }).hasAttribute('disabled'), true);
    fireEvent.click(screen.getByRole('button', { name: closeName }));
    const restored = screen.getByRole('region', { name: 'Create a trade' });
    assert.equal((within(restored).getByLabelText('Ticker') as HTMLInputElement).value, 'MSFT');
    assert.equal((within(restored).getByLabelText('Quantity') as HTMLInputElement).value, '321');
    assert.equal(screen.getByRole('grid') === grid, true);
    assert.equal(h.requests.mock.callCount(), 1);
    assert.equal(h.lookups.mock.callCount(), 1);
  });

  test(`successful ${action} returns to the saved creation draft without another GET`, async (t) => {
    const h = showWorkspace(t, async (_url, options) => options?.method
      ? Response.json({ trade: { ...owned, version: 2,
          ...(action === 'amend' ? { price: '228.5000' } : { status: 'CANCELLED' }),
        } })
      : Response.json(tradePage([owned])));
    const button = await screen.findByRole('button', { name: `${actionName} AAPL trade ${owned.id}` });
    createDraft();
    fireEvent.click(button);
    const form = await screen.findByRole('form', { name: formName });
    assert.equal(screen.getByRole('complementary', { name: 'Trade controls' }).contains(form), true);
    if (action === 'amend') fireEvent.change(within(form).getByLabelText('Price (USD)'), { target: { value: '228.5' } });
    fireEvent.click(within(form).getByRole('button', { name: action === 'amend' ? 'Save changes' : 'Confirm cancellation' }));
    await screen.findByText(action === 'amend' ? /Trade amended:/ : /Trade cancelled:/);
    const restored = screen.getByRole('region', { name: 'Create a trade' });
    assert.equal((within(restored).getByLabelText('Ticker') as HTMLInputElement).value, 'MSFT');
    assert.equal(screen.queryByRole('form', { name: formName }) === null, true);
    assert.equal(h.requests.mock.callCount(), 2);
    assert.equal(h.lookups.mock.callCount(), 1);
  });
}

test('pending and unconfirmed creation block row actions until the same submission succeeds', async (t) => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  let writes = 0;
  showWorkspace(t, async (_url, options) => {
    if (options?.method !== 'POST') return Response.json(tradePage([owned]));
    return ++writes === 1 ? pending : Response.json({ trade: sampleTrade }, { status: 201 });
  });
  await screen.findByRole('button', { name: /^Amend .* trade / });
  createDraft();
  fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
  await screen.findByRole('button', { name: 'Saving trade…' });
  for (const name of [/^Amend .* trade /, /^Cancel .* trade /]) {
    const button = screen.getByRole('button', { name });
    assert.equal(button.hasAttribute('disabled'), true);
    fireEvent.click(button);
  }
  assert.ok(screen.getByRole('region', { name: 'Create a trade' }));
  await act(async () => { finish(Response.json({ code: 'INTERNAL_ERROR', message: 'Failed.' }, { status: 500 })); });
  await screen.findByRole('button', { name: 'Retry trade' });
  assert.equal(screen.getByRole('button', { name: /^Amend .* trade / }).hasAttribute('disabled'), true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry trade' }));
  await screen.findByText(/Trade created:/);
  await waitFor(() => assert.equal(screen.getByRole('button', { name: /^Amend .* trade / }).hasAttribute('disabled'), false));
});
