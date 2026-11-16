import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePositionSummaries } from '../../src/trades/utils/trade-summary-merge';
import { sampleSummary, shortSummary, flatSummary } from '../fixtures/trade-summary-fixtures';

test('summaries merge by instrument and appear in symbol order', () => {
  const current = [shortSummary];
  assert.deepEqual(mergePositionSummaries(current, [flatSummary, sampleSummary]), [sampleSummary, shortSummary, flatSummary]);
  assert.deepEqual(current, [shortSummary]);
});

test('duplicate and older revisions leave both totals and the array unchanged', () => {
  const current = [sampleSummary];
  assert.equal(mergePositionSummaries(current, [{ ...sampleSummary, netQuantity: '999.000000' },
    { ...sampleSummary, version: 8 }]), current);
  assert.equal(mergePositionSummaries(current, []), current);
});

test('each instrument has its own revision, including case-insensitive UUID identity', () => {
  const newest = { ...sampleSummary, instrumentId: sampleSummary.instrumentId.toUpperCase(),
    version: 10, netQuantity: '80.000000' };
  assert.deepEqual(mergePositionSummaries([sampleSummary, shortSummary], [newest, { ...shortSummary, version: 2 }]), [newest, shortSummary]);
});

test('zero positions are retained and absolute snapshots are never added twice', () => {
  const zero = { ...sampleSummary, ...flatSummary, instrumentId: sampleSummary.instrumentId, symbol: 'AAPL', version: 10 };
  const result = mergePositionSummaries([sampleSummary], [zero, zero]);
  assert.deepEqual(result, [zero]);
});

test('merging preserves large decimal strings exactly', () => {
  const large = { ...sampleSummary, version: 10,
    buyQuantity: '9999999999999999999999.999999', netQuantity: '9999999999999999999999.999999',
    buyValue: '9999999999999999999999999999.9999999999' };
  assert.deepEqual(mergePositionSummaries([sampleSummary], [large]), [large]);
});
