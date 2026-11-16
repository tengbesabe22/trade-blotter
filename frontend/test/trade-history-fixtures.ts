import type { TradeHistoryEntry, TradeHistoryResponse } from '../src/api/contracts/trades/trade-history-contract';
import { sampleTrade } from './trade-fixtures';

const actor = { id: sampleTrade.ownerId, displayName: sampleTrade.trader };
export const createdHistory: TradeHistoryEntry = {
  id: 'a1111111-1111-4111-8111-111111111111', tradeVersion: 1, action: 'CREATED', actor,
  reason: null, recordedAt: sampleTrade.createdAt, snapshot: sampleTrade, changes: [],
};
export const amendedHistory: TradeHistoryEntry = {
  ...createdHistory, id: 'a2222222-2222-4222-8222-222222222222', tradeVersion: 2, action: 'AMENDED',
  reason: 'Correct price and book.', recordedAt: '2026-08-18T09:20:00.000Z',
  snapshot: { ...sampleTrade, version: 2, price: '230.0000', book: null, updatedAt: '2026-08-18T09:20:00.000Z' },
  changes: [
    { field: 'price', before: sampleTrade.price, after: '230.0000' },
    { field: 'book', before: sampleTrade.book, after: null },
  ],
};
export const cancelledHistory: TradeHistoryEntry = {
  ...amendedHistory, id: 'a3333333-3333-4333-8333-333333333333', tradeVersion: 3, action: 'CANCELLED',
  reason: null, recordedAt: '2026-08-18T09:25:00.000Z',
  snapshot: { ...amendedHistory.snapshot, version: 3, status: 'CANCELLED', updatedAt: '2026-08-18T09:25:00.000Z' },
  changes: [{ field: 'status', before: 'ACTIVE', after: 'CANCELLED' }],
};
export const sampleHistory: TradeHistoryResponse = {
  schemaVersion: 1, generatedAt: '2026-11-14T09:00:00.000Z', tradeId: sampleTrade.id,
  entries: [cancelledHistory, amendedHistory, createdHistory],
};
