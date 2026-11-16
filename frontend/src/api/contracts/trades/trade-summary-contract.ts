import { z } from 'zod';
import { tradeResponseSchema } from './trade-contract';

// Unsigned decimals without leading zeros: up to 22 whole digits + 6 fractional digits
// for quantities, or 28 + 10 for values, matching the database columns.
const summaryQuantitySchema = z.string().regex(/^(0|[1-9]\d{0,21})\.\d{6}$/);
const summaryValueSchema = z.string().regex(/^(0|[1-9]\d{0,27})\.\d{10}$/);
// Same quantity format, with an optional minus sign for short positions.
const netQuantitySchema = z.string().regex(/^-?(0|[1-9]\d{0,21})\.\d{6}$/)
  .refine((value) => value !== '-0.000000', 'Flat positions must use unsigned zero.');

export const symbolSummarySchema = z.strictObject({
  instrumentId: z.uuid(),
  symbol: tradeResponseSchema.shape.symbol.refine((value) => value === value.trim().toUpperCase()),
  currency: z.literal('USD'),
  buyQuantity: summaryQuantitySchema,
  sellQuantity: summaryQuantitySchema,
  netQuantity: netQuantitySchema,
  buyValue: summaryValueSchema,
  sellValue: summaryValueSchema,
  version: z.number().int().nonnegative().max(2_147_483_647),
  updatedAt: z.iso.datetime({ precision: 3 }),
});
export type SymbolSummary = z.infer<typeof symbolSummarySchema>;

export const tradeSummaryResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime({ precision: 3 }),
  summaries: z.array(symbolSummarySchema),
}).refine((response) => {
  const ids = response.summaries.map((summary) => summary.instrumentId.toLowerCase());
  return new Set(ids).size === ids.length;
}, 'Each instrument must appear only once.');
export type TradeSummaryResponse = z.infer<typeof tradeSummaryResponseSchema>;
