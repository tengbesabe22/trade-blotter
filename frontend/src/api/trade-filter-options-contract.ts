import { z } from 'zod';

// Shared reference data for Create trade and the ticker/trader filters.
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
