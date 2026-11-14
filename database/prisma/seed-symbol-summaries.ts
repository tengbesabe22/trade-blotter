import type { Prisma } from '../generated/prisma/client.ts';

export type SeedSummaryTransaction = Pick<Prisma.TransactionClient, '$queryRaw' | 'symbolSummary'>;
type SeedSummaryTotals = Pick<Prisma.SymbolSummaryCreateManyInput,
  'instrumentId' | 'buyQuantity' | 'sellQuantity' | 'buyValue' | 'sellValue' | 'version'>;

export async function insertSeedSymbolSummaries(tx: SeedSummaryTransaction): Promise<number> {
  // PostgreSQL sums exact decimals from the trades inserted earlier in this transaction.
  // LEFT JOIN also creates zero summaries for instruments without ACTIVE trades.
  const summaries = await tx.$queryRaw<SeedSummaryTotals[]>`
    SELECT i.id AS "instrumentId",
      COALESCE(SUM(t.quantity) FILTER (WHERE t.side = 'BUY'), 0) AS "buyQuantity",
      COALESCE(SUM(t.quantity) FILTER (WHERE t.side = 'SELL'), 0) AS "sellQuantity",
      COALESCE(SUM(t.quantity * t.price) FILTER (WHERE t.side = 'BUY'), 0) AS "buyValue",
      COALESCE(SUM(t.quantity * t.price) FILTER (WHERE t.side = 'SELL'), 0) AS "sellValue",
      CASE WHEN COUNT(t.id) > 0 THEN 1 ELSE 0 END AS version
    FROM "Instrument" i
    LEFT JOIN "Trade" t ON t."instrumentId" = i.id AND t.status = 'ACTIVE'
    GROUP BY i.id
  `;
  if (summaries.length === 0) return 0;

  // Existing rows may contain real demo-session changes; never reset them on reruns.
  const result = await tx.symbolSummary.createMany({ data: summaries, skipDuplicates: true });
  return result.count;
}
