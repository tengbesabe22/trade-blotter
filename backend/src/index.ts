import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createDatabaseClient } from '@trade-blotter/database';
import { createApp } from './app';
import { createAuthRepository } from './auth/auth-repository';
import { createTradeRepository } from './trades/trade-repository';
import { createOutboxRepository } from './trades/outbox/outbox-repository';
import { createOutboxRelayer } from './trades/outbox/outbox-relayer';
import { startOutboxRecovery } from './trades/outbox/outbox-recovery';
import { createTradeBroadcaster } from './trades/sse/trade-broadcaster';

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

// Database Repositories
const authRepository = createAuthRepository(prisma);
const tradeRepository = createTradeRepository(prisma);

// SSE broadcaster and outbox relayer are created here so that they can be shared across all requests.
const broadcaster = createTradeBroadcaster();
const relayer = createOutboxRelayer(createOutboxRepository(prisma), broadcaster.broadcast);

const app = createApp(
  { auth: authRepository, trades: tradeRepository },
  { origin, secureCookies },
  {
    broadcaster,
    onTradeChanged: () => { void relayer.wake(); },
  },
);

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`);
});

const stopRecovery = startOutboxRecovery(relayer.wake);
server.once('close', stopRecovery);
