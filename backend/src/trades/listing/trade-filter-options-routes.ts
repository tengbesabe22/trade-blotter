import { Hono } from 'hono';
import type { AuthRepository } from '../../auth/auth-repository';
import type { AuthEnv, AuthOptions } from '../../auth/auth-contract';
import { requireSession } from '../../auth/auth-middleware';
import type { TradeRepository } from '../trade-repository';
import { tradeFilterOptionsSchema } from './trade-filter-options-contract';

export function createTradeFilterOptionsRoutes(
  authRepository: AuthRepository,
  tradeRepository: TradeRepository,
  options: AuthOptions,
) {
  const routes = new Hono<AuthEnv>();

  // Automatic reference loading must not renew idle time. Both roles may read it.
  routes.get('/filter-options', requireSession(authRepository, options, { recordActivity: false }), async (c) => {
    const result = await tradeRepository.listFilterOptions();

    // Validate the public shape and strip any extra fields before returning it.
    return c.json(tradeFilterOptionsSchema.parse(result));
  });

  return routes;
}
