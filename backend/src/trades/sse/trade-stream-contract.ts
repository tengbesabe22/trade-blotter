import { z } from 'zod';
import { tradeResponseSchema } from '../trade-contract';

export const streamReadySchema = z.strictObject({
  schemaVersion: z.literal(1),
  connectionId: z.uuid(),
  serverTime: z.iso.datetime({ precision: 3 }),
});

export type StreamReady = z.infer<typeof streamReadySchema>;

// Creation-only delivery for now; the complete trade requires no follow-up GET.
export const tradeChangeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  changeId: z.uuid(),
  type: z.literal('TRADE_CREATED'),
  occurredAt: z.iso.datetime({ precision: 3 }),
  trade: tradeResponseSchema,
});

export type TradeChange = z.infer<typeof tradeChangeSchema>;
