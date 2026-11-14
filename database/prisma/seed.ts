import 'dotenv/config';
import { randomBytes, scrypt } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma, Role } from '../generated/prisma/client.ts';
import { createSeedTradeFixtures, insertSeedTradeFixtures } from './seed-trades.ts';

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

  const added = await prisma.$transaction(async (tx) => {
    const instruments: { id: string; symbol: string; price: string }[] = [];
    for (const { symbol, name, price } of catalog) {
      const instrument = await tx.instrument.upsert({
        where: { symbol },
        select: { id: true, symbol: true },
        update: {},
        create: { symbol, name, currency: 'USD' },
      });
      instruments.push({ ...instrument, price });
    }

    const users: { id: string; displayName: string }[] = [];
    for (const account of usersToCreate) {
      users.push(
        await tx.user.upsert({
          where: { email: account.email },
          select: { id: true, displayName: true },
          update: {}, // Preserve existing roles, names, and passwords on reruns.
          create: account,
        }),
      );
    }
    const traders = users.slice(0, 3);

    const fixtures = createSeedTradeFixtures(instruments, traders);
    // Synthetic history needs no outbox delivery, sessions or idempotency records.
    return insertSeedTradeFixtures(tx, fixtures);
  });

  console.log(
    `Seed complete: 10 instruments and 4 demo accounts ready; ${added.trades} trades and ${added.auditEntries} audit entries added.`,
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
