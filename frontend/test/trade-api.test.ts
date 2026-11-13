import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ApiError } from '../src/api/api-client';
import { tradeApi } from '../src/api/trade-api';
import { sampleTrade, cancelledTrade } from './trade-fixtures';

function stubResponse(t: TestContext, response: Response) {
  const transport: typeof fetch = async () => response;
  return t.mock.method(globalThis, 'fetch', transport);
}

test('trade listing uses the session cookie and preserves decimal strings and nullable fields', async (t) => {
  const body = { trades: [sampleTrade, cancelledTrade] };
  const fetchMock = stubResponse(t, Response.json(body));
  const controller = new AbortController();

  assert.deepEqual(await tradeApi.list(controller.signal), body);

  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, '/api/trades');
  assert.equal(options?.method ?? 'GET', 'GET');
  assert.equal(options?.credentials, 'same-origin');
  assert.equal(options?.signal, controller.signal);
});

test('an empty trade list is a valid response', async (t) => {
  stubResponse(t, Response.json({ trades: [] }));
  assert.deepEqual(await tradeApi.list(), { trades: [] });
});

const invalidResponses = [
  { name: 'missing list', body: {} },
  { name: 'numeric quantity', body: { trades: [{ ...sampleTrade, quantity: 5000 }] } },
  { name: 'incorrect price scale', body: { trades: [{ ...sampleTrade, price: '227.45' }] } },
  { name: 'unknown status', body: { trades: [{ ...sampleTrade, status: 'PENDING' }] } },
  { name: 'invalid timestamp', body: { trades: [{ ...sampleTrade, tradeDate: 'yesterday' }] } },
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
