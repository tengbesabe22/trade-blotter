import type { DatabaseClient } from '@trade-blotter/database';

export type PendingTradeEvent = {
  id: string;
  tradeId: string;
  tradeVersion: number;
  payload: unknown;
  retries: number;
  createdAt: Date;
};

export type OutboxRepository = {
  listPending: (now: Date, limit: number) => Promise<PendingTradeEvent[]>;
  markPublished: (id: string, now: Date) => Promise<void>;
  scheduleRetry: (id: string, nextAttemptAt: Date, errorName: string) => Promise<void>;
};

export function createOutboxRepository(
  database: Pick<DatabaseClient, 'outboxEvent'>,
): OutboxRepository {
  return {
    listPending: (now, limit) => database.outboxEvent.findMany({
      where: { type: 'TRADE_CREATED', status: 'PENDING', nextAttemptAt: { lte: now } },
      // Earliest eligible time first; creation time and ID make ties deterministic.
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true, tradeId: true, tradeVersion: true,
        payload: true, retries: true, createdAt: true,
      },
    }),

    markPublished: async (id, now) => {
      await database.outboxEvent.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedAt: now, lastError: null },
      });
    },

    scheduleRetry: async (id, nextAttemptAt, errorName) => {
      // Keep PENDING; only failed delivery is deferred, never a new trade event.
      await database.outboxEvent.update({
        where: { id },
        data: { retries: { increment: 1 }, nextAttemptAt, lastError: errorName },
      });
    },
  };
}
