import { z } from 'zod';
import { tradeResponseSchema } from '../trade-contract';

export const streamReadySchema = z.strictObject({
  schemaVersion: z.literal(1),
  connectionId: z.uuid(),
  serverTime: z.iso.datetime({ precision: 3 }),
});

export type StreamReady = z.infer<typeof streamReadySchema>;

// Trade events carry the complete resulting record; no follow-up GET is needed.
export const tradeChangeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  changeId: z.uuid(),
  type: z.enum(['TRADE_CREATED', 'TRADE_AMENDED', 'TRADE_CANCELLED']),
  occurredAt: z.iso.datetime({ precision: 3 }),
  trade: tradeResponseSchema,
});

export type TradeChange = z.infer<typeof tradeChangeSchema>;
