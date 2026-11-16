import assert from 'node:assert/strict';
import test, { after, afterEach } from 'node:test';
import { JSDOM } from 'jsdom';
import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { ApiError } from '../src/api/api-client';
import { useTradeOptions } from '../src/trades/hooks/useTradeOptions';
import { tradeOptions } from './trade-fixtures';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
});
const { renderHook, act, cleanup, waitFor } = await import('@testing-library/react');
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});
after(() => dom.window.close());

function workspaceClient() {
  const client = new QueryClient();
  clients.push(client);
  return client;
}

function mountOptions(client: QueryClient) {
  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(useTradeOptions, { wrapper: Wrapper });
}

test('two consumers share one in-flight lookup and both receive the validated result', async (t) => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const mock = t.mock.method(globalThis, 'fetch', async () => pending);
  const client = workspaceClient();
  const first = mountOptions(client);
  const second = mountOptions(client);
  assert.equal(mock.mock.callCount(), 1);
  assert.equal(first.result.current.isPending, true);
  await act(async () => { finish(Response.json(tradeOptions)); });
  await waitFor(() => assert.deepEqual(first.result.current.data, tradeOptions));
  assert.deepEqual(second.result.current.data, tradeOptions);
  assert.equal(mock.mock.callCount(), 1);
});

test('completed options survive consumer unmount/remount inside the same workspace', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(tradeOptions));
  const client = workspaceClient();
  const first = mountOptions(client);
  await waitFor(() => assert.equal(first.result.current.isSuccess, true));
  first.unmount();
  const second = mountOptions(client);
  assert.deepEqual(second.result.current.data, tradeOptions);
  await act(async () => {});
  assert.equal(mock.mock.callCount(), 1);
});

test('focus, reconnect and trade invalidation do not reload reference options', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(tradeOptions));
  const client = workspaceClient();
  const view = mountOptions(client);
  await waitFor(() => assert.equal(view.result.current.isSuccess, true));
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await client.invalidateQueries({ queryKey: ['trades'] });
  });
  assert.equal(mock.mock.callCount(), 1);
});

test('a fresh workspace starts with a new lookup rather than another account cache', async (t) => {
  let requests = 0;
  const secondOptions = { ...tradeOptions, instruments: [{ symbol: 'MSFT', name: 'Microsoft' }] };
  const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(++requests === 1 ? tradeOptions : secondOptions));
  const first = mountOptions(workspaceClient());
  await waitFor(() => assert.equal(first.result.current.isSuccess, true));
  first.unmount();
  const second = mountOptions(workspaceClient());
  assert.equal(second.result.current.data, undefined);
  await waitFor(() => assert.deepEqual(second.result.current.data, secondOptions));
  assert.equal(mock.mock.callCount(), 2);
});

test('a failed lookup exposes the error without remount retry; explicit retry updates all consumers', async (t) => {
  let requests = 0;
  const mock = t.mock.method(globalThis, 'fetch', async () => ++requests === 1
    ? Response.json({ code: 'UNAVAILABLE', message: 'Try again.' }, { status: 500 })
    : Response.json(tradeOptions));
  const client = workspaceClient();
  const first = mountOptions(client);
  await waitFor(() => assert.equal(first.result.current.isError, true));
  assert.ok(first.result.current.error instanceof ApiError);
  const second = mountOptions(client);
  assert.equal(mock.mock.callCount(), 1);
  await act(async () => { await first.result.current.refetch(); });
  await waitFor(() => assert.deepEqual(second.result.current.data, tradeOptions));
  assert.equal(mock.mock.callCount(), 2);
});

test('pending options are cancelled only when the last consumer leaves', (t) => {
  let signal: AbortSignal | undefined | null;
  const transport: typeof fetch = async (_url, options) => {
    signal = options?.signal;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  };
  t.mock.method(globalThis, 'fetch', transport);
  const client = workspaceClient();
  const first = mountOptions(client);
  const second = mountOptions(client);
  assert.ok(signal);
  first.unmount();
  assert.equal(signal.aborted, false);
  second.unmount();
  assert.equal(signal.aborted, true);
});
