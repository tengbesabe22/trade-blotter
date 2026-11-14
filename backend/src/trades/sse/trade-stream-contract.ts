import { z } from 'zod';
import { tradeResponseSchema } from '../trade-contract';
import { symbolSummarySchema } from '../summaries/trade-summary-contract';

export const streamReadySchema = z.strictObject({
  schemaVersion: z.literal(1),
  connectionId: z.uuid(),
  serverTime: z.iso.datetime({ precision: 3 }),
});

export type StreamReady = z.infer<typeof streamReadySchema>;

// One event shape carries the resulting trade and absolute summary snapshots.
export const tradeChangeSchema = z.strictObject({
  changeId: z.uuid(),
  type: z.enum(['TRADE_CREATED', 'TRADE_AMENDED', 'TRADE_CANCELLED']),
  occurredAt: z.iso.datetime({ precision: 3 }),
  trade: tradeResponseSchema,
  // Symbols are immutable; metadata-only amendments affect no summary.
  summaries: z.array(symbolSummarySchema).max(1),
}).refine(
  (change) => change.type === 'TRADE_AMENDED' || change.summaries.length === 1,
  { message: 'Creation and cancellation require a summary snapshot.', path: ['summaries'] },
).refine(
  (change) => change.summaries.every((summary) => summary.symbol === change.trade.symbol),
  { message: 'Summary symbol must match the changed trade.', path: ['summaries'] },
);

export type TradeChange = z.infer<typeof tradeChangeSchema>;
