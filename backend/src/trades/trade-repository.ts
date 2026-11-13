import { Prisma, type DatabaseClient } from '@trade-blotter/database';
import {
  createTradeResponseSchema,
  type CreateTradeCommand,
  type CreateTradeResponse,
  type CreateTradeResult,
} from './creation/trade-create-contract';
import { toTradeResponse } from './trade-mapper';
import type { NormalizedTradeListQuery } from './listing/trade-query-contract';
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
  list: (query: NormalizedTradeListQuery, boundary: TradeCursorBoundary | null) => Promise<TradePage>;
  create: (command: CreateTradeCommand) => Promise<CreateTradeResult>;
};

type TradeDatabase = Pick<DatabaseClient, 'trade' | '$transaction' | 'idempotencyRequest'>;
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

export function createTradeRepository(database: TradeDatabase): TradeRepository {
  return {
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
