import type { DatabaseClient, Prisma } from '@trade-blotter/database';

export type PendingTradeEvent = {
  id: string;
  type: Prisma.OutboxEventGetPayload<{}>['type'];
  tradeId: string;
  tradeVersion: number;
  payload: unknown;
  retries: number;
  createdAt: Date;
};

export type OutboxRepository = {
  listPending: (now: Date, limit: number) => Promise<PendingTradeEvent[]>;
  findNextAttemptAt: () => Promise<Date | null>;
  markPublished: (id: string, now: Date) => Promise<void>;
  scheduleRetry: (id: string, nextAttemptAt: Date, errorName: string) => Promise<void>;
};

export function createOutboxRepository(
  database: Pick<DatabaseClient, 'outboxEvent'>,
): OutboxRepository {
  return {
    listPending: (now, limit) => database.outboxEvent.findMany({
      where: {
        type: { in: ['TRADE_CREATED', 'TRADE_AMENDED', 'TRADE_CANCELLED'] },
        status: 'PENDING',
        nextAttemptAt: { lte: now },
      },
      // Earliest eligible time first; creation time and ID make ties deterministic.
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true, type: true, tradeId: true, tradeVersion: true,
        payload: true, retries: true, createdAt: true,
      },
    }),

    // Include future retries so startup can restore their timer after a restart.
    findNextAttemptAt: async () => {
      const event = await database.outboxEvent.findFirst({
        where: {
          type: { in: ['TRADE_CREATED', 'TRADE_AMENDED', 'TRADE_CANCELLED'] },
          status: 'PENDING',
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { nextAttemptAt: true },
      });
      return event?.nextAttemptAt ?? null;
    },

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
