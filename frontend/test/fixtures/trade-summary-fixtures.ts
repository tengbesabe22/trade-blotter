import type { SymbolSummary } from '../../src/api/contracts/trades/trade-summary-contract';

export const sampleSummary: SymbolSummary = {
  instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d05', symbol: 'AAPL', currency: 'USD',
  buyQuantity: '100.000000', sellQuantity: '30.000000', netQuantity: '70.000000',
  buyValue: '22745.0000000000', sellValue: '6900.0000000000',
  version: 9, updatedAt: '2026-11-15T09:00:00.000Z',
};
export const shortSummary: SymbolSummary = {
  ...sampleSummary, instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d06', symbol: 'MSFT',
  buyQuantity: '20.000000', sellQuantity: '50.000000', netQuantity: '-30.000000',
  buyValue: '8000.0000000000', sellValue: '20500.0000000000', version: 3,
};
export const flatSummary: SymbolSummary = {
  ...sampleSummary, instrumentId: '7768fed5-b612-4844-8b84-e9db63a31d07', symbol: 'TSLA',
  buyQuantity: '0.000000', sellQuantity: '0.000000', netQuantity: '0.000000',
  buyValue: '0.0000000000', sellValue: '0.0000000000', version: 0,
};
export function summaryResponse(summaries: SymbolSummary[] = [sampleSummary]) {
  return { schemaVersion: 1, generatedAt: '2026-11-15T09:01:00.000Z', summaries };
}
