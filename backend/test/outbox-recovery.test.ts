import assert from 'node:assert/strict';
import test from 'node:test';
import { startOutboxRecovery } from '../src/trades/outbox/outbox-recovery';

test('startup recovery wakes once without polling while idle', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let wakes = 0;
  startOutboxRecovery(async () => { wakes += 1; });

  assert.equal(wakes, 1);
  t.mock.timers.tick(60_000);
  assert.equal(wakes, 1);
});
