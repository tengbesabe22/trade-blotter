import 'dotenv/config';
import { randomBytes, scrypt } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma, Role, TradeSide, TradeStatus } from '../generated/prisma/client.ts';

// Synthetic local fixtures, not live prices or actual transactions.
const catalog = [
  { symbol: 'AAPL', name: 'Apple Inc.', price: '227.4500' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', price: '415.2600' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', price: '128.5000' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', price: '164.2100' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', price: '178.5500' },
  { symbol: 'META', name: 'Meta Platforms Inc.', price: '531.2000' },
  { symbol: 'TSLA', name: 'Tesla Inc.', price: '221.1000' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', price: '211.7500' },
  { symbol: 'V', name: 'Visa Inc.', price: '241.3050' },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation', price: '117.3800' },
];

const accounts = [
  { displayName: 'JSMITH', email: 'jsmith@example.com', role: Role.TRADER },
  { displayName: 'ADOE', email: 'adoe@example.com', role: Role.TRADER },
  { displayName: 'MLEE', email: 'mlee@example.com', role: Role.TRADER },
  { displayName: 'REVIEWER', email: 'reviewer@example.com', role: Role.READ_ONLY },
];
const demoPassword = 'LocalDemo!2026';
const tradeCount = 500;
const books = ['EQUITIES_UK', 'EQUITIES_US', 'GLOBAL_EQUITIES'];
const counterparties = ['Goldman Sachs', 'Morgan Stanley', 'J.P. Morgan', 'Barclays', 'UBS'];
const tradingDayOffsets = [0, 1, 2, 3, 6]; // August 18–21 and 24, 2026: weekdays.

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      {
        N: 131072,
        r: 8,
        p: 1,
        maxmem: 256 * 1024 * 1024,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });

  // Self-describing format for the future login verifier; salt/hash are hex.
  return `scrypt$131072$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

async function seed(prisma: PrismaClient): Promise<void> {
  // Hash before opening the transaction; salts differ for each account.
  const usersToCreate: Prisma.UserCreateInput[] = [];
  for (const account of accounts) {
    usersToCreate.push({ ...account, passwordHash: await hashPassword(demoPassword) });
  }

  const addedTrades = await prisma.$transaction(async (tx) => {
    const instruments: { id: string }[] = [];
    for (const { symbol, name } of catalog) {
      instruments.push(
        await tx.instrument.upsert({
          where: { symbol },
          select: { id: true },
          update: {},
          create: { symbol, name, currency: 'USD' },
        }),
      );
    }

    const users: { id: string }[] = [];
    for (const account of usersToCreate) {
      users.push(
        await tx.user.upsert({
          where: { email: account.email },
          select: { id: true },
          update: {}, // Preserve existing roles, names, and passwords on reruns.
          create: account,
        }),
      );
    }
    const traders = users.slice(0, 3);

    const trades: Prisma.TradeCreateManyInput[] = Array.from({ length: tradeCount }, (_, i) => {
      const instrumentIndex = i % catalog.length;
      const cancelled = i > 0 && i % 7 === 0;
      const version = cancelled ? 2 : i > 0 && i % 11 === 0 ? 3 : 1;
      const dayOffset = tradingDayOffsets[Math.floor(i / 100)];
      const tradeDate = new Date(
        Date.UTC(2026, 7, 18 + dayOffset, 9, 15, 23) + (i % 100) * 4 * 60_000,
      );
      const createdAt = new Date(tradeDate.getTime() + 60_000);
      const priceChange = i === 0 ? 0 : ((i * 137) % 10001) - 5000;

      return {
        // Fixed UUIDs make reruns skip fixtures instead of duplicating/resetting them.
        id: `f1550000-0000-4000-8000-${String(100001 + i).padStart(12, '0')}`,
        instrumentId: instruments[instrumentIndex].id,
        userId: traders[i % traders.length].id,
        side: Math.floor(i / catalog.length) % 2 === 0 ? TradeSide.BUY : TradeSide.SELL,
        quantity:
          i === 0
            ? '5000.000000'
            : `${250 + ((i * 137) % 9750)}.${i % 4 === 0 ? '125000' : '000000'}`,
        price: new Prisma.Decimal(catalog[instrumentIndex].price)
          .plus(new Prisma.Decimal(priceChange).div(10000))
          .toFixed(4),
        book: i > 0 && i % 17 === 0 ? null : books[Math.floor(i / 7) % books.length],
        counterparty:
          i > 0 && i % 19 === 0 ? null : counterparties[Math.floor(i / 3) % counterparties.length],
        tradeDate,
        status: cancelled ? TradeStatus.CANCELLED : TradeStatus.ACTIVE,
        version,
        createdAt,
        updatedAt: new Date(createdAt.getTime() + (version - 1) * 5 * 60_000),
      };
    });

    // These are baseline fixtures, not user mutations: no fabricated outbox,
    // session, or idempotency records. Existing runtime records are untouched.
    const result = await tx.trade.createMany({ data: trades, skipDuplicates: true });
    return result.count;
  });

  console.log(
    `Seed complete: 10 instruments and 4 demo accounts ready; ${addedTrades} trades added.`,
  );
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required; check database/.env.');

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });
  try {
    await seed(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seeding failed:', error);
  process.exitCode = 1;
});
