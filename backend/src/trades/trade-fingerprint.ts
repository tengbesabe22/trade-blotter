import { createHash } from 'node:crypto';
import type { NormalizedCreateTradeRequest } from './trade-create-contract';

export function tradeFingerprint(trade: NormalizedCreateTradeRequest): string {
  // Keep field order stable so stored fingerprints survive caller/schema property reordering.
  const input = {
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    price: trade.price,
    tradeDate: trade.tradeDate,
    book: trade.book,
    counterparty: trade.counterparty,
  };

  return createHash('sha256')
    .update(JSON.stringify({
      method: 'POST',
      path: '/api/trades',
      input,
    }))
    .digest('hex');
}
