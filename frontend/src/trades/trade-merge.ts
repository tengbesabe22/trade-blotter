import type { Trade, TradeListQuery, TradeListResponse } from '../api/trade-contract';

// Local cache metadata, not part of the HTTP response contract.
export type LiveTradePage = TradeListResponse & { hasNewTrades?: boolean };

// Only the default newest-execution first page inserts unseen rows immediately.
export function isLiveFirstPage(request: TradeListQuery): boolean {
  return !request.after && request.sortBy === 'tradeDate' && request.sortDirection === 'desc';
}

// Choose a merge strategy without mixing row updates with pagination rules.
export function mergeLiveTradePage(
  page: LiveTradePage,
  incoming: Trade[],
  request: TradeListQuery,
): LiveTradePage {
  if (isLiveFirstPage(request)) {
    return mergeDefaultFirstPage(page, incoming, request.limit);
  }

  return updateCurrentPageRows(page, incoming);
}

// Keep the highest version per ID, newest execution first, capped at the limit.
// Fixed UTC timestamps and UUIDs match the default database ordering.
export function mergeNewestTrades(current: Trade[], incoming: Trade[], limit = 200): Trade[] {
  const records = new Map(current.map((trade) => [trade.id, trade]));
  for (const trade of incoming) {
    const existing = records.get(trade.id);
    if (!existing || trade.version > existing.version) records.set(trade.id, trade);
  }

  return [...records.values()].sort((left, right) => {
    if (left.tradeDate !== right.tradeDate) return left.tradeDate > right.tradeDate ? -1 : 1;
    return left.id > right.id ? -1 : left.id < right.id ? 1 : 0;
  }).slice(0, limit);
}

// Insert new rows into the default view, then check whether its cursor is still safe.
function mergeDefaultFirstPage(page: LiveTradePage, incoming: Trade[], limit: number): LiveTradePage {
  const trades = mergeNewestTrades(page.trades, incoming, limit);
  const cursorStale = needsFreshCursor(page, incoming, trades, limit);

  return {
    ...page,
    trades,
    pageInfo: cursorStale ? { ...page.pageInfo, nextCursor: null } : page.pageInfo,
    hasNewTrades: cursorStale,
  };
}

// Other views keep the same rows/order. Unseen trades set the notice flag instead of inserting.
function updateCurrentPageRows(page: LiveTradePage, incoming: Trade[]): LiveTradePage {
  const updates = new Map<string, Trade>();
  for (const trade of incoming) {
    const existing = updates.get(trade.id);
    if (!existing || trade.version > existing.version) updates.set(trade.id, trade);
  }

  const trades = page.trades.map((trade) => {
    const update = updates.get(trade.id);
    return update && update.version > trade.version ? update : trade;
  });
  const visibleIds = new Set(page.trades.map((trade) => trade.id));
  const hasUnseenTrades = incoming.some((trade) => !visibleIds.has(trade.id));

  return {
    ...page,
    trades,
    hasNewTrades: page.hasNewTrades === true || hasUnseenTrades,
  };
}

// Example: [A, B, C] becomes [X, A, B]. The old cursor after C would skip C.
function needsFreshCursor(
  page: LiveTradePage,
  incoming: Trade[],
  merged: Trade[],
  limit: number,
): boolean {
  // Keep the refresh flag until an HTTP snapshot supplies a fresh page/cursor.
  if (page.hasNewTrades === true) return true;

  const previousLast = page.trades.at(-1);
  const mergedLast = merged.at(-1);
  // check whether the last row changed, or if the page is now overfull, which would require a new cursor.
  const boundaryMoved = previousLast?.id !== mergedLast?.id || previousLast?.tradeDate !== mergedLast?.tradeDate;
  const uniqueTradeCount = new Set([...page.trades, ...incoming].map((trade) => trade.id)).size;
  const moreTradesThanFit = uniqueTradeCount > limit;
  const pageWasFull = page.trades.length === limit;

  if (boundaryMoved && (pageWasFull || moreTradesThanFit)) return true;

  // A previously final page now has overflow, so the server must issue a next cursor.
  return moreTradesThanFit && page.pageInfo.nextCursor === null;
}
