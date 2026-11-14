import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ApiError } from '../src/api/api-client';
import { tradeApi } from '../src/api/trade-api';
import { cancelTradeConflictSchema } from '../src/api/trade-cancel-contract';
import { sampleTrade, cancelledTrade } from './trade-fixtures';

const request = { expectedVersion: 1 };
const result = { ...sampleTrade, status: 'CANCELLED', version: 2 };

function stubResponse(t: TestContext, response: Response) {
  const transport: typeof fetch = async () => response;
  return t.mock.method(globalThis, 'fetch', transport);
}

test('cancel posts the version and normalized reason with cookies and no idempotency key', async (t) => {
  const mock = stubResponse(t, Response.json({ trade: result }));
  assert.deepEqual(await tradeApi.cancel(sampleTrade.id, { ...request, reason: ' Duplicate booking. ' }), result);
  const [url, options] = mock.mock.calls[0].arguments;
  assert.equal(url, '/api/trades/' + sampleTrade.id + '/cancel');
  assert.equal(options?.method, 'POST');
  assert.equal(options?.credentials, 'same-origin');
  assert.equal(new Headers(options?.headers).get('Content-Type'), 'application/json');
  assert.equal(new Headers(options?.headers).get('Idempotency-Key'), null);
  assert.deepEqual(JSON.parse(String(options?.body)), { expectedVersion: 1, reason: 'Duplicate booking.' });
});

test('cancel allows no reason and sends null without mutating the caller input', async (t) => {
  const mock = stubResponse(t, Response.json({ trade: result }));
  await tradeApi.cancel(sampleTrade.id, request);
  assert.deepEqual(JSON.parse(String(mock.mock.calls[0].arguments[1]?.body)), { expectedVersion: 1, reason: null });
  assert.deepEqual(request, { expectedVersion: 1 });
});

test('cancel rejects invalid IDs, versions and extra request fields before fetching', async (t) => {
  const mock = stubResponse(t, Response.json({ trade: result }));
  for (const id of ['not-a-uuid', '../auth/logout']) {
    await assert.rejects(tradeApi.cancel(id, request), { name: 'ZodError' });
  }
  const withStatus = { ...request, status: 'CANCELLED' };
  const withOwner = { ...request, ownerId: 'spoofed' };
  for (const input of [{ expectedVersion: 0 }, withStatus, withOwner]) {
    await assert.rejects(tradeApi.cancel(sampleTrade.id, input), { name: 'ZodError' });
  }
  assert.equal(mock.mock.callCount(), 0);
});

test('cancel rejects malformed, ACTIVE, wrong-trade or wrong-version success responses', async (t) => {
  for (const body of [
    {}, { trade: { ...result, price: 228.5 } }, { trade: sampleTrade },
    { trade: { ...result, id: cancelledTrade.id } }, { trade: { ...result, version: 3 } },
  ]) {
    const mock = stubResponse(t, Response.json(body));
    await assert.rejects(tradeApi.cancel(sampleTrade.id, request), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'INVALID_RESPONSE');
      return true;
    });
    mock.mock.restore();
  }
});

test('a non-JSON cancellation success is unconfirmed', async (t) => {
  stubResponse(t, new Response('not json', { status: 200 }));
  await assert.rejects(tradeApi.cancel(sampleTrade.id, request), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'INVALID_RESPONSE');
    return true;
  });
});

test('cancel retains ACTIVE or already-CANCELLED conflict state without retrying or replacing the version', async (t) => {
  for (const status of ['ACTIVE', 'CANCELLED'] as const) {
    const conflict = { code: 'TRADE_CONFLICT', message: 'Review current state.', currentTrade: { ...result, status } };
    const mock = stubResponse(t, Response.json(conflict, { status: 409 }));
    await assert.rejects(tradeApi.cancel(sampleTrade.id, request), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 409);
      assert.equal(error.code, 'TRADE_CONFLICT');
      assert.deepEqual(cancelTradeConflictSchema.parse(error.responseBody), conflict);
      return true;
    });
    assert.equal(request.expectedVersion, 1);
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test('cancel preserves HTTP errors for validation, authorization and session handling', async (t) => {
  for (const [status, code] of [[400, 'INVALID_INPUT'], [401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'TRADE_NOT_FOUND'], [500, 'INTERNAL_ERROR']] as const) {
    const mock = stubResponse(t, Response.json({ code, message: 'Request failed.' }, { status }));
    await assert.rejects(tradeApi.cancel(sampleTrade.id, request), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      return true;
    });
    mock.mock.restore();
  }
});

test('cancel preserves a network failure without automatically retrying', async (t) => {
  const failure = new TypeError('Connection lost.');
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw failure; });
  await assert.rejects(tradeApi.cancel(sampleTrade.id, request), (error) => error === failure);
  assert.equal(mock.mock.callCount(), 1);
});
