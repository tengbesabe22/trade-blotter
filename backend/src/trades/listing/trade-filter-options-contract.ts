import { z } from 'zod';

// Reference options are independent of the current trade page or filter selection.
export const tradeFilterOptionsSchema = z.object({
  instruments: z.array(z.object({
    symbol: z.string().min(1).max(12),
    name: z.string().min(1).max(120),
  })),
  traders: z.array(z.object({
    id: z.uuid(),
    displayName: z.string().min(1).max(120),
  })),
});

export type TradeFilterOptions = z.infer<typeof tradeFilterOptionsSchema>;
