import assert from 'node:assert/strict';
import test from 'node:test';
import { createOutboxRelayer } from '../src/trades/outbox/outbox-relayer';
import type { OutboxRepository, PendingTradeEvent } from '../src/trades/outbox/outbox-repository';
import type { TradeChange } from '../src/trades/sse/trade-stream-contract';

const startTime = Date.parse('2026-11-13T09:00:00.000Z');

function makeEvent(index = 1): PendingTradeEvent {
  const id = `f1550000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  return {
    id, tradeId: id, tradeVersion: 1, retries: 0, createdAt: new Date(startTime),
    payload: {
      id, symbol: 'AAPL', side: 'BUY', quantity: '5000.000000', price: '227.4500',
      trader: 'JSMITH', ownerId: 'd197282d-99ca-4260-833a-702f97d1cba1',
      book: null, counterparty: null, status: 'ACTIVE', version: 1,
      tradeDate: new Date(startTime).toISOString(),
      createdAt: new Date(startTime).toISOString(), updatedAt: new Date(startTime).toISOString(),
    },
  };
}

function setup(events = [makeEvent()]) {
  let time = startTime;
  const pending = new Map(events.map((event) => [event.id, { ...event }]));
  const nextAttempts = new Map<string, number>();
  const delivered: TradeChange[] = [];
  const published: string[] = [];
  const retries: { id: string; nextAttemptAt: Date; errorName: string }[] = [];
  const errors: unknown[] = [];
  const repository: OutboxRepository = {
    listPending: async (now, limit) => [...pending.values()]
      .filter((event) => (nextAttempts.get(event.id) ?? startTime) <= now.getTime())
      .slice(0, limit),
    markPublished: async (id) => { published.push(id); pending.delete(id); },
    scheduleRetry: async (id, nextAttemptAt, errorName) => {
      retries.push({ id, nextAttemptAt, errorName });
      pending.get(id)!.retries += 1;
      nextAttempts.set(id, nextAttemptAt.getTime());
    },
  };
  const broadcaster = { broadcast: (change: TradeChange) => { delivered.push(change); } };
  // Keep the callback injectable without involving real SSE connections.
  const relayer = createOutboxRelayer(repository, (change) => broadcaster.broadcast(change), {
    now: () => new Date(time), onError: (error) => { errors.push(error); },
  });
  return { relayer, repository, broadcaster, pending, delivered, published, retries, errors,
    advance: (ms: number) => { time += ms; } };
}

test('relayer broadcasts the complete saved event before marking it published', async (t) => {
  const event = makeEvent();
  const h = setup([event]);
  t.mock.method(h.repository, 'markPublished', async (id: string, now: Date) => {
    assert.deepEqual(h.delivered, [{
      schemaVersion: 1, changeId: event.id, type: 'TRADE_CREATED',
      occurredAt: event.createdAt.toISOString(), trade: event.payload,
    }]);
    assert.equal(now.getTime(), startTime);
    h.published.push(id);
    h.pending.delete(id);
  });

  await h.relayer.wake();
  assert.deepEqual(h.published, [event.id]);
});

test('concurrent wake-ups share a run and include work arriving during that run', async (t) => {
  const h = setup();
  const markPublished = h.repository.markPublished;
  t.mock.method(h.repository, 'markPublished', async (id: string, now: Date) => {
    await markPublished(id, now);
    if (id === makeEvent().id) {
      const next = makeEvent(2);
      h.pending.set(next.id, next);
      void h.relayer.wake();
    }
  });

  await Promise.all([h.relayer.wake(), h.relayer.wake(), h.relayer.wake()]);
  assert.deepEqual(h.published, [makeEvent().id, makeEvent(2).id]);
  assert.equal(h.delivered.length, 2);
});

test('a full 100-event batch continues to the remaining pending events', async () => {
  const h = setup(Array.from({ length: 101 }, (_, index) => makeEvent(index + 1)));
  await h.relayer.wake();
  assert.equal(h.published.length, 101);
  assert.equal(h.pending.size, 0);
});

test('invalid payloads and mismatched trade identity/version are retried while valid events continue', async () => {
  for (const invalid of [
    { ...makeEvent(), payload: { invalid: true } },
    { ...makeEvent(), tradeId: makeEvent(3).tradeId },
    { ...makeEvent(), tradeVersion: 2 },
  ]) {
    const valid = makeEvent(2);
    const h = setup([invalid, valid]);
    await h.relayer.wake();
    assert.deepEqual(h.published, [valid.id]);
    assert.deepEqual(h.delivered.map((change) => change.changeId), [valid.id]);
    assert.equal(h.retries[0]?.id, invalid.id);
  }
});

test('broadcast failures back off from 1 second up to a 30-second cap', async (t) => {
  for (const [retryCount, delayMs] of [[0, 1000], [1, 2000], [10, 30_000], [10_000, 30_000]]) {
    const event = { ...makeEvent(), retries: retryCount };
    const h = setup([event]);
    t.mock.method(h.broadcaster, 'broadcast', () => { throw new TypeError('Broadcast failed'); });
    await h.relayer.wake();
    assert.equal(h.published.length, 0);
    assert.deepEqual(h.retries, [{
      id: event.id, nextAttemptAt: new Date(startTime + delayMs), errorName: 'TypeError',
    }]);
  }
});

test('failure after broadcast leaves the same event retryable, so delivery may repeat', async (t) => {
  const h = setup();
  const markPublished = t.mock.method(h.repository, 'markPublished', async () => {
    throw new Error('Database unavailable');
  });
  await h.relayer.wake();
  assert.equal(h.delivered.length, 1);
  assert.equal(h.pending.size, 1);

  await h.relayer.wake(); // Not eligible before its retry time.
  assert.equal(h.delivered.length, 1);
  markPublished.mock.restore();
  h.advance(1000);
  await h.relayer.wake();
  assert.equal(h.delivered.length, 2);
  assert.deepEqual(h.delivered[0], h.delivered[1]);
  assert.equal(h.pending.size, 0);
});

test('a failed outbox read is reported and a later wake can recover', async (t) => {
  const h = setup();
  const read = t.mock.method(h.repository, 'listPending', async () => { throw new Error('Unavailable'); });
  await h.relayer.wake();
  assert.equal(h.errors.length, 1);
  assert.equal(h.delivered.length, 0);

  read.mock.restore();
  await h.relayer.wake();
  assert.equal(h.published.length, 1);
});

test('failure to save a retry is reported without discarding the pending event', async (t) => {
  const h = setup();
  t.mock.method(h.broadcaster, 'broadcast', () => { throw new Error('Broadcast failed'); });
  t.mock.method(h.repository, 'scheduleRetry', async () => { throw new Error('Retry write failed'); });
  await h.relayer.wake();
  assert.equal(h.errors.length, 1);
  assert.equal(h.pending.size, 1);
  assert.equal(h.published.length, 0);
});
