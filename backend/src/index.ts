import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createDatabaseClient } from '@trade-blotter/database';
import { createApp } from './app';
import { createAuthRepository } from './auth/auth-repository';
import { createTradeRepository } from './trades/trade-repository';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required; check backend/.env.');
}

const secureCookies = process.env.NODE_ENV === 'production';

const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:5173').origin;

if (secureCookies && !origin.startsWith('https://')) {
  throw new Error('APP_ORIGIN must use HTTPS in production.');
}

const prisma = createDatabaseClient(connectionString);

const authRepository = createAuthRepository(prisma);
const tradeRepository = createTradeRepository(prisma);
const app = createApp({ auth: authRepository, trades: tradeRepository }, { origin, secureCookies });

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`);
});
