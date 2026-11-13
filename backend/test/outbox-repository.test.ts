import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@trade-blotter/database';
import { createOutboxRepository, type PendingTradeEvent } from '../src/trades/outbox/outbox-repository';

const event: PendingTradeEvent = {
  id: 'd197282d-99ca-4260-833a-702f97d1cba2',
  tradeId: 'f1550000-0000-4000-8000-000000100003',
  type: 'TRADE_CREATED',
  tradeVersion: 1,
  payload: { symbol: 'AAPL' }, // Persistence returns JSON; the relayer validates it later.
  retries: 0,
  createdAt: new Date('2026-11-13T09:00:00.000Z'),
};

function setup() {
  const reads: Prisma.OutboxEventFindManyArgs[] = [];
  const writes: Prisma.OutboxEventUpdateArgs[] = [];
  const fake = { outboxEvent: {
    findMany: async (query: Prisma.OutboxEventFindManyArgs) => {
      reads.push(query);
      return [event];
    },
    update: async (query: Prisma.OutboxEventUpdateArgs) => { writes.push(query); },
  } };

  // Keep the structural fake cast at the Prisma delegate boundary.
  const database = fake as unknown as Parameters<typeof createOutboxRepository>[0];
  return { repository: createOutboxRepository(database), reads, writes };
}

test('listPending requests only due pending creation and amendment events in a bounded, deterministic order', async () => {
  const h = setup();
  const now = event.createdAt;

  assert.deepEqual(await h.repository.listPending(now, 100), [event]);
  assert.deepEqual(h.reads[0]?.where, {
    type: { in: ['TRADE_CREATED', 'TRADE_AMENDED'] }, status: 'PENDING', nextAttemptAt: { lte: now },
  });
  assert.equal(h.reads[0]?.select?.type, true);
  assert.equal(h.reads[0]?.take, 100);
  assert.deepEqual(h.reads[0]?.orderBy, [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]);
});

test('markPublished records publication time and clears the previous error', async () => {
  const h = setup();

  await h.repository.markPublished(event.id, event.createdAt);

  assert.deepEqual(h.writes[0]?.where, { id: event.id });
  assert.deepEqual(h.writes[0]?.data, {
    status: 'PUBLISHED', publishedAt: event.createdAt, lastError: null,
  });
});

test('scheduleRetry increments retries and defers the next attempt without marking it published', async () => {
  const h = setup();
  const nextAttemptAt = new Date(event.createdAt.getTime() + 1000);

  await h.repository.scheduleRetry(event.id, nextAttemptAt, 'DispatchError');

  assert.deepEqual(h.writes[0]?.where, { id: event.id });
  assert.deepEqual(h.writes[0]?.data, {
    retries: { increment: 1 }, nextAttemptAt, lastError: 'DispatchError',
  });
});
