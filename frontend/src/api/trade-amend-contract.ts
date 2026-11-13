import { z } from 'zod';
import { createTradeRequestSchema } from './trade-create-contract';
import { tradeResponseSchema } from './trade-contract';

export const amendTradeIdSchema = z.uuid();

// Reuse creation validation, excluding the immutable symbol. Omitted fields stay omitted.
const tradeChangesSchema = createTradeRequestSchema.omit({ symbol: true }).partial()
  .refine((changes) => Object.values(changes).some((value) => value !== undefined), {
    message: 'At least one editable field is required.',
  });

export const amendTradeRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive().max(2_147_483_647),
  changes: tradeChangesSchema,
  reason: z.string().trim().max(500).nullish().transform((value) => value || null),
});

export type AmendTradeRequest = z.input<typeof amendTradeRequestSchema>;

export const amendTradeResponseSchema = z.object({ trade: tradeResponseSchema });

// Validate the error payload before offering its current trade to the user.
export const amendTradeConflictSchema = z.object({
  code: z.literal('TRADE_CONFLICT'),
  message: z.string(),
  currentTrade: tradeResponseSchema,
});
