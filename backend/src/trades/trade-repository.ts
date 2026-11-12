import type { DatabaseClient, Prisma } from '@trade-blotter/database';

// The mapper needs the symbol and display name, not complete account records.
export type TradeRecord = Prisma.TradeGetPayload<{
  include: {
    instrument: { select: { symbol: true } };
    user: { select: { displayName: true } };
  };
}>;

export type TradeRepository = {
  list: () => Promise<TradeRecord[]>;
};

type TradeDatabase = Pick<DatabaseClient, 'trade'>;

export function createTradeRepository(database: TradeDatabase): TradeRepository {
  return {
    list: async (): Promise<TradeRecord[]> => {
      return await database.trade.findMany({
        include: {
          instrument: { select: { symbol: true } },
          user: { select: { displayName: true } },
        },
      });
    },
  };
}
