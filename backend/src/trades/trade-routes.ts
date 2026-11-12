import { Hono } from 'hono';
import type { AuthRepository } from '../auth/auth-repository';
import type { AuthOptions } from '../auth/session';
import { type AuthEnv, requireSession } from '../auth/session-middleware';
import type { TradeRepository } from './trade-repository';
import { toTradeResponse } from './trade-contract';

export function createTradeRoutes(
  authRepository: AuthRepository,
  tradeRepository: TradeRepository,
  options: AuthOptions,
) {
  const routes = new Hono<AuthEnv>();

  routes.get('/', requireSession(authRepository, options), async (c) => {
    const trades = await tradeRepository.list();

    return c.json({
      trades: trades.map(toTradeResponse),
    });
  });

  return routes;
}
