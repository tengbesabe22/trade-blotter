import { Hono } from 'hono';
import type { AuthRepository } from '../../auth/auth-repository';
import type { AuthEnv, AuthOptions } from '../../auth/auth-contract';
import { requireSession } from '../../auth/auth-middleware';
import type { TradeRepository } from '../trade-repository';
import { tradeHistoryIdSchema, tradeHistoryResponseSchema } from './trade-history-contract';

export function createTradeHistoryRoutes(
  authRepository: AuthRepository,
  tradeRepository: TradeRepository,
  options: AuthOptions,
) {
  const routes = new Hono<AuthEnv>();

  // Both roles can inspect any trade under the shared blotter visibility rules.
  routes.get('/:id/history', requireSession(authRepository, options), async (c) => {
    const validation = tradeHistoryIdSchema.safeParse(c.req.param('id'));
    if (!validation.success) {
      return c.json({ code: 'INVALID_INPUT', message: 'Provide a valid trade ID.' }, 400);
    }

    const tradeId = validation.data;
    const result = await tradeRepository.listHistory(tradeId);
    if (result.kind === 'not-found') {
      return c.json({ code: 'TRADE_NOT_FOUND', message: 'Trade not found.' }, 404);
    }

    return c.json(tradeHistoryResponseSchema.parse({
      schemaVersion: 1,
      generatedAt: (options.now?.() ?? new Date()).toISOString(),
      tradeId,
      entries: result.entries,
    }));
  });

  return routes;
}
