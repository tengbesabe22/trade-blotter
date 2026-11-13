import type { Prisma } from '@trade-blotter/database';
import type { TradeCursorBoundary } from './trade-cursor';
import type { NormalizedTradeListQuery } from './trade-query-contract';

/** Escapes LIKE wildcards so a search for DESK_% matches those literal characters. */
function escapeLike(value: string): string {
  // Prisma contains uses LIKE: treat %, _ and backslash as literal search text.
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Builds ANDed business filters; selections within one field use IN (OR).
 * Example: symbols ['AAPL', 'MSFT'] + statuses ['ACTIVE'] means either ticker AND ACTIVE.
 */
export function tradeListFilters(query: NormalizedTradeListQuery): Prisma.TradeWhereInput {
  const where: Prisma.TradeWhereInput = {};

  if (query.symbols.length) where.instrument = { symbol: { in: query.symbols } };
  if (query.traderIds.length) where.userId = { in: query.traderIds };
  if (query.statuses.length) where.status = { in: query.statuses };
  if (query.sides.length) where.side = { in: query.sides };
  if (query.book) where.book = { contains: escapeLike(query.book), mode: 'insensitive' };
  if (query.counterparty) where.counterparty = { contains: escapeLike(query.counterparty), mode: 'insensitive' };
  if (query.tradeDateFrom || query.tradeDateTo) {
    where.tradeDate = {
      ...(query.tradeDateFrom ? { gte: new Date(query.tradeDateFrom) } : {}),
      ...(query.tradeDateTo ? { lt: new Date(query.tradeDateTo) } : {}),
    };
  }

  return where;
}

/** Orders by the selected database field, then ID in the same direction for ties.
 * Example: price/asc becomes [{ price: 'asc' }, { id: 'asc' }].
 */
export function tradeListOrder(
  sortBy: NormalizedTradeListQuery['sortBy'],
  direction: 'asc' | 'desc',
): Prisma.TradeOrderByWithRelationInput[] {
  let field: Prisma.TradeOrderByWithRelationInput;
  switch (sortBy) {
    case 'symbol': field = { instrument: { symbol: direction } }; break;
    case 'trader': field = { user: { displayName: direction } }; break;
    default: field = { [sortBy]: direction };
  }

  return [field, { id: direction }];
}

/** Maps a public sort value to its database field, including related records.
 * Example: trader/gt/JSMITH becomes user.displayName > JSMITH.
 */
function sortValueFilter(
  boundary: TradeCursorBoundary,
  comparison: 'lt' | 'gt' | 'equals',
): Prisma.TradeWhereInput {
  switch (boundary.sortBy) {
    case 'symbol': return { instrument: { symbol: { [comparison]: boundary.value } } };
    case 'trader': return { user: { displayName: { [comparison]: boundary.value } } };
    case 'tradeDate': return { tradeDate: { [comparison]: new Date(boundary.value) } };
    case 'quantity': return { quantity: { [comparison]: boundary.value } };
    case 'price': return { price: { [comparison]: boundary.value } };
    case 'status': {
      if (comparison === 'equals') return { status: { equals: boundary.value } };

      // Prisma enum filters lack lt/gt. Preserve PostgreSQL's declared enum order.
      const statuses = ['ACTIVE', 'CANCELLED'] as const;
      const anchorIndex = statuses.indexOf(boundary.value);
      return { status: { in: statuses.filter((_, index) =>
        comparison === 'lt' ? index < anchorIndex : index > anchorIndex,
      ) } };
    }
  }
}

/** Selects rows beyond a boundary, using ID when the sort values tie.
 * Example: price/gt becomes price > value OR (price = value AND id > boundary.id).
 */
export function tradeBoundaryFilter(
  boundary: TradeCursorBoundary,
  comparison: 'lt' | 'gt',
): Prisma.TradeWhereInput {
  return {
    OR: [
      sortValueFilter(boundary, comparison),
      { AND: [sortValueFilter(boundary, 'equals'), { id: { [comparison]: boundary.id } }] },
    ],
  };
}
