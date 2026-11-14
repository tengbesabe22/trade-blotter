import { Hono } from 'hono';
import type { AuthRepository } from '../../auth/auth-repository';
import type { AuthEnv, AuthOptions } from '../../auth/auth-contract';
import { requireSession } from '../../auth/auth-middleware';
import type { TradeRepository } from '../trade-repository';
import { tradeSummaryResponseSchema } from './trade-summary-contract';

export function createTradeSummaryRoutes(
  authRepository: AuthRepository,
  tradeRepository: TradeRepository,
  options: AuthOptions,
) {
  const routes = new Hono<AuthEnv>();

  // Both roles see the same desk-wide totals, independently of blotter filters.
  routes.get('/', requireSession(authRepository, options), async (c) => {
    const summaries = await tradeRepository.listSummaries();

    return c.json(tradeSummaryResponseSchema.parse({
      schemaVersion: 1,
      generatedAt: (options.now?.() ?? new Date()).toISOString(),
      summaries,
    }));
  });

  return routes;
}
