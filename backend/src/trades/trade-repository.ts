import { Prisma, type DatabaseClient } from '@trade-blotter/database';
import {
  createTradeResponseSchema,
  type CreateTradeCommand,
  type CreateTradeResponse,
  type CreateTradeResult,
} from './creation/trade-create-contract';
import { toTradeResponse } from './trade-mapper';
import type { TradeResponse } from './trade-contract';
import type {
  AmendTradeCommand,
  AmendTradeResult,
  NormalizedAmendTradeRequest,
} from './amendments/trade-amend-contract';
import type { CancelTradeCommand, CancelTradeResult } from './cancellations/trade-cancel-contract';
import type { NormalizedTradeListQuery } from './listing/trade-query-contract';
import type { TradeFilterOptions } from './listing/trade-filter-options-contract';
import type { TradeCursorBoundary } from './listing/trade-cursor';
import { tradeBoundaryFilter, tradeListFilters, tradeListOrder } from './listing/trade-list-query';

// The mapper needs the symbol and display name, not complete account records.
export type TradeRecord = Prisma.TradeGetPayload<{
  include: {
    instrument: { select: { symbol: true } };
    user: { select: { displayName: true } };
  };
}>;

export type TradePage = {
  records: TradeRecord[];
  hasNextPage: boolean;
};

export type TradeRepository = {
  listFilterOptions: () => Promise<TradeFilterOptions>;
  list: (query: NormalizedTradeListQuery, boundary: TradeCursorBoundary | null) => Promise<TradePage>;
  create: (command: CreateTradeCommand) => Promise<CreateTradeResult>;
  amend: (command: AmendTradeCommand) => Promise<AmendTradeResult>;
  cancel: (command: CancelTradeCommand) => Promise<CancelTradeResult>;
};

type TradeDatabase = Pick<DatabaseClient, 'trade' | '$transaction' | 'idempotencyRequest' | 'instrument' | 'user'>;
type SavedCreateRequest = { requestFingerprint: string; responseBody: Prisma.JsonValue };

function replayCreateRequest(saved: SavedCreateRequest, fingerprint: string): CreateTradeResult {
  if (saved.requestFingerprint !== fingerprint) {
    return { kind: 'idempotency-conflict' };
  }

  return { kind: 'replayed', body: createTradeResponseSchema.parse(saved.responseBody) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isIdempotencyKeyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }

  // Prisma 7 adapter-pg exposes the violated index in the underlying driver error.
  const driverError = error.meta?.driverAdapterError;
  const cause = isRecord(driverError) ? driverError.cause : undefined;
  const constraint = isRecord(cause) ? cause.constraint : undefined;

  return isRecord(constraint) && constraint.index === 'IdempotencyRequest_userId_key_key';
}

function hasTradeChanges(
  changes: NormalizedAmendTradeRequest['changes'],
  current: TradeResponse,
): boolean {
  // Both sides have fixed-scale decimals and UTC dates, so equality is meaningful.
  return Object.entries(changes).some(([field, value]) =>
    value !== undefined && value !== current[field as keyof typeof changes]);
}

export function createTradeRepository(database: TradeDatabase): TradeRepository {
  return {
    listFilterOptions: async () => {
      // Small reference tables: independent reads, without scanning trade history.
      const [instruments, traders] = await Promise.all([
        database.instrument.findMany({
          select: { symbol: true, name: true },
          orderBy: { symbol: 'asc' },
        }),
        database.user.findMany({
          where: { role: 'TRADER' },
          select: { id: true, displayName: true },
          orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        }),
      ]);

      return { instruments, traders };
    },

    create: async (command: CreateTradeCommand): Promise<CreateTradeResult> => {
      const requestKey = {
        userId_key: { userId: command.userId, key: command.idempotencyKey },
      };

      try {
        return await database.$transaction(async (tx): Promise<CreateTradeResult> => {
          // Replays return the original response without consulting current trade/catalog state.
          const existingRequest = await tx.idempotencyRequest.findUnique({ where: requestKey });

          if (existingRequest) {
            return replayCreateRequest(existingRequest, command.requestFingerprint);
          }

          const instrument = await tx.instrument.findUnique({
            where: { symbol: command.input.symbol },
            select: { id: true, symbol: true },
          });

          if (!instrument) {
            return { kind: 'unknown-instrument' };
          }

          const newTrade = await tx.trade.create({
            data: {
              userId: command.userId,
              instrumentId: instrument.id,
              side: command.input.side,
              quantity: command.input.quantity,
              price: command.input.price,
              tradeDate: new Date(command.input.tradeDate),
              book: command.input.book,
              counterparty: command.input.counterparty,
            },
            include: {
              user: { select: { displayName: true } },
            },
          });

          // Reuse the catalog result instead of fetching the instrument relation again.
          const responseBody: CreateTradeResponse = {
            trade: toTradeResponse({ ...newTrade, instrument }),
          };

          // Save the exact resulting version; delivery happens after commit in a later slice.
          await tx.outboxEvent.create({
            data: {
              type: 'TRADE_CREATED',
              actorId: command.userId,
              tradeId: newTrade.id,
              tradeVersion: newTrade.version,
              payload: responseBody.trade,
            },
          });

          await tx.idempotencyRequest.create({
            data: {
              userId: command.userId,
              key: command.idempotencyKey,
              requestFingerprint: command.requestFingerprint,
              responseBody,
              responseStatus: 201,
            },
          });

          return { kind: 'created', body: responseBody };
        });
      } catch (error) {
        if (!isIdempotencyKeyConflict(error)) {
          throw error;
        }

        // Both requests may have passed the initial lookup. The losing transaction is
        // rolled back before we read the winner, so it leaves no extra trade or event.
        const winner = await database.idempotencyRequest.findUnique({ where: requestKey });

        if (!winner) {
          throw error;
        }

        return replayCreateRequest(winner, command.requestFingerprint);
      }
    },

    amend: ({ userId, tradeId, input }) => database.$transaction(async (tx): Promise<AmendTradeResult> => {
      const tradeQuery = {
        where: { id: tradeId },
        include: {
          instrument: { select: { symbol: true } },
          user: { select: { displayName: true } },
        },
      } as const;
      const current = await tx.trade.findUnique(tradeQuery);

      if (!current) return { kind: 'not-found' };
      if (current.userId !== userId) return { kind: 'forbidden' };

      const currentTrade = toTradeResponse(current);
      if (current.status !== 'ACTIVE' || current.version !== input.expectedVersion) {
        return { kind: 'conflict', currentTrade };
      }
      if (!hasTradeChanges(input.changes, currentTrade)) return { kind: 'no-changes' };

      const { tradeDate, ...fields } = input.changes;
      const data: Prisma.TradeUncheckedUpdateManyInput = {
        ...fields,
        version: { increment: 1 },
      };
      if (tradeDate !== undefined) data.tradeDate = new Date(tradeDate);

      // The earlier read helps explain errors. This condition prevents lost updates.
      // handles an expected concurrency conflict without throwing a database exception.
      const { count } = await tx.trade.updateMany({
        where: { id: tradeId, userId, status: 'ACTIVE', version: input.expectedVersion },
        data,
      });
      const latest = await tx.trade.findUnique(tradeQuery);

      if (count === 0) {
        // Another writer won; return its state without retrying the user's edit.
        return latest
          ? { kind: 'conflict', currentTrade: toTradeResponse(latest) }
          : { kind: 'not-found' };
      }
      if (!latest) throw new Error('Updated trade could not be loaded.');

      const amendedTrade = toTradeResponse(latest);
      await tx.outboxEvent.create({
        data: {
          type: 'TRADE_AMENDED',
          actorId: userId,
          tradeId,
          tradeVersion: latest.version,
          // Retain the reason until permanent audit storage is added separately.
          payload: { trade: amendedTrade, reason: input.reason },
        },
      });

      return { kind: 'amended', body: { trade: amendedTrade } };
    }),

    cancel: ({ userId, tradeId, input }) => database.$transaction(async (tx): Promise<CancelTradeResult> => {
      const include = {
        instrument: { select: { symbol: true } },
        user: { select: { displayName: true } },
      } as const;

      // Unique ID limits this to one row; all authorization/version checks are atomic.
      const [cancelled] = await tx.trade.updateManyAndReturn({
        where: { id: tradeId, userId, status: 'ACTIVE', version: input.expectedVersion },
        data: { status: 'CANCELLED', version: { increment: 1 } },
        include,
      });

      if (!cancelled) {
        // Only rejected updates need a read to explain which condition did not match.
        const current = await tx.trade.findUnique({ where: { id: tradeId }, include });
        if (!current) return { kind: 'not-found' };
        if (current.userId !== userId) return { kind: 'forbidden' };
        return { kind: 'conflict', currentTrade: toTradeResponse(current) };
      }

      const cancelledTrade = toTradeResponse(cancelled);
      await tx.outboxEvent.create({
        data: {
          type: 'TRADE_CANCELLED',
          actorId: userId,
          tradeId,
          tradeVersion: cancelled.version,
          // Delivery outbox metadata; permanent audit history remains separate work.
          payload: { trade: cancelledTrade, reason: input.reason },
        },
      });

      return { kind: 'cancelled', body: { trade: cancelledTrade } };
    }),

    list: async (query, boundary): Promise<TradePage> => {
      const filters = tradeListFilters(query);
      const comparison = query.sortDirection === 'asc' ? 'gt' : 'lt';

      const rows = await database.trade.findMany({
        where: boundary ? { AND: [filters, tradeBoundaryFilter(boundary, comparison)] } : filters,
        orderBy: tradeListOrder(query.sortBy, query.sortDirection),
        // One extra row tells us whether to issue a next cursor, without counting all matches.
        take: query.limit + 1,
        include: {
          instrument: { select: { symbol: true } },
          user: { select: { displayName: true } },
        },
      });

      return {
        records: rows.slice(0, query.limit),
        hasNextPage: rows.length > query.limit,
      };
    },
  };
}
