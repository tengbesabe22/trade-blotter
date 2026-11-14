import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ApiError } from '../src/api/api-client';
import { tradeApi } from '../src/api/trade-api';
import { sampleHistory } from './trade-history-fixtures';
import { sampleTrade, cancelledTrade } from './trade-fixtures';

function stubResponse(t: TestContext, response: Response) {
  const transport: typeof fetch = async () => response;
  return t.mock.method(globalThis, 'fetch', transport);
}

test('history sends a cookie-authenticated GET for one trade and forwards the abort signal', async (t) => {
  const fetchMock = stubResponse(t, Response.json(sampleHistory));
  const controller = new AbortController();
  assert.deepEqual(await tradeApi.history(sampleTrade.id.toUpperCase(), controller.signal), sampleHistory);
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, `/api/trades/${sampleTrade.id}/history`);
  assert.equal(options?.method ?? 'GET', 'GET');
  assert.equal(options?.credentials, 'same-origin');
  assert.equal(options?.signal, controller.signal);
  assert.equal(options?.body, undefined);
  assert.equal(new Headers(options?.headers).get('X-Session-Activity'), null);
});

test('history rejects invalid IDs before sending a request', async (t) => {
  const fetchMock = stubResponse(t, Response.json(sampleHistory));
  for (const id of ['not-a-uuid', '../auth/logout']) {
    await assert.rejects(tradeApi.history(id), { name: 'ZodError' });
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('history accepts an empty result for the requested trade', async (t) => {
  const empty = { ...sampleHistory, entries: [] };
  stubResponse(t, Response.json(empty));
  assert.deepEqual(await tradeApi.history(sampleTrade.id), empty);
});

test('history rejects malformed success payloads and responses for another trade, even when empty', async (t) => {
  for (const body of [
    {},
    { ...sampleHistory, entries: null },
    { ...sampleHistory, tradeId: cancelledTrade.id, entries: [] },
  ]) {
    const fetchMock = stubResponse(t, Response.json(body));
    await assert.rejects(tradeApi.history(sampleTrade.id), (error) =>
      error instanceof ApiError && error.code === 'INVALID_RESPONSE');
    fetchMock.mock.restore();
  }
});

test('history rejects non-JSON success payloads', async (t) => {
  stubResponse(t, new Response('<html>Unexpected</html>'));
  await assert.rejects(tradeApi.history(sampleTrade.id), (error) =>
    error instanceof ApiError && error.code === 'INVALID_RESPONSE');
});

test('history preserves session, missing-trade and server errors for the view', async (t) => {
  for (const [status, code] of [[401, 'UNAUTHENTICATED'], [404, 'TRADE_NOT_FOUND'], [500, 'INTERNAL_ERROR']] as const) {
    const fetchMock = stubResponse(t, Response.json({ code, message: 'Request failed.' }, { status }));
    await assert.rejects(tradeApi.history(sampleTrade.id), (error) =>
      error instanceof ApiError && error.status === status && error.code === code);
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});

test('history preserves network failures and cancellation without retrying', async (t) => {
  for (const failure of [new TypeError('Connection lost.'), new DOMException('Aborted', 'AbortError')]) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw failure; });
    await assert.rejects(tradeApi.history(sampleTrade.id), (error) => error === failure);
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});

test('background history requests suppress session activity without changing the endpoint', async (t) => {
  const fetchMock = stubResponse(t, Response.json(sampleHistory));
  await tradeApi.history(sampleTrade.id, undefined, 'background');
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, `/api/trades/${sampleTrade.id}/history`);
  assert.equal(new Headers(options?.headers).get('X-Session-Activity'), 'background');
});
