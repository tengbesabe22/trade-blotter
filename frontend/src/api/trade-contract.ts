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

export const tradeListQuerySchema = z.strictObject({
  limit: z.number().int().min(1).max(200),
  sortBy: z.enum(['tradeDate', 'symbol', 'trader', 'quantity', 'price', 'status']),
  sortDirection: z.enum(['asc', 'desc']),
  status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  after: z.string().min(1).max(2048).optional(),
});

export type TradeListQuery = z.infer<typeof tradeListQuerySchema>;
export const defaultTradeListQuery: TradeListQuery = { limit: 100, sortBy: 'tradeDate', sortDirection: 'desc' };

const pageInfoSchema = z.object({
  limit: z.number().int().min(1).max(200),
  nextCursor: z.string().min(1).max(2048).nullable(),
});

export const tradeListResponseSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime({ precision: 3 }),
  trades: z.array(tradeResponseSchema).max(200),
  pageInfo: pageInfoSchema,
}).refine((page) => page.trades.length <= page.pageInfo.limit, 'Page exceeds the requested limit.');
export type TradeListResponse = z.infer<typeof tradeListResponseSchema>;
