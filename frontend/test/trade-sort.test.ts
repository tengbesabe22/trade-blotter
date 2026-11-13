import assert from 'node:assert/strict';
import test from 'node:test';
import { compareDecimalStrings } from '../src/trades/trade-sort';

test('decimal sorting compares magnitude rather than alphabetical order', () => {
  assert.ok(compareDecimalStrings('9.000000', '100.000000') < 0);
  assert.ok(compareDecimalStrings('227.4501', '9.5000') > 0);
  assert.equal(compareDecimalStrings('227.4501', '227.4501'), 0);
});

test('decimal sorting preserves the smallest quantity and price increments', () => {
  assert.ok(compareDecimalStrings('999999999.999998', '999999999.999999') < 0);
  assert.ok(compareDecimalStrings('999999.9998', '999999.9999') < 0);
});
