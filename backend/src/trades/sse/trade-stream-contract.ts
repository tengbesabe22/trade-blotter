import { z } from 'zod';
import { tradeResponseSchema } from '../trade-contract';

export const streamReadySchema = z.strictObject({
  schemaVersion: z.literal(1),
  connectionId: z.uuid(),
  serverTime: z.iso.datetime({ precision: 3 }),
});

export type StreamReady = z.infer<typeof streamReadySchema>;

// Creation and amendment events carry the complete trade; no follow-up GET is needed.
export const tradeChangeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  changeId: z.uuid(),
  type: z.enum(['TRADE_CREATED', 'TRADE_AMENDED']),
  occurredAt: z.iso.datetime({ precision: 3 }),
  trade: tradeResponseSchema,
});

export type TradeChange = z.infer<typeof tradeChangeSchema>;
