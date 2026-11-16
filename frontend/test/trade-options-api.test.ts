import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/api/api-client';
import { tradeApi } from '../src/api/trades/trade-api';
import { tradeOptions } from './trade-fixtures';

test('filter options use the session cookie, preserve only the contract and forward cancellation', async (t) => {
  const transport: typeof fetch = async () => Response.json({
    ...tradeOptions,
    traders: [{ ...tradeOptions.traders[0], email: 'private@example.com' }],
  });
  const mock = t.mock.method(globalThis, 'fetch', transport);
  const controller = new AbortController();
  assert.deepEqual(await tradeApi.filterOptions(controller.signal), tradeOptions);
  const [url, options] = mock.mock.calls[0]!.arguments;
  assert.equal(url, '/api/trades/filter-options');
  assert.equal(options?.method ?? 'GET', 'GET');
  assert.equal(options?.credentials, 'include');
  assert.equal(options?.signal, controller.signal);
});

test('empty catalogue lists are valid', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ instruments: [], traders: [] }));
  assert.deepEqual(await tradeApi.filterOptions(), { instruments: [], traders: [] });
});

for (const [name, body] of [
  ['missing instruments', { traders: [] }],
  ['missing traders', { instruments: [] }],
  ['invalid symbol', { ...tradeOptions, instruments: [{ symbol: 123, name: 'Apple Inc.' }] }],
  ['invalid trader ID', { ...tradeOptions, traders: [{ id: 'invalid', displayName: 'JSMITH' }] }],
  ['non-JSON success', null],
] as const) {
  test(`invalid options response: ${name}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => body === null ? new Response('<html>Unexpected</html>') : Response.json(body));
    await assert.rejects(tradeApi.filterOptions(), (error) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
  });
}

for (const status of [401, 500]) {
  test(`options preserve HTTP ${status} for caller error handling`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'LOOKUP_ERROR', message: 'Lookup failed.' }, { status }));
    await assert.rejects(tradeApi.filterOptions(), (error) => error instanceof ApiError && error.status === status && error.code === 'LOOKUP_ERROR');
  });
}

test('network failures remain errors for retry UI', async (t) => {
  const failure = new TypeError('Connection lost.');
  t.mock.method(globalThis, 'fetch', async () => { throw failure; });
  await assert.rejects(tradeApi.filterOptions(), (error) => error === failure);
});
