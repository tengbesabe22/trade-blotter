import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ApiError } from '../src/api/api-client';
import { tradeApi } from '../src/api/trades/trade-api';
import { amendTradeConflictSchema } from '../src/api/contracts/trades/trade-amend-contract';
import { sampleTrade, cancelledTrade } from './trade-fixtures';

const request = { expectedVersion: 1, changes: { price: '228.5' } };
const amendedTrade = { ...sampleTrade, price: '228.5000', version: 2 };

function stubResponse(t: TestContext, response: Response) {
  const transport: typeof fetch = async () => response;
  return t.mock.method(globalThis, 'fetch', transport);
}

test('amend sends PATCH with cookies, a version and only supplied changes, without an idempotency key', async (t) => {
  const fetchMock = stubResponse(t, Response.json({ trade: amendedTrade }));
  assert.deepEqual(await tradeApi.amend(sampleTrade.id, {
    ...request, changes: { price: '228.5', book: ' ' }, reason: ' Correct price. ',
  }), amendedTrade);
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, '/api/trades/' + sampleTrade.id);
  assert.equal(options?.method, 'PATCH');
  assert.equal(options?.credentials, 'include');
  assert.equal(new Headers(options?.headers).get('Content-Type'), 'application/json');
  assert.equal(new Headers(options?.headers).get('Idempotency-Key'), null);
  assert.deepEqual(JSON.parse(String(options?.body)), {
    expectedVersion: 1, changes: { price: '228.5', book: null }, reason: 'Correct price.',
  });
});

test('amend rejects invalid IDs and invalid or immutable changes before fetching', async (t) => {
  const fetchMock = stubResponse(t, Response.json({ trade: amendedTrade }));
  for (const id of ['not-a-uuid', '../auth/logout']) {
    await assert.rejects(tradeApi.amend(id, request), { name: 'ZodError' });
  }
  const withSymbol = { ...request, changes: { price: '228.5', symbol: 'MSFT' } };
  for (const input of [withSymbol, { ...request, expectedVersion: 0 }, { ...request, changes: {} }]) {
    await assert.rejects(tradeApi.amend(sampleTrade.id, input), { name: 'ZodError' });
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('amend rejects malformed or wrong-trade success responses', async (t) => {
  for (const body of [{}, { trade: { ...amendedTrade, price: 228.5 } }, { trade: { ...amendedTrade, id: cancelledTrade.id } }]) {
    const fetchMock = stubResponse(t, Response.json(body));
    await assert.rejects(tradeApi.amend(sampleTrade.id, request), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'INVALID_RESPONSE');
      return true;
    });
    fetchMock.mock.restore();
  }
});

test('amend treats a non-JSON success response as unconfirmed', async (t) => {
  stubResponse(t, new Response('not json', { status: 200 }));
  await assert.rejects(tradeApi.amend(sampleTrade.id, request), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'INVALID_RESPONSE');
    return true;
  });
});

test('amend preserves conflict state for explicit review, without changing the expected version or retrying', async (t) => {
  for (const status of ['ACTIVE', 'CANCELLED'] as const) {
    const conflict = {
      code: 'TRADE_CONFLICT', message: 'The trade has changed.',
      currentTrade: { ...amendedTrade, status },
    };
    const fetchMock = stubResponse(t, Response.json(conflict, { status: 409 }));
    await assert.rejects(tradeApi.amend(sampleTrade.id, request), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'TRADE_CONFLICT');
      assert.deepEqual(amendTradeConflictSchema.parse(error.responseBody), conflict);
      return true;
    });
    assert.equal(request.expectedVersion, 1);
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});

test('amend preserves ordinary HTTP errors for the form to display or handle session expiry', async (t) => {
  for (const [status, code] of [[400, 'NO_CHANGES'], [401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'TRADE_NOT_FOUND'], [500, 'INTERNAL_ERROR']] as const) {
    const fetchMock = stubResponse(t, Response.json({ code, message: 'Request failed.' }, { status }));
    await assert.rejects(tradeApi.amend(sampleTrade.id, request), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      return true;
    });
    fetchMock.mock.restore();
  }
});

test('amend preserves network failures without automatically retrying', async (t) => {
  const failure = new TypeError('Connection lost.');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw failure; });
  await assert.rejects(tradeApi.amend(sampleTrade.id, request), (error) => error === failure);
  assert.equal(fetchMock.mock.callCount(), 1);
});
