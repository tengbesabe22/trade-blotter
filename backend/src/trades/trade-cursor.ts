import { z } from 'zod';
import type { NormalizedTradeListQuery } from './trade-query-contract';

const MAX_CURSOR_LENGTH = 2048;

/** Validates fixed-scale decimal text in integer units without changing the string.
 * Example: price '227.4500' is checked as 2274500n, avoiding floating-point rounding.
 */
function decimalBoundary(scale: number, maximum: bigint) {
  return z.string()
    .regex(new RegExp(`^(0|[1-9]\\d{0,9})\\.\\d{${scale}}$`))
    // Only convert after the format passes, so malformed values remain validation errors.
    .pipe(z.string().refine((value) => {
      const scaled = BigInt(value.replace('.', ''));
      return scaled > 0n && scaled <= maximum;
    }));
}

// Keep each sort field paired with its value type; decimals stay exact strings.
const boundarySchema = z.discriminatedUnion('sortBy', [
  z.strictObject({ sortBy: z.literal('tradeDate'), value: z.iso.datetime({ precision: 3 }), id: z.uuid() }),
  z.strictObject({
    sortBy: z.literal('symbol'),
    value: z.string().min(1).max(12).refine((value) => value === value.trim().toUpperCase()),
    id: z.uuid(),
  }),
  z.strictObject({
    sortBy: z.literal('trader'),
    value: z.string().min(1).max(120).refine((value) => value.trim().length > 0),
    id: z.uuid(),
  }),
  z.strictObject({ sortBy: z.literal('quantity'), value: decimalBoundary(6, 1_000_000_000_000_000n), id: z.uuid() }),
  z.strictObject({ sortBy: z.literal('price'), value: decimalBoundary(4, 10_000_000_000n), id: z.uuid() }),
  z.strictObject({ sortBy: z.literal('status'), value: z.enum(['ACTIVE', 'CANCELLED']), id: z.uuid() }),
]);

const cursorPayloadSchema = z.strictObject({
  version: z.literal(1),
  sortDirection: z.enum(['asc', 'desc']),
  boundary: boundarySchema,
});

export type TradeCursorBoundary = z.output<typeof boundarySchema>;

export class InvalidTradeCursorError extends Error {
  readonly code = 'INVALID_CURSOR';

  constructor() {
    super('Invalid cursor. Return to the first page.');
    this.name = 'InvalidTradeCursorError';
  }
}

/** Encodes the sort direction and row boundary as URL-safe JSON; no database lookup. */
export function encodeTradeCursor(
  query: NormalizedTradeListQuery,
  boundary: TradeCursorBoundary,
): string {
  const payload = cursorPayloadSchema.safeParse({
    version: 1,
    sortDirection: query.sortDirection,
    boundary,
  });

  if (!payload.success || boundary.sortBy !== query.sortBy) {
    throw new InvalidTradeCursorError();
  }

  return Buffer.from(JSON.stringify(payload.data)).toString('base64url');
}

/** Returns the validated boundary, or null for the first page.
 * Throws InvalidTradeCursorError for malformed content or incompatible sorting.
 */
export function decodeTradeCursor(query: NormalizedTradeListQuery): TradeCursorBoundary | null {
  const token = query.after;
  if (token === null) return null;
  if (token.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new InvalidTradeCursorError();
  }

  const bytes = Buffer.from(token, 'base64url');
  if (bytes.toString('base64url') !== token) throw new InvalidTradeCursorError();

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new InvalidTradeCursorError();
  }

  const payload = cursorPayloadSchema.safeParse(rawPayload);
  if (!payload.success) throw new InvalidTradeCursorError();

  if (payload.data.sortDirection !== query.sortDirection || payload.data.boundary.sortBy !== query.sortBy) {
    throw new InvalidTradeCursorError();
  }
  return payload.data.boundary;
}
