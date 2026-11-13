import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthRepository } from '../../auth/auth-repository';
import type { AuthEnv, AuthOptions } from '../../auth/auth-contract';
import { requireSession, requireTrader, requireTrustedOrigin } from '../../auth/auth-middleware';
import type { TradeRepository } from '../trade-repository';
import { tradeBodyLimit } from '../trade-middleware';
import { amendTradeRequestSchema } from './trade-amend-contract';

export function createTradeAmendmentRoutes(
  authRepository: AuthRepository,
  tradeRepository: TradeRepository,
  options: AuthOptions,
  onTradeChanged?: () => void,
) {
  const routes = new Hono<AuthEnv>();

  routes.patch(
    '/:id',
    requireSession(authRepository, options),
    requireTrader,
    requireTrustedOrigin(options.origin),
    tradeBodyLimit,
    async (c) => {
      const contentType = c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        return c.json(
          { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send trade details as application/json.' },
          415,
        );
      }

      const idValidation = z.uuid().safeParse(c.req.param('id'));
      if (!idValidation.success) {
        return c.json({ code: 'INVALID_INPUT', message: 'Provide a valid trade ID.' }, 400);
      }

      const requestBody: unknown = await c.req.json().catch(() => null);
      const validation = amendTradeRequestSchema.safeParse(requestBody);
      if (!validation.success) {
        return c.json({ code: 'INVALID_INPUT', message: 'Provide valid amendment details.' }, 400);
      }

      // Identity comes from the session; ownership and version guards stay in the repository.
      const result = await tradeRepository.amend({
        userId: c.get('user').id,
        tradeId: idValidation.data,
        input: validation.data,
      });

      switch (result.kind) {
        case 'amended':
          // The transaction has committed; relay delivery runs independently of this response.
          onTradeChanged?.();
          return c.json(result.body, 200);
        case 'not-found':
          return c.json({ code: 'TRADE_NOT_FOUND', message: 'Trade not found.' }, 404);
        case 'forbidden':
          return c.json({ code: 'FORBIDDEN', message: 'You can only amend your own trades.' }, 403);
        case 'no-changes':
          return c.json({ code: 'NO_CHANGES', message: 'Provide at least one change to the trade.' }, 400);
        case 'conflict':
          return c.json({
            code: 'TRADE_CONFLICT',
            message: 'The trade has changed or been cancelled. Review its current state before trying again.',
            currentTrade: result.currentTrade,
          }, 409);
      }
    },
  );

  return routes;
}
