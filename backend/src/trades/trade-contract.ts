import { Prisma } from '@trade-blotter/database';
import { z } from 'zod';

function decimalStringSchema(label: string, scale: number, maximum: string) {
  const format = new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${scale}})?$`);

  return z.string()
    .regex(format, `${label} must be a decimal string with at most ${scale} decimal places.`)
    // Construct once after syntax validation; reuse the value for bounds and formatting.
    .transform((value) => new Prisma.Decimal(value))
    .refine(
      (decimal) => decimal.gt(0) && decimal.lte(maximum),
      `${label} must be greater than zero and at most ${maximum}.`,
    )
    // Scale was already checked, so formatting adds zeros without rounding.
    .transform((decimal) => decimal.toFixed(scale));
}

export const quantitySchema = decimalStringSchema('Quantity', 6, '1000000000');
export const priceSchema = decimalStringSchema('Price', 4, '1000000');

export const tradeDateSchema = z.iso.datetime({ offset: true })
  .refine(
    (value) => /T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value),
    'Trade date must include seconds, a timezone, and at most three fractional digits.',
  )
  .refine((value) => Number.isFinite(Date.parse(value)), 'Trade date must be a valid timestamp.');

export const tradeResponseSchema = z.strictObject({
  id: z.uuid(),
  symbol: z.string().min(1).max(12)
    .refine((value) => value === value.trim().toUpperCase(), 'Symbol must be normalized.'),
  side: z.enum(['BUY', 'SELL']),
  // Responses must already have the required scale before shared validation runs.
  quantity: z.string()
    .regex(/^\d+\.\d{6}$/, 'Quantity must have six decimal places.')
    .pipe(quantitySchema),
  price: z.string()
    .regex(/^\d+\.\d{4}$/, 'Price must have four decimal places.')
    .pipe(priceSchema),
  trader: z.string().min(1).max(120).refine((value) => value.trim().length > 0),
  ownerId: z.uuid(),
  book: z.string().max(64).nullable(),
  counterparty: z.string().max(120).nullable(),
  tradeDate: z.iso.datetime({ precision: 3 }),
  status: z.enum(['ACTIVE', 'CANCELLED']),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

export type TradeResponse = z.infer<typeof tradeResponseSchema>;

export const tradeListResponseSchema = z.strictObject({ trades: z.array(tradeResponseSchema) });
export type TradeListResponse = z.infer<typeof tradeListResponseSchema>;
