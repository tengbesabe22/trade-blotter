import assert from 'node:assert/strict';
import test from 'node:test';
import { startOutboxRecovery } from '../src/trades/outbox/outbox-recovery';

test('recovery wakes immediately, every second, and stops when cleaned up', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let wakes = 0;
  const stop = startOutboxRecovery(async () => { wakes += 1; });

  try {
    assert.equal(wakes, 1); // Recover pending work at startup without waiting a second.
    t.mock.timers.tick(999);
    assert.equal(wakes, 1);
    t.mock.timers.tick(1);
    assert.equal(wakes, 2);
    t.mock.timers.tick(1000);
    assert.equal(wakes, 3);

    stop();
    t.mock.timers.tick(1000);
    assert.equal(wakes, 3);
  } finally {
    stop();
  }
});
