import { Hono } from 'hono';
import type { AuthRepository } from '../auth/auth-repository';
import type { AuthEnv, AuthOptions } from '../auth/auth-contract';
import type { TradeRepository } from './trade-repository';
import { createTradeCreationRoutes } from './creation/trade-create-routes';
import { createTradeListingRoutes } from './listing/trade-list-routes';
import { createTradeAmendmentRoutes } from './amendments/trade-amend-routes';
import { createTradeCancellationRoutes } from './cancellations/trade-cancel-routes';

export function createTradeRoutes(
  authRepository: AuthRepository,
  tradeRepository: TradeRepository,
  options: AuthOptions,
  onTradeChanged?: () => void,
) {
  const routes = new Hono<AuthEnv>();

  routes.route('/', createTradeListingRoutes(authRepository, tradeRepository, options));
  routes.route('/', createTradeCreationRoutes(authRepository, tradeRepository, options, onTradeChanged));
  routes.route('/', createTradeAmendmentRoutes(authRepository, tradeRepository, options, onTradeChanged));

  routes.route('/', createTradeCancellationRoutes(authRepository, tradeRepository, options, onTradeChanged));

  return routes;
}
