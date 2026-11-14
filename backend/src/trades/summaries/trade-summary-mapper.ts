import { Prisma } from '@trade-blotter/database';
import { symbolSummarySchema, type SymbolSummary } from './trade-summary-contract';

export type SymbolSummaryRecord = Prisma.SymbolSummaryGetPayload<{
  include: { instrument: { select: { symbol: true; currency: true } } };
}>;

// Quantity columns hold 28 digits; use an isolated constructor to avoid rounding net positions.
const SummaryDecimal = Prisma.Decimal.clone({ precision: 40 });

export function toSymbolSummary(row: SymbolSummaryRecord): SymbolSummary {
  const netQuantity = new SummaryDecimal(row.buyQuantity.toString()).minus(row.sellQuantity.toString());

  return symbolSummarySchema.parse({
    instrumentId: row.instrumentId,
    symbol: row.instrument.symbol,
    currency: row.instrument.currency,
    buyQuantity: row.buyQuantity.toFixed(6),
    sellQuantity: row.sellQuantity.toFixed(6),
    netQuantity: netQuantity.toFixed(6),
    buyValue: row.buyValue.toFixed(10),
    sellValue: row.sellValue.toFixed(10),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  });
}
