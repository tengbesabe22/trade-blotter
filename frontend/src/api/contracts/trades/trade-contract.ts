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
  symbol: z.string().trim().toUpperCase().min(1).max(12).optional(),
  traderId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'CANCELLED']).optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  book: z.string().trim().max(64).transform((value) => value.toLowerCase() || undefined).optional(),
  counterparty: z.string().trim().max(120).transform((value) => value.toLowerCase() || undefined).optional(),
  tradeDateFrom: z.iso.datetime({ precision: 3 }).optional(),
  tradeDateTo: z.iso.datetime({ precision: 3 }).optional(),
  after: z.string().min(1).max(2048).optional(),
}).refine((query) => !query.tradeDateFrom || !query.tradeDateTo || query.tradeDateFrom < query.tradeDateTo, {
  path: ['tradeDateTo'], message: 'The execution-time upper bound must be after the lower bound.',
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
