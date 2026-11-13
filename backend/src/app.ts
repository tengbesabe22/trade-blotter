import { Hono } from 'hono';
import { createLoginRoutes } from './auth/login-routes';
import type { AuthRepository } from './auth/auth-repository';
import { createSessionRoutes } from './auth/session-routes';
import type { AuthOptions } from './auth/auth-contract';
import type { TradeRepository } from './trades/trade-repository';
import { createTradeRoutes } from './trades/trade-routes';
import { createTradeStreamRoutes } from './trades/sse/trade-stream-routes';
import { createTradeBroadcaster, type TradeBroadcaster } from './trades/sse/trade-broadcaster';

export type AppRepositories = { auth: AuthRepository; trades: TradeRepository };
type AppServices = {
  onTradeChanged?: () => void;
  broadcaster?: TradeBroadcaster;
};

// Separate app construction from the listening server so requests are testable.
export function createApp(
  repositories: AppRepositories,
  options: AuthOptions,
  services: AppServices = {},
) {
  const app = new Hono();
  const broadcaster = services.broadcaster ?? createTradeBroadcaster();

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
  app.route('/api/events', createTradeStreamRoutes(repositories.auth, options, broadcaster));

  app.onError((error, c) => {
    console.error('Request failed:', error.name);

    return c.json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }, 500);
  });

  return app;
}
