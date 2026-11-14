import { z } from 'zod';
import { tradeResponseSchema } from './trade-contract';

// Bounds follow the summary columns: Decimal(28,6) quantities and Decimal(38,10) values.
const summaryQuantitySchema = z.string().regex(/^(0|[1-9]\d{0,21})\.\d{6}$/);
const summaryValueSchema = z.string().regex(/^(0|[1-9]\d{0,27})\.\d{10}$/);
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
