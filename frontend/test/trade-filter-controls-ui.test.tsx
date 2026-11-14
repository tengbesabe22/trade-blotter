import assert from 'node:assert/strict';
import test, { after, afterEach, type TestContext } from 'node:test';
import { useState } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TradeListControls } from '../src/trades/TradeListControls';
import { CreateTradeForm } from '../src/trades/CreateTradeForm';
import { defaultTradeListQuery, type TradeListQuery } from '../src/api/trade-contract';
import { tradeOptions } from './trade-fixtures';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
});
const { render, screen, fireEvent, act, cleanup, waitFor } = await import('@testing-library/react');
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });
after(() => dom.window.close());

function setup(t: TestContext, transport: typeof fetch, withCreate = false) {
  const client = new QueryClient();
  clients.push(client);
  const mock = t.mock.method(globalThis, 'fetch', transport);
  const events = { expired: false, queries: [] as TradeListQuery[] };
  const onSessionExpired = () => { events.expired = true; };
  function Harness() {
    const [query, setQuery] = useState<TradeListQuery>({ ...defaultTradeListQuery, status: 'ACTIVE', side: 'BUY', after: 'old-page' });
    return <QueryClientProvider client={client}>
      <TradeListControls query={query} onSessionExpired={onSessionExpired}
        onChange={(next) => { events.queries.push(next); setQuery(next); }} />
      {withCreate && <CreateTradeForm onCreated={() => {}} onSessionExpired={onSessionExpired} />}
    </QueryClientProvider>;
  }
  render(<Harness />);
  return { mock, events };
}

test('ticker/trader load without blocking existing controls and selections preserve other filters', async (t) => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const h = setup(t, async () => pending);
  assert.equal(screen.getByRole('combobox', { name: 'Ticker filter' }).hasAttribute('disabled'), true);
  assert.equal(screen.getByRole('combobox', { name: 'Trader filter' }).hasAttribute('disabled'), true);
  for (const label of ['Status', 'Side', 'Sort by']) assert.equal(screen.getByLabelText(label).hasAttribute('disabled'), false);
  assert.ok(screen.getByText('Loading filter options…'));
  await act(async () => { finish(Response.json(tradeOptions)); });
  await waitFor(() => assert.equal(screen.getByRole('combobox', { name: 'Ticker filter' }).hasAttribute('disabled'), false));
  fireEvent.change(screen.getByRole('combobox', { name: 'Ticker filter' }), { target: { value: 'MSFT' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Trader filter' }), { target: { value: tradeOptions.traders[0]!.id } });
  assert.deepEqual(h.events.queries.at(-1), { ...defaultTradeListQuery, status: 'ACTIVE', side: 'BUY', symbol: 'MSFT', traderId: tradeOptions.traders[0]!.id, after: undefined });
  assert.equal(h.mock.mock.callCount(), 1);
});

test('lookup retry restores dropdowns while existing filters remain usable', async (t) => {
  let calls = 0;
  const h = setup(t, async () => ++calls === 1
    ? Response.json({ code: 'UNAVAILABLE', message: 'Failed.' }, { status: 500 }) : Response.json(tradeOptions));
  await screen.findByText('Unable to load filter options. Please try again.');
  fireEvent.change(screen.getByLabelText('Side'), { target: { value: 'SELL' } });
  assert.equal(h.events.queries.at(-1)?.side, 'SELL');
  fireEvent.click(screen.getByRole('button', { name: 'Retry filter options' }));
  await waitFor(() => assert.equal(screen.getByRole('combobox', { name: 'Trader filter' }).hasAttribute('disabled'), false));
  assert.equal((screen.getByLabelText('Side') as HTMLSelectElement).value, 'SELL');
  assert.equal(h.mock.mock.callCount(), 2);
});

test('expired lookup sessions use the supplied sign-in callback', async (t) => {
  const h = setup(t, async () => Response.json({ code: 'UNAUTHENTICATED', message: 'Sign in.' }, { status: 401 }));
  await waitFor(() => assert.equal(h.events.expired, true));
  assert.equal(h.mock.mock.callCount(), 1);
});

test('empty reference lists retain All and leave the remaining controls usable', async (t) => {
  setup(t, async () => Response.json({ instruments: [], traders: [] }));
  await screen.findByText('No ticker options available.');
  assert.ok(screen.getByText('No trader options available.'));
  const ticker = screen.getByRole('combobox', { name: 'Ticker filter' });
  assert.equal(ticker.hasAttribute('disabled'), false);
  assert.equal(ticker.querySelectorAll('option').length, 1);
  assert.equal(screen.getByLabelText('Sort by').hasAttribute('disabled'), false);
});

test('Create and filter dropdowns share one pending lookup and do not share their selected values', async (t) => {
  let finish!: (response: Response) => void;
  const h = setup(t, async () => new Promise<Response>((resolve) => { finish = resolve; }), true);
  assert.equal(h.mock.mock.callCount(), 1);
  await act(async () => { finish(Response.json(tradeOptions)); });
  await waitFor(() => assert.equal(screen.getByRole('combobox', { name: 'Ticker filter' }).hasAttribute('disabled'), false));
  fireEvent.change(screen.getByRole('combobox', { name: 'Ticker filter' }), { target: { value: 'MSFT' } });
  assert.equal((screen.getByRole('combobox', { name: 'Ticker' }) as HTMLInputElement).value, '');
  assert.equal(h.mock.mock.callCount(), 1);
});

test('Clear filters stays usable after lookup failure and is disabled once every filter is All', async (t) => {
  const h = setup(t, async () => Response.json({ code: 'UNAVAILABLE', message: 'Failed.' }, { status: 500 }));
  await screen.findByText('Unable to load filter options. Please try again.');
  const clear = screen.getByRole('button', { name: 'Clear filters' });
  assert.equal(clear.hasAttribute('disabled'), false);
  fireEvent.click(clear);
  assert.deepEqual(h.events.queries.at(-1), {
    ...defaultTradeListQuery, symbol: undefined, traderId: undefined, status: undefined, side: undefined,
    book: undefined, counterparty: undefined, after: undefined,
  });
  assert.equal(clear.hasAttribute('disabled'), true);
  fireEvent.click(clear);
  assert.equal(h.events.queries.length, 1);
  assert.equal(h.mock.mock.callCount(), 1);
});


test('text searches apply together only on submission and preserve dropdown filters', async (t) => {
  const h = setup(t, async () => Response.json(tradeOptions));
  await screen.findByRole('option', { name: 'MSFT — Microsoft Corporation' });
  const book = screen.getByRole('textbox', { name: 'Book filter' }) as HTMLInputElement;
  const counterparty = screen.getByRole('textbox', { name: 'Counterparty filter' }) as HTMLInputElement;
  assert.equal(book.maxLength, 64);
  assert.equal(counterparty.maxLength, 120);
  fireEvent.change(book, { target: { value: '  EQUITIES_  ' } });
  fireEvent.change(counterparty, { target: { value: '  Goldman  ' } });
  assert.equal(h.events.queries.length, 0);
  fireEvent.click(screen.getByRole('button', { name: 'Apply text filters' }));
  assert.deepEqual(h.events.queries.at(-1), { ...defaultTradeListQuery, status: 'ACTIVE', side: 'BUY',
    book: 'equities_', counterparty: 'goldman', after: undefined });
  assert.equal(h.events.queries.length, 1);
  assert.equal(screen.getByRole('button', { name: 'Apply text filters' }).hasAttribute('disabled'), true);
  fireEvent.change(book, { target: { value: ' ' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Book and counterparty filters' }));
  assert.equal(h.events.queries.at(-1)?.book, undefined);
  assert.equal(h.events.queries.at(-1)?.counterparty, 'goldman');
  assert.equal(h.events.queries.length, 2);
  assert.equal(h.mock.mock.callCount(), 1);
});

test('Clear filters removes applied text and unapplied drafts even when option lookup fails', async (t) => {
  const h = setup(t, async () => Response.json({}, { status: 500 }));
  await screen.findByText('Unable to load filter options. Please try again.');
  const book = screen.getByRole('textbox', { name: 'Book filter' }) as HTMLInputElement;
  const counterparty = screen.getByRole('textbox', { name: 'Counterparty filter' }) as HTMLInputElement;
  fireEvent.change(book, { target: { value: 'uk' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply text filters' }));
  fireEvent.change(counterparty, { target: { value: 'unsaved' } });
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  assert.equal(book.value, '');
  assert.equal(counterparty.value, '');
  assert.equal(h.events.queries.at(-1)?.book, undefined);
  assert.equal(h.events.queries.at(-1)?.counterparty, undefined);
  assert.equal(screen.getByRole('button', { name: 'Clear filters' }).hasAttribute('disabled'), true);
  const changesBeforeDraft = h.events.queries.length;
  fireEvent.change(book, { target: { value: 'draft only' } });
  assert.equal(screen.getByRole('button', { name: 'Clear filters' }).hasAttribute('disabled'), false);
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  assert.equal(book.value, '');
  assert.equal(h.events.queries.length, changesBeforeDraft);
});
