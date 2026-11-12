import type { TradeRecord } from './trade-repository';

export type TradeResponse = {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  trader: string;
  ownerId: string;
  book: string | null;
  counterparty: string | null;
  tradeDate: string;
  status: 'ACTIVE' | 'CANCELLED';
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TradeListResponse = { trades: TradeResponse[] };

export function toTradeResponse(trade: TradeRecord): TradeResponse {
  return {
    id: trade.id,
    symbol: trade.instrument.symbol,
    side: trade.side,
    quantity: trade.quantity.toFixed(6),
    price: trade.price.toFixed(4),
    trader: trade.user.displayName,
    ownerId: trade.userId,
    book: trade.book ?? null,
    counterparty: trade.counterparty ?? null,
    tradeDate: trade.tradeDate.toISOString(),
    status: trade.status,
    version: trade.version,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
  };
}
