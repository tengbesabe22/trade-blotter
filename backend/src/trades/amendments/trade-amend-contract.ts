import { z } from 'zod';
import type { TradeResponse } from '../trade-contract';
import { createTradeRequestSchema } from '../creation/trade-create-contract';

const createFields = createTradeRequestSchema.shape;

// Instrument identity is fixed at creation; symbol is not amendable.
const tradeChangesSchema = z.strictObject({
  side: createFields.side.optional(),
  quantity: createFields.quantity.optional(),
  price: createFields.price.optional(),
  tradeDate: createFields.tradeDate.optional(),

  // Unlike creation, omitted metadata must stay omitted. Only null/blank clears it.
  book: z.string()
    .trim()
    .max(64, 'Book must be at most 64 characters.')
    .transform((value) => value || null)
    .nullable()
    .optional(),
  counterparty: z.string()
    .trim()
    .max(120, 'Counterparty must be at most 120 characters.')
    .transform((value) => value || null)
    .nullable()
    .optional(),
}).refine((changes) => Object.values(changes).some((value) => value !== undefined), {
  message: 'At least one editable field is required.',
});

export const amendTradeRequestSchema = z.strictObject({
  // max value for postgres 32-bit integer
  expectedVersion: z.number().int().positive().max(2_147_483_647),
  changes: tradeChangesSchema,
  reason: z.string()
    .trim()
    .max(500, 'Reason must be at most 500 characters.')
    .nullish()
    .transform((value) => value || null),
});

export type AmendTradeRequest = z.input<typeof amendTradeRequestSchema>;

// Supplied fields are normalized; omitted trade fields remain unchanged.
export type NormalizedAmendTradeRequest = z.output<typeof amendTradeRequestSchema>;

// The authenticated actor and path ID come from the route, never the request body.
export type AmendTradeCommand = {
  userId: string;
  tradeId: string;
  input: NormalizedAmendTradeRequest;
};

export type AmendTradeResult =
  | { kind: 'amended'; body: { trade: TradeResponse } }
  | { kind: 'conflict'; currentTrade: TradeResponse }
  | { kind: 'not-found' | 'forbidden' | 'no-changes' };
