import assert from 'node:assert/strict';
import test from 'node:test';
import { captureLogs } from '../fixtures/log-fixtures';
import { createTradeBroadcaster } from '../../src/trades/sse/trade-broadcaster';
import type { TradeChange } from '../../src/trades/sse/trade-stream-contract';

const change: TradeChange = {
  changeId: 'd197282d-99ca-4260-833a-702f97d1cba2',
  type: 'TRADE_CREATED',
  occurredAt: '2026-11-13T09:00:00.000Z',
  summaries: [{
    instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: 'AAPL', currency: 'USD',
    buyQuantity: '5000.000000', sellQuantity: '0.000000', netQuantity: '5000.000000',
    buyValue: '1137250.0000000000', sellValue: '0.0000000000',
    version: 9, updatedAt: '2026-11-13T09:01:00.000Z',
  }],
  trade: {
    id: 'f1550000-0000-4000-8000-000000100003',
    symbol: 'AAPL', side: 'BUY', quantity: '5000.000000', price: '227.4500',
    trader: 'JSMITH', ownerId: 'd197282d-99ca-4260-833a-702f97d1cba1',
    book: null, counterparty: null, status: 'ACTIVE', version: 1,
    tradeDate: '2026-11-13T09:00:00.000Z',
    createdAt: '2026-11-13T09:00:00.000Z', updatedAt: '2026-11-13T09:00:00.000Z',
  },
};

const nextChange: TradeChange = { ...change, changeId: 'd197282d-99ca-4260-833a-702f97d1cba3' };

test('broadcaster sends events in order to both subscribers and removes cancelled subscribers', async () => {
  const broadcaster = createTradeBroadcaster();
  const first = broadcaster.subscribe().getReader();
  const second = broadcaster.subscribe().getReader();

  try {
    broadcaster.broadcast(change);
    broadcaster.broadcast(nextChange);

    for (const reader of [first, second]) {
      assert.deepEqual((await reader.read()).value, change);
      assert.deepEqual((await reader.read()).value, nextChange);
    }

    await first.cancel();
    broadcaster.broadcast(change);
    assert.equal((await first.read()).done, true);
    assert.deepEqual((await second.read()).value, change);
  } finally {
    await first.cancel();
    await second.cancel();
  }
});

test('broadcaster does not replay events broadcast before a subscription opened', async () => {
  const broadcaster = createTradeBroadcaster();
  broadcaster.broadcast(change);
  const reader = broadcaster.subscribe().getReader();

  try {
    broadcaster.broadcast(nextChange);
    assert.deepEqual((await reader.read()).value, nextChange);
  } finally {
    await reader.cancel();
  }
});

test('a subscriber with 100 queued events is disconnected without blocking a healthy subscriber', async () => {
  const logs = captureLogs();
  const broadcaster = createTradeBroadcaster(logs.logger);
  const connectionId = 'd197282d-99ca-4260-833a-702f97d1cba7';
  const slow = broadcaster.subscribe(connectionId).getReader();
  const healthy = broadcaster.subscribe().getReader();

  try {
    for (let index = 0; index < 100; index += 1) {
      broadcaster.broadcast(change);
      assert.deepEqual((await healthy.read()).value, change);
    }
    // Exactly 100 queued events are allowed. The next broadcast exceeds the limit.
    const closed = assert.rejects(slow.closed, /Slow SSE client/);
    broadcaster.broadcast(nextChange);

    await closed;
    await assert.rejects(slow.read(), /Slow SSE client/);
    assert.deepEqual((await healthy.read()).value, nextChange);
    broadcaster.broadcast(change);
    assert.deepEqual((await healthy.read()).value, change);
    const records = logs.records();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.event, 'sse.slow_client_dropped');
    assert.equal(records[0]?.level, 'warn');
    assert.equal(records[0]?.connectionId, connectionId);
    assert.equal(records[0]?.queueLimit, 100);
    assert.equal(logs.output().includes(change.trade.id), false);
  } finally {
    await slow.cancel().catch(() => {});
    await healthy.cancel();
  }
});
