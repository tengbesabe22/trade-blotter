import assert from 'node:assert/strict';
import test from 'node:test';
import { tradeApi } from '../src/api/trade-api';
import { ApiError } from '../src/api/api-client';
import { sampleSummary, summaryResponse } from './trade-summary-fixtures';

test('summaries use an unfiltered cookie-authenticated GET and forward the abort signal', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(summaryResponse()));
  const controller = new AbortController();
  assert.deepEqual(await tradeApi.summaries(controller.signal), summaryResponse());
  const [url, options] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
  assert.equal(url, '/api/summaries');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.signal, controller.signal);
  assert.equal(options.body, undefined);
  assert.equal(new Headers(options.headers).get('X-Session-Activity'), null);
});

test('automatic summary recovery reads remain passive', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(summaryResponse()));
  await tradeApi.summaries(undefined, 'background');
  const [, options] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
  assert.equal(new Headers(options.headers).get('X-Session-Activity'), 'background');
});

test('empty summaries are a valid complete baseline', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(summaryResponse([])));
  assert.deepEqual(await tradeApi.summaries(), summaryResponse([]));
});

test('invalid summary responses fail before entering the cache', async (t) => {
  let body: unknown;
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  for (body of [null, {}, { ...summaryResponse(), schemaVersion: 2 },
    { ...summaryResponse(), summaries: [{ ...sampleSummary, buyQuantity: 100 }] },
    summaryResponse([sampleSummary, { ...sampleSummary, instrumentId: sampleSummary.instrumentId.toUpperCase() }]),
  ]) {
    await assert.rejects(tradeApi.summaries(), (error: unknown) =>
      error instanceof ApiError && error.code === 'INVALID_RESPONSE');
  }
});

for (const status of [401, 500]) {
  test(`summary reads preserve structured HTTP ${status} failures`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ code: 'TEST_ERROR', message: 'Try again.' }, { status }));
    await assert.rejects(tradeApi.summaries(), (error: unknown) =>
      error instanceof ApiError && error.status === status && error.code === 'TEST_ERROR');
  });
}

test('summary network failures are not retried by the API client', async (t) => {
  const failure = new TypeError('Network unavailable');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw failure; });
  await assert.rejects(tradeApi.summaries(), (error) => error === failure);
  assert.equal(fetchMock.mock.callCount(), 1);
});
