import { Hono } from 'hono';
import type { Logger } from 'pino';
import { createLogger } from './logging/logger';
import { createRequestLogger, type RequestLogEnv } from './logging/request-logger';
import { createLoginRoutes } from './auth/login-routes';
import type { AuthRepository } from './auth/auth-repository';
import { createSessionRoutes } from './auth/session-routes';
import type { AuthOptions } from './auth/auth-contract';
import type { TradeRepository } from './trades/trade-repository';
import { createTradeRoutes } from './trades/trade-routes';
import { createTradeSummaryRoutes } from './trades/summaries/trade-summary-routes';
import { createTradeStreamRoutes } from './trades/sse/trade-stream-routes';
import { createTradeBroadcaster, type TradeBroadcaster } from './trades/sse/trade-broadcaster';

export type AppRepositories = { auth: AuthRepository; trades: TradeRepository };
type AppServices = {
  logger?: Logger;
  onTradeChanged?: () => void;
  broadcaster?: TradeBroadcaster;
};

// Separate app construction from the listening server so requests are testable.
export function createApp(
  repositories: AppRepositories,
  options: AuthOptions,
  services: AppServices = {},
) {
  const app = new Hono<RequestLogEnv>();
  // The listening server supplies its logger; app-only fixtures stay quiet by default.
  const logger = services.logger ?? createLogger('silent');
  const broadcaster = services.broadcaster ?? createTradeBroadcaster(logger);
  app.use('*', createRequestLogger(logger));

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.use('/api/auth/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');

    await next();
  });

  app.route('/api/auth', createLoginRoutes(repositories.auth, options));
  app.route('/api/auth', createSessionRoutes(repositories.auth, options));
  app.route('/api/trades', createTradeRoutes(
    repositories.auth,
    repositories.trades,
    options,
    services.onTradeChanged,
  ));
  app.route('/api/summaries', createTradeSummaryRoutes(repositories.auth, repositories.trades, options));
  app.route('/api/events', createTradeStreamRoutes(repositories.auth, options, broadcaster, logger));

  app.onError((_error, c) => {
    // Request middleware logs the handled error once, with its request ID.
    return c.json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }, 500);
  });

  return app;
}
