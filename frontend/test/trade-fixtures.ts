import type { Trade } from '../src/api/trade-contract';

export const signedInTrader = {
  id: 'd197282d-99ca-4260-833a-702f97d1cba1',
  displayName: 'JSMITH',
  role: 'TRADER',
};

export const sampleTrade: Trade = {
  id: 'f1550000-0000-4000-8000-000000100001',
  symbol: 'AAPL',
  side: 'BUY',
  quantity: '5000.000001',
  price: '227.4501',
  trader: 'ADOE',
  ownerId: '14cad115-cfe2-402f-9934-a97657f91162',
  book: 'EQUITIES_UK',
  counterparty: 'Goldman Sachs',
  tradeDate: '2026-08-18T09:15:23.000Z',
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-08-18T09:16:00.000Z',
  updatedAt: '2026-08-18T09:16:00.000Z',
};

export const cancelledTrade: Trade = {
  ...sampleTrade,
  id: 'f1550000-0000-4000-8000-000000100002',
  symbol: 'MSFT',
  side: 'SELL',
  quantity: '9.000000',
  price: '414.7737',
  book: null,
  counterparty: null,
  status: 'CANCELLED',
  version: 2,
};

export function tradePage(trades: Trade[] = [], pageInfo: {
  limit?: number;
  nextCursor?: string | null;
} = {}) {
  return {
    schemaVersion: 1 as const,
    generatedAt: '2026-11-13T09:00:00.000Z',
    trades,
    pageInfo: {
      limit: 100, nextCursor: null,
      ...pageInfo,
    },
  };
}


export const tradeOptions = {
  instruments: [{ symbol: 'AAPL', name: 'Apple Inc.' }],
  traders: [{ id: signedInTrader.id, displayName: signedInTrader.displayName }],
};
