import { z } from 'zod';
import { priceSchema, quantitySchema, tradeDateSchema, tradeResponseSchema } from '../trade-contract';

export const createTradeRequestSchema = z.strictObject({
  symbol: z.string()
    .trim()
    .toUpperCase()
    .min(1, 'Symbol is required.')
    .max(12, 'Symbol must be at most 12 characters.'),
  side: z.enum(['BUY', 'SELL']),
  quantity: quantitySchema,
  price: priceSchema,
  tradeDate: tradeDateSchema
    .transform((value) => new Date(value).toISOString())
    .pipe(z.iso.datetime({ precision: 3 })),
  book: z.string()
    .trim()
    .max(64, 'Book must be at most 64 characters.')
    .nullish()
    .transform((value) => value || null),
  counterparty: z.string()
    .trim()
    .max(120, 'Counterparty must be at most 120 characters.')
    .nullish()
    .transform((value) => value || null),
});

export type CreateTradeRequest = z.input<typeof createTradeRequestSchema>;

// Fixed-scale decimals, UTC execution time, and required nullable metadata.
export type NormalizedCreateTradeRequest = z.output<typeof createTradeRequestSchema>;

export const createTradeResponseSchema = z.strictObject({
  trade: tradeResponseSchema,
});

export type CreateTradeResponse = z.infer<typeof createTradeResponseSchema>;

// UI: crypto.randomUUID(), reused for retries of the same submission.
// The header accepts 1–120 ASCII letters/digits and . _ : - (no spaces).
export const idempotencyKeySchema = z.string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._:-]+$/, 'Idempotency key contains unsupported characters.');

// Internal route-to-repository command: clients send only the trade request body.
// The route adds the session user ID, header key and server-computed fingerprint.
export const createTradeCommandSchema = z.strictObject({
  userId: z.uuid(),
  idempotencyKey: idempotencyKeySchema,
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/, 'Fingerprint must be a SHA-256 hex digest.'),
  input: createTradeRequestSchema,
});

export type CreateTradeCommand = z.infer<typeof createTradeCommandSchema>;

// Success carries the response saved in the transaction, including on a replay.
export const createTradeResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('created'), body: createTradeResponseSchema }),
  z.strictObject({ kind: z.literal('replayed'), body: createTradeResponseSchema }),
  z.strictObject({ kind: z.literal('unknown-instrument') }),
  z.strictObject({ kind: z.literal('idempotency-conflict') }),
]);

export type CreateTradeResult = z.infer<typeof createTradeResultSchema>;
