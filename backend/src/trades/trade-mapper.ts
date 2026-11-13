import type { TradeRecord } from './trade-repository';
import type { TradeCursorBoundary } from './listing/trade-cursor';
import type { NormalizedTradeListQuery } from './listing/trade-query-contract';
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

/** Extracts the selected sort value and ID from a returned database record.
 * Example: price sorting produces { sortBy: 'price', value: '227.4500', id }.
 */
export function toTradeCursorBoundary(
  trade: TradeRecord,
  sortBy: NormalizedTradeListQuery['sortBy'],
): TradeCursorBoundary {
  const id = trade.id;
  switch (sortBy) {
    case 'tradeDate': return { sortBy, value: trade.tradeDate.toISOString(), id };
    case 'symbol': return { sortBy, value: trade.instrument.symbol, id };
    case 'trader': return { sortBy, value: trade.user.displayName, id };
    case 'quantity': return { sortBy, value: trade.quantity.toFixed(6), id };
    case 'price': return { sortBy, value: trade.price.toFixed(4), id };
    case 'status': return { sortBy, value: trade.status, id };
  }
}
