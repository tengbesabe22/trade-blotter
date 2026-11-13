import { Hono } from 'hono';
import type { AuthRepository } from '../../auth/auth-repository';
import type { AuthEnv, AuthOptions } from '../../auth/auth-contract';
import { requireSession } from '../../auth/auth-middleware';
import type { TradeRepository } from '../trade-repository';
import { tradeListQuerySchema } from './trade-query-contract';
import { decodeTradeCursor, encodeTradeCursor, InvalidTradeCursorError } from './trade-cursor';
import type { TradeCursorBoundary } from './trade-cursor';
import { toTradeCursorBoundary, toTradeResponse } from '../trade-mapper';

export function createTradeListingRoutes(
  authRepository: AuthRepository,
  tradeRepository: TradeRepository,
  options: AuthOptions,
) {
  const routes = new Hono<AuthEnv>();

  // Sample Request: api/trades?limit=100&sortBy=tradeDate&sortDirection=desc&after=eyJ2ZXJzaW9uIjoxLCJzb3J0R...
  routes.get('/', requireSession(authRepository, options), async (c) => {
    const validation = tradeListQuerySchema.safeParse(c.req.queries());

    if (!validation.success) {
      return c.json({ code: 'INVALID_INPUT', message: 'Provide valid trade filters and pagination.' }, 400);
    }

    const query = validation.data;
    let boundary: TradeCursorBoundary | null;

    try {
      boundary = decodeTradeCursor(query);
    } catch (error) {
      if (!(error instanceof InvalidTradeCursorError)) throw error;
      return c.json({ code: error.code, message: error.message }, 400);
    }

    const page = await tradeRepository.list(query, boundary);
    const last = page.records.at(-1);

    return c.json({
      schemaVersion: 1,
      generatedAt: (options.now?.() ?? new Date()).toISOString(),
      trades: page.records.map(toTradeResponse),
      pageInfo: {
        limit: query.limit,
        nextCursor: page.hasNextPage && last
          ? encodeTradeCursor(query, toTradeCursorBoundary(last, query.sortBy))
          : null,
      },
    });
  });

  return routes;
}
