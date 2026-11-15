import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createDatabaseClient } from '@trade-blotter/database';
import { createApp } from './app';
import { createLogger } from './logging/logger';
import { createAuthRepository } from './auth/auth-repository';
import { createTradeRepository } from './trades/trade-repository';
import { createOutboxRepository } from './trades/outbox/outbox-repository';
import { createOutboxRelayer } from './trades/outbox/outbox-relayer';
import { startOutboxRecovery } from './trades/outbox/outbox-recovery';
import { createTradeBroadcaster } from './trades/sse/trade-broadcaster';

const logger = createLogger(process.env.LOG_LEVEL);
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required; check backend/.env.');
}

const secureCookies = process.env.NODE_ENV === 'production';

let origin: string;
try {
  origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:5173').origin;
} catch {
  // URL parsing errors can echo the supplied value; keep configuration errors constant.
  throw new Error('APP_ORIGIN must be a valid URL.');
}

if (secureCookies && !origin.startsWith('https://')) {
  throw new Error('APP_ORIGIN must use HTTPS in production.');
}

const prisma = createDatabaseClient(connectionString);

// Database Repositories
const authRepository = createAuthRepository(prisma);
const tradeRepository = createTradeRepository(prisma);

// SSE broadcaster and outbox relayer are created here so that they can be shared across all requests.
const broadcaster = createTradeBroadcaster(logger);
const relayer = createOutboxRelayer(createOutboxRepository(prisma), broadcaster.broadcast, { logger });

const app = createApp(
  { auth: authRepository, trades: tradeRepository },
  { origin, secureCookies },
  {
    broadcaster,
    logger,
    onTradeChanged: () => { void relayer.wake(); },
  },
);

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => {
  logger.info({ event: 'server.started', port: info.port });
});

const stopRecovery = startOutboxRecovery(relayer.wake);
server.once('close', () => {
  stopRecovery();
  logger.info({ event: 'server.closed' });
});
