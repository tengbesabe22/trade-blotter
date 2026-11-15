import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createOutboxRelayer } from '../src/trades/outbox/outbox-relayer';
import type { OutboxRepository, PendingTradeEvent } from '../src/trades/outbox/outbox-repository';
import { tradeResponseSchema } from '../src/trades/trade-contract';
import type { TradeChange } from '../src/trades/sse/trade-stream-contract';

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach((stop) => stop()); });

const startTime = Date.parse('2026-11-13T09:00:00.000Z');

type CapturedTradeEvent = PendingTradeEvent & { payload: Pick<TradeChange, 'trade' | 'summaries'> };

function makeEvent(index = 1): CapturedTradeEvent {
  const id = `f1550000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const trade = {
    id, symbol: 'AAPL', side: 'BUY' as const, quantity: '5000.000000', price: '227.4500',
    trader: 'JSMITH', ownerId: 'd197282d-99ca-4260-833a-702f97d1cba1',
    book: null, counterparty: null, status: 'ACTIVE' as const, version: 1,
    tradeDate: new Date(startTime).toISOString(),
    createdAt: new Date(startTime).toISOString(), updatedAt: new Date(startTime).toISOString(),
  };
  return {
    id, type: 'TRADE_CREATED', tradeId: id, tradeVersion: 1, retries: 0, createdAt: new Date(startTime),
    payload: { trade, summaries: [{
      instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: 'AAPL', currency: 'USD',
      buyQuantity: '5000.000000', sellQuantity: '0.000000', netQuantity: '5000.000000',
      buyValue: '1137250.0000000000', sellValue: '0.0000000000',
      version: 9, updatedAt: new Date(startTime).toISOString(),
    }] },
  };
}

function setup(events: PendingTradeEvent[] = [makeEvent()]) {
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
    findNextAttemptAt: async () => {
      const times = [...pending.keys()].map((id) => nextAttempts.get(id) ?? startTime);
      return times.length ? new Date(Math.min(...times)) : null;
    },
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
  cleanup.push(relayer.stop);
  return { nextAttempts, relayer, repository, broadcaster, pending, delivered, published, retries, errors,
    advance: (ms: number) => { time += ms; } };
}

test('relayer broadcasts the complete saved event before marking it published', async (t) => {
  const event = makeEvent();
  const h = setup([event]);
  t.mock.method(h.repository, 'markPublished', async (id: string, now: Date) => {
    assert.deepEqual(h.delivered, [{
      changeId: event.id, type: 'TRADE_CREATED',
      occurredAt: event.createdAt.toISOString(), ...event.payload,
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


for (const type of ['TRADE_AMENDED', 'TRADE_CANCELLED'] as const) {
  test(`relayer sends ${type} with the saved version and keeps the reason out of SSE`, async () => {
    const created = makeEvent();
    const trade = { ...tradeResponseSchema.parse(created.payload.trade), version: 2,
      status: type === 'TRADE_CANCELLED' ? 'CANCELLED' : 'ACTIVE' };
    const summary = {
      instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: 'AAPL', currency: 'USD',
      buyQuantity: '100.000000', sellQuantity: '30.000000', netQuantity: '70.000000',
      buyValue: '23000.0000000000', sellValue: '6900.0000000000',
      version: 9, updatedAt: new Date(startTime).toISOString(),
    };
    // All mutations use captured snapshots; metadata-only amendments carry none.
    for (const payload of [
      { trade, reason: 'Booking correction.', summaries: [summary] },
      ...(type === 'TRADE_AMENDED' ? [{ trade, reason: null, summaries: [] }] : []),
    ]) {
      const event = { ...created, type, tradeVersion: 2, payload };
      const h = setup([event]);
      await h.relayer.wake();

      assert.deepEqual(h.delivered, [{
        changeId: event.id, type,
        occurredAt: event.createdAt.toISOString(), trade,
        summaries: payload.summaries,
      }]);
      assert.deepEqual(h.published, [event.id]);
      assert.deepEqual(h.retries, []);
    }
  });

  test(`invalid ${type} payloads and trade identity/version mismatches stay retryable`, async () => {
    const created = makeEvent();
    const trade = { ...tradeResponseSchema.parse(created.payload.trade), version: 2,
      status: type === 'TRADE_CANCELLED' ? 'CANCELLED' : 'ACTIVE' };
    const saved = { ...created, type, tradeVersion: 2, payload: { trade, reason: null, summaries: created.payload.summaries } };
    for (const event of [
      { ...saved, payload: { trade, reason: null } },
      { ...saved, payload: { trade: { ...trade, price: 228.5 }, reason: null, summaries: created.payload.summaries } },
      { ...saved, tradeId: makeEvent(3).tradeId },
      { ...saved, tradeVersion: 3 },
    ]) {
      const h = setup([event]);
      await h.relayer.wake();
      assert.deepEqual(h.delivered, []);
      assert.deepEqual(h.published, []);
      assert.equal(h.retries[0]?.id, event.id);
      assert.equal(h.pending.has(event.id), true);
    }
  });
}


test('relayer sends the captured creation summary in the event', async () => {
  const created = makeEvent();
  const summary = {
    instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: 'AAPL', currency: 'USD',
    buyQuantity: '5100.000000', sellQuantity: '30.000000', netQuantity: '5070.000000',
    buyValue: '1160250.0000000000', sellValue: '6900.0000000000',
    version: 9, updatedAt: new Date(startTime).toISOString(),
  };
  const payload = { trade: created.payload.trade, summaries: [summary] };
  const h = setup([{ ...created, payload }]);
  await h.relayer.wake();
  assert.deepEqual(h.delivered, [{
    changeId: created.id, type: 'TRADE_CREATED',
    occurredAt: created.createdAt.toISOString(), trade: created.payload.trade, summaries: [summary],
  }]);
  assert.deepEqual(h.published, [created.id]);
  assert.deepEqual(h.retries, []);
  assert.deepEqual(payload.summaries, [summary]);
});


test('wrapped creation payloads still validate the trade and outbox identity before publication', async () => {
  const created = makeEvent();
  const trade = tradeResponseSchema.parse(created.payload.trade);
  for (const event of [
    { ...created, payload: { trade: { ...trade, price: 227.45 }, summaries: created.payload.summaries } },
    { ...created, tradeId: makeEvent(2).tradeId, payload: { trade, summaries: created.payload.summaries } },
    { ...created, tradeVersion: 2, payload: { trade, summaries: created.payload.summaries } },
  ]) {
    const h = setup([event]);
    await h.relayer.wake();
    assert.deepEqual(h.delivered, []);
    assert.deepEqual(h.published, []);
    assert.equal(h.retries[0]?.id, event.id);
    assert.equal(h.pending.has(event.id), true);
  }
});


for (const type of ['TRADE_CREATED', 'TRADE_AMENDED', 'TRADE_CANCELLED'] as const) {
  test(`invalid captured summaries on ${type} are retried before publication`, async () => {
    const created = makeEvent();
    const trade = { ...tradeResponseSchema.parse(created.payload.trade),
      status: type === 'TRADE_CANCELLED' ? 'CANCELLED' : 'ACTIVE' };
    const summary = {
      instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: 'AAPL', currency: 'USD',
      buyQuantity: '5000.000000', sellQuantity: '0.000000', netQuantity: '5000.000000',
      buyValue: '1137250.0000000000', sellValue: '0.0000000000',
      version: 9, updatedAt: new Date(startTime).toISOString(),
    };
    for (const summaries of [null, {}, [{ ...summary, buyQuantity: 5000 }],
      [{ ...summary, symbol: 'MSFT' }], [summary, summary],
      ...(type === 'TRADE_AMENDED' ? [] : [[]])]) {
      const event = { ...created, type, payload: { trade, summaries } };
      const h = setup([event, makeEvent(2)]);
      await h.relayer.wake();
      assert.deepEqual(h.published, [makeEvent(2).id]);
      assert.deepEqual(h.delivered.map((change) => change.changeId), [makeEvent(2).id]);
      assert.equal(h.retries[0]?.id, event.id);
      assert.equal(h.pending.has(event.id), true);
    }
  });
}

test('a captured summary keeps the same totals and version when publication is retried', async (t) => {
  const created = makeEvent();
  const summary = {
    instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: 'AAPL', currency: 'USD',
    buyQuantity: '5000.000000', sellQuantity: '0.000000', netQuantity: '5000.000000',
    buyValue: '1137250.0000000000', sellValue: '0.0000000000',
    version: 9, updatedAt: new Date(startTime).toISOString(),
  };
  const h = setup([{ ...created, payload: { trade: created.payload.trade, summaries: [summary] } }]);
  const mark = t.mock.method(h.repository, 'markPublished', async () => { throw new Error('Unavailable'); });
  await h.relayer.wake();
  assert.deepEqual(h.delivered[0], {
    changeId: created.id, type: created.type,
    occurredAt: created.createdAt.toISOString(), trade: created.payload.trade, summaries: [summary],
  });
  mark.mock.restore();
  h.advance(1000);
  await h.relayer.wake();
  assert.deepEqual(h.delivered[1], h.delivered[0]);
  assert.deepEqual(h.published, [created.id]);
});


test('records without captured summaries are retried without fabricating a snapshot', async () => {
  const created = makeEvent();
  for (const type of ['TRADE_CREATED', 'TRADE_AMENDED', 'TRADE_CANCELLED'] as const) {
    const payload = type === 'TRADE_CREATED' ? created.payload.trade : { trade: created.payload.trade, reason: null };
    const h = setup([{ ...created, type, payload }, makeEvent(2)]);
    await h.relayer.wake();
    assert.deepEqual(h.published, [makeEvent(2).id]);
    assert.deepEqual(h.delivered.map((change) => change.changeId), [makeEvent(2).id]);
    assert.equal(h.retries[0]?.id, created.id);
  }
});


test('a failed delivery retries automatically, then stays idle after publication', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup();
  const reads = t.mock.method(h.repository, 'listPending');
  const broadcast = t.mock.method(h.broadcaster, 'broadcast', () => { throw new Error('Unavailable'); });
  await h.relayer.wake();
  broadcast.mock.restore();

  h.advance(999);
  t.mock.timers.tick(999);
  await setImmediate();
  assert.equal(h.published.length, 0);

  h.advance(1);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.deepEqual(h.published, [makeEvent().id]);

  const readCount = reads.mock.callCount();
  h.advance(60_000);
  t.mock.timers.tick(60_000);
  await setImmediate();
  assert.equal(reads.mock.callCount(), readCount);
});

test('startup restores the earliest saved retry and then the later one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = makeEvent();
  const second = makeEvent(2);
  const h = setup([first, second]);
  h.nextAttempts.set(first.id, startTime + 1000);
  h.nextAttempts.set(second.id, startTime + 2000);
  await h.relayer.wake();
  assert.deepEqual(h.published, []);

  // An unrelated wake must keep the existing deadline, not postpone it.
  h.advance(500);
  t.mock.timers.tick(500);
  await h.relayer.wake();
  h.advance(500);
  t.mock.timers.tick(500);
  await setImmediate();
  assert.deepEqual(h.published, [first.id]);

  h.advance(1000);
  t.mock.timers.tick(1000);
  await setImmediate();
  assert.deepEqual(h.published, [first.id, second.id]);
});

for (const operation of ['listPending', 'findNextAttemptAt', 'scheduleRetry'] as const) {
  test(`a failed ${operation} gets a one-shot retry without another trade`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = setup();
    if (operation === 'scheduleRetry') {
      t.mock.method(h.broadcaster, 'broadcast', () => { throw new Error('Unavailable'); });
    }
    const failure = t.mock.method(h.repository, operation, async () => { throw new Error('Unavailable'); });
    await h.relayer.wake();
    assert.equal(h.errors.length, 1);
    failure.mock.restore();

    h.advance(1000);
    t.mock.timers.tick(1000);
    await setImmediate();
    if (operation === 'scheduleRetry') {
      assert.equal(h.retries.length, 1);
    } else {
      assert.equal(h.pending.size, 0);
    }
  });
}

test('stopping clears a pending retry and prevents further reads', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup();
  const reads = t.mock.method(h.repository, 'listPending');
  t.mock.method(h.broadcaster, 'broadcast', () => { throw new Error('Unavailable'); });
  await h.relayer.wake();
  h.relayer.stop();

  h.advance(60_000);
  t.mock.timers.tick(60_000);
  await h.relayer.wake();
  await setImmediate();
  assert.equal(reads.mock.callCount(), 1);
});

test('stopping during a read does not rearm a retry after that read fails', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup();
  let rejectRead!: (error: Error) => void;
  const reads = t.mock.method(h.repository, 'listPending', () => new Promise<PendingTradeEvent[]>((_, reject) => {
    rejectRead = reject;
  }));
  const running = h.relayer.wake();
  h.relayer.stop();
  rejectRead(new Error('Unavailable'));
  await running;

  t.mock.timers.tick(60_000);
  await setImmediate();
  assert.equal(reads.mock.callCount(), 1);
});
