export const signedInTrader = {
  id: 'd197282d-99ca-4260-833a-702f97d1cba1',
  displayName: 'JSMITH',
  role: 'TRADER',
};

export const sampleTrade = {
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

export const cancelledTrade = {
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
