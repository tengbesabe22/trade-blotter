import type { TradeRecord } from './trade-repository';
import type { TradeResponse } from './trade-contract';

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
