import { Prisma } from '@trade-blotter/database';
import type { TradeResponse } from '../trade-contract';

// We use it to preserve the digits needed when multiplying large quantities by prices
const SummaryDecimal = Prisma.Decimal.clone({ precision: 40 });

type SummaryTrade = Pick<TradeResponse, 'side' | 'status' | 'quantity' | 'price'>;

export type TradeContribution = {
  buyQuantity: Prisma.Decimal;
  sellQuantity: Prisma.Decimal;
  buyValue: Prisma.Decimal;
  sellValue: Prisma.Decimal;
};

// Inputs are already validated trade data. CANCELLED trades never contribute.
export function calculateTradeContribution(trade: SummaryTrade | null): TradeContribution {
  const zero = new SummaryDecimal(0);
  const contribution = {
    buyQuantity: zero, sellQuantity: zero, buyValue: zero, sellValue: zero,
  };
  if (!trade || trade.status === 'CANCELLED') return contribution;

  const quantity = new SummaryDecimal(trade.quantity);
  const tradeValue = quantity.times(trade.price); // Executed value, excluding fees.
  return trade.side === 'BUY'
    ? { ...contribution, buyQuantity: quantity, buyValue: tradeValue }
    : { ...contribution, sellQuantity: quantity, sellValue: tradeValue };
}

// Create: before=null. Amend/cancel: compare the saved before/after trade states.
export function calculateSummaryDelta(before: SummaryTrade | null, after: SummaryTrade | null): TradeContribution {
  const previous = calculateTradeContribution(before);
  const next = calculateTradeContribution(after);

  return {
    buyQuantity: next.buyQuantity.minus(previous.buyQuantity),
    sellQuantity: next.sellQuantity.minus(previous.sellQuantity),
    buyValue: next.buyValue.minus(previous.buyValue),
    sellValue: next.sellValue.minus(previous.sellValue),
  };
}

export function hasSummaryChanges(delta: TradeContribution): boolean {
  return Object.values(delta).some((amount) => !amount.isZero());
}
