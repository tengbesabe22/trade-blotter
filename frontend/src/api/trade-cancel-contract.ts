import { z } from 'zod';
import { tradeResponseSchema } from './trade-contract';

export const cancelTradeIdSchema = z.uuid();

// Status and ownership come from the server; cancellation accepts no trade edits.
export const cancelTradeRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive().max(2_147_483_647),
  reason: z.string().trim().max(500).nullish().transform((value) => value || null),
});

export type CancelTradeRequest = z.input<typeof cancelTradeRequestSchema>;

export const cancelTradeResponseSchema = z.object({
  trade: tradeResponseSchema.extend({ status: z.literal('CANCELLED') }),
});

// A conflict may describe a newer ACTIVE trade or an already-CANCELLED one.
export const cancelTradeConflictSchema = z.object({
  code: z.literal('TRADE_CONFLICT'),
  message: z.string(),
  currentTrade: tradeResponseSchema,
});
