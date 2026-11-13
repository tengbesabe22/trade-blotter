import { z } from 'zod';
import { tradeResponseSchema } from './trade-contract';

export const streamReadySchema = z.strictObject({
  schemaVersion: z.literal(1),
  connectionId: z.uuid(),
  serverTime: z.iso.datetime({ precision: 3 }),
});

export const tradeChangeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  changeId: z.uuid(),
  type: z.literal('TRADE_CREATED'),
  occurredAt: z.iso.datetime({ precision: 3 }),
  trade: tradeResponseSchema,
});
