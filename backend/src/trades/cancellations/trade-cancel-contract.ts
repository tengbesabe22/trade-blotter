import { z } from 'zod';
import type { TradeResponse } from '../trade-contract';

// Cancellation sets status on the server; clients provide only a version and reason.
export const cancelTradeRequestSchema = z.strictObject({
  // Match the PostgreSQL Int range used by Trade.version.
  expectedVersion: z.number().int().positive().max(2_147_483_647),
  reason: z.string()
    .trim()
    .max(500, 'Reason must be at most 500 characters.')
    .nullish()
    .transform((value) => value || null),
});

export type CancelTradeRequest = z.input<typeof cancelTradeRequestSchema>;
export type NormalizedCancelTradeRequest = z.output<typeof cancelTradeRequestSchema>;

// The route supplies actor/path IDs; they are never accepted from the request body.
export type CancelTradeCommand = {
  userId: string;
  tradeId: string;
  input: NormalizedCancelTradeRequest;
};

export type CancelTradeResult =
  | { kind: 'cancelled'; body: { trade: TradeResponse } }
  | { kind: 'conflict'; currentTrade: TradeResponse }
  | { kind: 'not-found' | 'forbidden' };
