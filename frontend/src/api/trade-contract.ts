import { z } from 'zod';

// Browser-only response validation; decimal strings keep the API's exact precision.
export const tradeResponseSchema = z.object({
  id: z.uuid(),
  symbol: z.string().min(1).max(12),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.string().regex(/^(0|[1-9]\d*)\.\d{6}$/),
  price: z.string().regex(/^(0|[1-9]\d*)\.\d{4}$/),
  trader: z.string().min(1).max(120),
  ownerId: z.uuid(),
  book: z.string().max(64).nullable(),
  counterparty: z.string().max(120).nullable(),
  tradeDate: z.iso.datetime({ precision: 3 }),
  status: z.enum(['ACTIVE', 'CANCELLED']),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime({ precision: 3 }),
  updatedAt: z.iso.datetime({ precision: 3 }),
});

export type Trade = z.infer<typeof tradeResponseSchema>;

export const tradeListResponseSchema = z.object({ trades: z.array(tradeResponseSchema) });
export type TradeListResponse = z.infer<typeof tradeListResponseSchema>;
