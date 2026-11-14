import { Prisma, TradeAuditAction, TradeSide, TradeStatus } from '../generated/prisma/client.ts';

type SeedInstrument = { id: string; symbol: string; price: string };
type SeedTrader = { id: string; displayName: string };
export type SeedTransaction = Pick<Prisma.TransactionClient, 'trade' | 'tradeAudit'>;

const tradeCount = 500;
const books = ['EQUITIES_UK', 'EQUITIES_US', 'GLOBAL_EQUITIES'];
const counterparties = ['Goldman Sachs', 'Morgan Stanley', 'J.P. Morgan', 'Barclays', 'UBS'];
const tradingDayOffsets = [0, 1, 2, 3, 6]; // August 18–21 and 24, 2026: weekdays.

export function createSeedTradeFixtures(instruments: SeedInstrument[], traders: SeedTrader[]) {
  return Array.from({ length: tradeCount }, (_, i) => {
    const instrument = instruments[i % instruments.length];
    const trader = traders[i % traders.length];
    const cancelled = i > 0 && i % 7 === 0;
    const version = cancelled ? 2 : i > 0 && i % 11 === 0 ? 3 : 1;
    const tradeDate = new Date(
      Date.UTC(2026, 7, 18 + tradingDayOffsets[Math.floor(i / 100)], 9, 15, 23) + (i % 100) * 4 * 60_000,
    );
    const createdAt = new Date(tradeDate.getTime() + 60_000);
    const priceChange = i === 0 ? 0 : ((i * 137) % 10001) - 5000;
    const trade = {
      // Fixed UUIDs preserve existing fixtures and their runtime changes on reruns.
      id: `f1550000-0000-4000-8000-${String(100001 + i).padStart(12, '0')}`,
      instrumentId: instrument.id,
      userId: trader.id,
      side: Math.floor(i / instruments.length) % 2 === 0 ? TradeSide.BUY : TradeSide.SELL,
      quantity: i === 0 ? '5000.000000' : `${250 + ((i * 137) % 9750)}.${i % 4 === 0 ? '125000' : '000000'}`,
      price: new Prisma.Decimal(instrument.price).plus(new Prisma.Decimal(priceChange).div(10000)).toFixed(4),
      book: i > 0 && i % 17 === 0 ? null : books[Math.floor(i / 7) % books.length],
      counterparty: i > 0 && i % 19 === 0 ? null : counterparties[Math.floor(i / 3) % counterparties.length],
      tradeDate,
      status: cancelled ? TradeStatus.CANCELLED : TradeStatus.ACTIVE,
      version,
      createdAt,
      updatedAt: new Date(createdAt.getTime() + (version - 1) * 5 * 60_000),
    };

    const auditEntries = Array.from({ length: version }, (_, index) => {
      const tradeVersion = index + 1;
      const isCancellation = cancelled && tradeVersion === version;
      const recordedAt = new Date(createdAt.getTime() + index * 5 * 60_000);
      // Earlier ACTIVE versions differ by one cent; cancellation changes only status.
      const price = cancelled ? trade.price : new Prisma.Decimal(trade.price)
        .minus(new Prisma.Decimal('0.0100').times(version - tradeVersion)).toFixed(4);
      const snapshot = {
        id: trade.id, symbol: instrument.symbol, side: trade.side,
        quantity: trade.quantity, price, trader: trader.displayName, ownerId: trader.id,
        book: trade.book, counterparty: trade.counterparty, tradeDate: tradeDate.toISOString(),
        status: isCancellation ? TradeStatus.CANCELLED : TradeStatus.ACTIVE,
        version: tradeVersion, createdAt: createdAt.toISOString(), updatedAt: recordedAt.toISOString(),
      };

      return {
        tradeId: trade.id, tradeVersion, actorId: trader.id,
        action: index === 0 ? TradeAuditAction.CREATED : isCancellation ? TradeAuditAction.CANCELLED : TradeAuditAction.AMENDED,
        reason: index === 0 ? null : isCancellation ? 'Seeded trade cancellation.' : 'Seeded price amendment.',
        snapshot,
        recordedAt,
      };
    });

    return { trade, auditEntries };
  });
}

type SeedTradeFixture = ReturnType<typeof createSeedTradeFixtures>[number];

// The caller's transaction commits trades and their complete histories together.
export async function insertSeedTradeFixtures(tx: SeedTransaction, fixtures: SeedTradeFixture[]) {
  const inserted = await tx.trade.createManyAndReturn({
    data: fixtures.map((fixture) => fixture.trade),
    skipDuplicates: true,
    select: { id: true },
  });
  if (inserted.length === 0) return { trades: 0, auditEntries: 0 };

  // Returned rows have no guaranteed order. Match by ID, never by array position.
  const insertedIds = new Set(inserted.map((trade) => trade.id));
  const auditEntries = fixtures.filter((fixture) => insertedIds.has(fixture.trade.id))
    .flatMap((fixture) => fixture.auditEntries);
  const result = await tx.tradeAudit.createMany({ data: auditEntries });
  return { trades: inserted.length, auditEntries: result.count };
}
