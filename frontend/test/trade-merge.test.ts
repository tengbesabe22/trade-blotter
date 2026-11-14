import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTradeListQuery } from '../src/api/trade-contract';
import { mergeLiveTradePage, mergeNewestTrades } from '../src/trades/trade-merge';
import { sampleTrade, tradePage } from './trade-fixtures';

const newer = {
  ...sampleTrade, id: 'f1550000-0000-4000-8000-000000100003', symbol: 'TSLA',
  tradeDate: '2026-11-13T09:00:00.000Z',
};

test('live default-page insertion is immutable, ordered and deduplicated', () => {
  const page = tradePage([sampleTrade]);
  const result = mergeLiveTradePage(page, [newer, newer], defaultTradeListQuery);
  assert.deepEqual(result.trades, [newer, sampleTrade]);
  assert.deepEqual(page.trades, [sampleTrade]);
  assert.equal(result.pageInfo.nextCursor, null);
  assert.equal(result.hasNewTrades, false);
});

test('a full live page stays bounded and clears its displaced-row cursor until refreshed', () => {
  const page = tradePage([sampleTrade], { limit: 1, nextCursor: 'old-boundary' });
  const result = mergeLiveTradePage(page, [newer], { ...defaultTradeListQuery, limit: 1 });
  assert.deepEqual(result.trades, [newer]);
  assert.equal(result.pageInfo.nextCursor, null);
  assert.equal(result.hasNewTrades, true);

  const refreshed = tradePage([newer], { limit: 1, nextCursor: 'new-boundary' });
  const reconciled = mergeLiveTradePage(refreshed, [newer], { ...defaultTradeListQuery, limit: 1 });
  assert.equal(reconciled.pageInfo.nextCursor, 'new-boundary');
  assert.equal(reconciled.hasNewTrades, false);
});

test('a backdated creation beyond the current page preserves an existing valid cursor', () => {
  const older = { ...newer, tradeDate: '2026-01-01T00:00:00.000Z' };
  const page = tradePage([sampleTrade], { limit: 1, nextCursor: 'same-boundary' });
  const result = mergeLiveTradePage(page, [older], { ...defaultTradeListQuery, limit: 1 });
  assert.deepEqual(result.trades, [sampleTrade]);
  assert.equal(result.pageInfo.nextCursor, 'same-boundary');
  assert.equal(result.hasNewTrades, false);
});

test('a new row beyond a previously final full page requires a fresh cursor', () => {
  const older = { ...newer, tradeDate: '2026-01-01T00:00:00.000Z' };
  const result = mergeLiveTradePage(tradePage([sampleTrade], { limit: 1 }), [older], {
    ...defaultTradeListQuery, limit: 1,
  });
  assert.equal(result.hasNewTrades, true);
});

test('older pages and other sorts keep their position and show a new-trade notice', () => {
  for (const query of [
    { ...defaultTradeListQuery, after: 'older-page' },
    { ...defaultTradeListQuery, sortBy: 'price' as const },
    { ...defaultTradeListQuery, sortDirection: 'asc' as const },
  ]) {
    const result = mergeLiveTradePage(tradePage([sampleTrade], { nextCursor: 'keep-cursor' }), [newer], query);
    assert.deepEqual(result.trades, [sampleTrade]);
    assert.equal(result.pageInfo.nextCursor, 'keep-cursor');
    assert.equal(result.hasNewTrades, true);
  }
});

test('a late snapshot cannot overwrite a newer version received from the stream', () => {
  const updated = { ...sampleTrade, version: 2, price: '230.0000' };
  const result = mergeLiveTradePage(tradePage([sampleTrade]), [updated], defaultTradeListQuery);
  assert.deepEqual(result.trades, [updated]);
  assert.deepEqual(mergeNewestTrades([updated], [sampleTrade]), [updated]);
});

test('the pending-event buffer keeps at most 200 newest execution times with ID tie-breaking', () => {
  const rows = Array.from({ length: 201 }, (_, index) => ({
    ...sampleTrade, id: `f1550000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  }));
  const result = mergeNewestTrades([], rows);
  assert.equal(result.length, 200);
  assert.equal(result[0]?.id, rows[200]?.id);
  assert.equal(result.at(-1)?.id, rows[1]?.id);
});

test('visible rows on another sort retain the highest incoming version', () => {
  const updated = { ...sampleTrade, version: 3, price: '230.0000' };
  const older = { ...sampleTrade, version: 2, price: '229.0000' };
  const result = mergeLiveTradePage(tradePage([sampleTrade]), [updated, older], {
    ...defaultTradeListQuery, sortBy: 'price',
  });
  assert.deepEqual(result.trades, [updated]);
});


for (const query of [
  { ...defaultTradeListQuery, status: 'ACTIVE' as const },
  { ...defaultTradeListQuery, side: 'BUY' as const },
]) {
  test(`live ${query.status ? 'Status' : 'Side'} filtering ignores unrelated events without invalidating the cursor`, () => {
    const unrelated = { ...newer, status: 'CANCELLED' as const, side: 'SELL' as const };
    const result = mergeLiveTradePage(tradePage([sampleTrade], { nextCursor: 'keep' }), [unrelated], query);
    assert.deepEqual(result.trades, [sampleTrade]);
    assert.equal(result.pageInfo.nextCursor, 'keep');
    assert.equal(result.hasNewTrades, false);
  });
}

test('filtering happens before the live page limit so unrelated rows cannot displace matching trades', () => {
  const result = mergeLiveTradePage(tradePage([sampleTrade], { limit: 1, nextCursor: 'keep' }), [
    { ...newer, status: 'CANCELLED' },
  ], { ...defaultTradeListQuery, limit: 1, status: 'ACTIVE' });
  assert.deepEqual(result.trades, [sampleTrade]);
  assert.equal(result.pageInfo.nextCursor, 'keep');
});

for (const after of [undefined, 'older-page']) {
  test(`a higher version leaving the filter is removed and requests refill on ${after ? 'older' : 'first'} pages`, () => {
    const result = mergeLiveTradePage(tradePage([sampleTrade], { nextCursor: 'old' }), [
      { ...sampleTrade, status: 'CANCELLED', version: 3 },
      { ...sampleTrade, version: 2 },
    ], { ...defaultTradeListQuery, status: 'ACTIVE', after });
    assert.deepEqual(result.trades, []);
    assert.equal(result.needsRefill, true);
    assert.equal(result.pageInfo.nextCursor, null);
    const stale = mergeLiveTradePage(tradePage([sampleTrade]), [
      { ...sampleTrade, status: 'CANCELLED', version: 1 },
    ], { ...defaultTradeListQuery, status: 'ACTIVE', after });
    assert.deepEqual(stale.trades, [sampleTrade]);
    assert.equal(stale.needsRefill, false);
  });
}

test('matching filters combine with AND, while older pages ignore unrelated unseen rows', () => {
  const query = { ...defaultTradeListQuery, status: 'ACTIVE' as const, side: 'SELL' as const };
  const matching = { ...newer, side: 'SELL' as const };
  const result = mergeLiveTradePage(tradePage([]), [sampleTrade, matching], query);
  assert.deepEqual(result.trades, [matching]);
  const older = mergeLiveTradePage(tradePage([]), [sampleTrade], { ...query, after: 'older-page' });
  assert.deepEqual(older.trades, []);
  assert.equal(older.hasNewTrades, false);
});


test('a Side amendment removes a BUY from a BUY-only page without accepting a stale version', () => {
  const result = mergeLiveTradePage(tradePage([sampleTrade]), [
    { ...sampleTrade, side: 'SELL', version: 2 }, sampleTrade,
  ], { ...defaultTradeListQuery, side: 'BUY' });
  assert.deepEqual(result.trades, []);
  assert.equal(result.needsRefill, true);
});
