import { Hono } from 'hono';
import type { AuthRepository } from '../auth/auth-repository';
import type { AuthEnv, AuthOptions } from '../auth/auth-contract';
import { requireSession, requireTrader, requireTrustedOrigin } from '../auth/auth-middleware';
import type { TradeRepository } from './trade-repository';
import { toTradeResponse } from './trade-mapper';
import { createTradeRequestSchema, idempotencyKeySchema } from './trade-create-contract';
import { tradeFingerprint } from './trade-fingerprint';
import { tradeBodyLimit } from './trade-middleware';

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

  routes.post(
    '/',
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

      const keyValidation = idempotencyKeySchema.safeParse(
        c.req.header('Idempotency-Key'),
      );

      if (!keyValidation.success) {
        return c.json(
          { code: 'INVALID_INPUT', message: 'Provide a valid idempotency key.' },
          400,
        );
      }

      const requestBody: unknown = await c.req.json().catch(() => null);
      const validation = createTradeRequestSchema.safeParse(requestBody);

      if (!validation.success) {
        return c.json(
          { code: 'INVALID_INPUT', message: 'Provide valid trade details.' },
          400,
        );
      }

      const normalizedTradeRequest = validation.data;

      const result = await tradeRepository.create({
        userId: c.get('user').id,
        idempotencyKey: keyValidation.data,
        requestFingerprint: tradeFingerprint(normalizedTradeRequest),
        input: normalizedTradeRequest,
      });

      switch (result.kind) {
        case 'created':
        case 'replayed':
          return c.json(result.body, 201);
        case 'unknown-instrument':
          return c.json(
            { code: 'UNKNOWN_INSTRUMENT', message: 'The specified instrument does not exist.' },
            400,
          );
        case 'idempotency-conflict':
          return c.json(
            { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key conflict.' },
            409,
          );
      }
    },
  );

  return routes;
}
