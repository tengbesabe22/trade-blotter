import { z } from 'zod';
import { tradeResponseSchema } from './trade-contract';

function decimalInput(label: string, scale: number, maximum: bigint) {
  // 0 or 1–10 whole digits without leading zeros; an optional fraction has 1–scale digits.
  // Signs, spaces and exponent notation are rejected; the range is checked below.
  return z.string()
    .regex(new RegExp('^(0|[1-9]\\d{0,9})(\\.\\d{1,' + scale + '})?$'),
      label + ' must be a decimal with at most ' + scale + ' decimal places.')
    .pipe(z.string().refine((value) => {
      const [whole, fraction = ''] = value.split('.');
      const units = BigInt(whole + fraction.padEnd(scale, '0'));
      return units > 0n && units <= maximum;
    }, label + ' must be greater than zero and within the supported limit.'));
}

export const createTradeRequestSchema = z.strictObject({
  symbol: z.string().trim().toUpperCase().min(1, 'Ticker is required.').max(12),
  side: z.enum(['BUY', 'SELL']),
  quantity: decimalInput('Quantity', 6, 1_000_000_000_000_000n),
  price: decimalInput('Price', 4, 10_000_000_000n),
  tradeDate: z.iso.datetime({ offset: true }),
  book: z.string().trim().max(64).transform((value) => value || null).nullable(),
  counterparty: z.string().trim().max(120).transform((value) => value || null).nullable(),
});

export type CreateTradeRequest = z.output<typeof createTradeRequestSchema>;
export const createTradeResponseSchema = z.object({ trade: tradeResponseSchema });
