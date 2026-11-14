import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ApiError } from '../src/api/api-client';
import { defaultTradeListQuery } from '../src/api/trade-contract';
import { tradeApi } from '../src/api/trade-api';
import { sampleTrade, cancelledTrade, tradePage } from './trade-fixtures';

function stubResponse(t: TestContext, response: Response) {
  const transport: typeof fetch = async () => response;
  return t.mock.method(globalThis, 'fetch', transport);
}

test('trade listing uses the session cookie and preserves decimal strings and nullable fields', async (t) => {
  const body = tradePage([sampleTrade, cancelledTrade]);
  const fetchMock = stubResponse(t, Response.json(body));
  const controller = new AbortController();

  assert.deepEqual(await tradeApi.list(undefined, controller.signal), body);

  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, '/api/trades?limit=100&sortBy=tradeDate&sortDirection=desc');
  assert.equal(options?.method ?? 'GET', 'GET');
  assert.equal(options?.credentials, 'same-origin');
  assert.equal(new Headers(options?.headers).get('X-Session-Activity'), null);
  assert.equal(options?.signal, controller.signal);
});

test('an empty trade list is a valid response', async (t) => {
  stubResponse(t, Response.json(tradePage()));
  assert.deepEqual(await tradeApi.list(), tradePage());
});

const invalidResponses = [
  { name: 'missing list', body: {} },
  { name: 'numeric quantity', body: { ...tradePage(), trades: [{ ...sampleTrade, quantity: 5000 }] } },
  { name: 'incorrect price scale', body: { ...tradePage(), trades: [{ ...sampleTrade, price: '227.45' }] } },
  { name: 'unknown status', body: { ...tradePage(), trades: [{ ...sampleTrade, status: 'PENDING' }] } },
  { name: 'invalid timestamp', body: { ...tradePage(), trades: [{ ...sampleTrade, tradeDate: 'yesterday' }] } },
  { name: 'non-JSON body', body: null },
];

for (const { name, body } of invalidResponses) {
  test(`invalid trade response: ${name}`, async (t) => {
    stubResponse(t, body === null
      ? new Response('<html>Not trade data</html>')
      : Response.json(body));

    await assert.rejects(tradeApi.list(), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'INVALID_RESPONSE');
      return true;
    });
  });
}

test('trade listing preserves HTTP failures for session-expiry handling', async (t) => {
  stubResponse(t, Response.json({
    code: 'UNAUTHENTICATED', message: 'Please log in again.',
  }, { status: 401 }));

  await assert.rejects(tradeApi.list(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.equal(error.code, 'UNAUTHENTICATED');
    return true;
  });
});

test('trade listing serialises the active page query and cursor', async (t) => {
  const mock = stubResponse(t, Response.json(tradePage()));
  await tradeApi.list({ limit: 25, sortBy: 'price', sortDirection: 'asc', after: 'opaque-cursor' });
  const url = new URL(String(mock.mock.calls[0].arguments[0]), 'http://localhost');
  assert.equal(url.searchParams.get('limit'), '25');
  assert.equal(url.searchParams.get('sortBy'), 'price');
  assert.equal(url.searchParams.get('sortDirection'), 'asc');
  assert.equal(url.searchParams.get('after'), 'opaque-cursor');
  assert.equal(url.searchParams.has('before'), false);
});

for (const [name, body] of [
  ['missing page metadata', { trades: [] }],
  ['empty next cursor', tradePage([], { nextCursor: '' })],
  ['overlong next cursor', tradePage([], { nextCursor: 'a'.repeat(2049) })],
  ['over-limit page size', tradePage([], { limit: 201 })],
  ['more rows than the declared limit', tradePage([sampleTrade, cancelledTrade], { limit: 1 })],
  ['unsupported schema version', { ...tradePage(), schemaVersion: 2 }],
] as const) {
  test(`invalid page response: ${name}`, async (t) => {
    stubResponse(t, Response.json(body));
    await assert.rejects(tradeApi.list(), (error) => error instanceof ApiError && error.code === 'INVALID_RESPONSE');
  });
}

test('background trade reads send the activity hint while retaining session credentials', async (t) => {
  const fetchMock = stubResponse(t, Response.json(tradePage()));
  await tradeApi.list(undefined, undefined, 'background');
  const options = fetchMock.mock.calls[0].arguments[1];
  assert.equal(new Headers(options?.headers).get('X-Session-Activity'), 'background');
  assert.equal(options?.credentials, 'same-origin');
});


test('listing sends the selected Status and Side as server query parameters', async (t) => {
  const mock = stubResponse(t, Response.json(tradePage()));
  await tradeApi.list({ ...defaultTradeListQuery, status: 'ACTIVE', side: 'SELL' });
  const url = new URL(String(mock.mock.calls[0].arguments[0]), 'http://localhost');
  assert.deepEqual(url.searchParams.getAll('status'), ['ACTIVE']);
  assert.deepEqual(url.searchParams.getAll('side'), ['SELL']);
});

for (const field of ['status', 'side'] as const) {
  test(`an unsupported ${field} filter is rejected before fetch`, async (t) => {
    const mock = stubResponse(t, Response.json(tradePage()));
    await assert.rejects(tradeApi.list({ ...defaultTradeListQuery, [field]: 'UNKNOWN' } as never));
    assert.equal(mock.mock.callCount(), 0);
  });
}


test('listing serializes ticker and trader ID alongside Status and Side', async (t) => {
  const mock = stubResponse(t, Response.json(tradePage()));
  await tradeApi.list({ ...defaultTradeListQuery, symbol: ' msft ', traderId: sampleTrade.ownerId,
    status: 'ACTIVE', side: 'BUY' });
  const url = new URL(String(mock.mock.calls[0]!.arguments[0]), 'http://localhost');
  assert.equal(url.searchParams.get('symbol'), 'MSFT');
  assert.equal(url.searchParams.get('traderId'), sampleTrade.ownerId);
  assert.equal(url.searchParams.get('status'), 'ACTIVE');
  assert.equal(url.searchParams.get('side'), 'BUY');
});

test('an invalid trader ID is rejected before listing fetches', async (t) => {
  const mock = stubResponse(t, Response.json(tradePage()));
  await assert.rejects(tradeApi.list({ ...defaultTradeListQuery, traderId: 'JSMITH' }));
  assert.equal(mock.mock.callCount(), 0);
});
