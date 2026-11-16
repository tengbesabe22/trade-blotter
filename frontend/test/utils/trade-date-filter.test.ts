import assert from 'node:assert/strict';
import test from 'node:test';
import { tradeDateFilterSchema } from '../../src/trades/utils/trade-date-filter';

for (const [through, upperBound] of [
  ['2026-11-14', '2026-11-15T00:00:00.000Z'],
  ['2024-02-29', '2024-03-01T00:00:00.000Z'],
  ['2026-12-31', '2027-01-01T00:00:00.000Z'],
] as const) {
  test(`Through ${through} includes its whole UTC day`, () => {
    assert.deepEqual(tradeDateFilterSchema.parse({ from: through, through }), {
      tradeDateFrom: through + 'T00:00:00.000Z', tradeDateTo: upperBound,
    });
  });
}

test('UTC date bounds support either open end and no range', () => {
  assert.deepEqual(tradeDateFilterSchema.parse({ from: '2026-11-14', through: '' }), {
    tradeDateFrom: '2026-11-14T00:00:00.000Z', tradeDateTo: undefined,
  });
  assert.deepEqual(tradeDateFilterSchema.parse({ from: '', through: '2026-11-14' }), {
    tradeDateFrom: undefined, tradeDateTo: '2026-11-15T00:00:00.000Z',
  });
  assert.deepEqual(tradeDateFilterSchema.parse({ from: '', through: '' }), {
    tradeDateFrom: undefined, tradeDateTo: undefined,
  });
});

test('date drafts reject reversed ranges and invalid calendar dates', () => {
  for (const draft of [
    { from: '2026-11-15', through: '2026-11-14' },
    { from: '2026-02-29', through: '' },
    { from: '', through: 'not-a-date' },
    { from: '', through: '9999-12-31' },
  ]) assert.equal(tradeDateFilterSchema.safeParse(draft).success, false);
});
