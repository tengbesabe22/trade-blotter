import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@trade-blotter/database';
import { createTradeRepository } from '../src/trades/trade-repository';

const instruments = [{ symbol: 'AAPL', name: 'Apple Inc.' }];
const traders = [{ id: 'd197282d-99ca-4260-833a-702f97d1cba1', displayName: 'JSMITH' }];

function setup(empty = false, fail = false) {
  const calls = { instruments: [] as Prisma.InstrumentFindManyArgs[], traders: [] as Prisma.UserFindManyArgs[] };
  const fake = {
    instrument: { findMany: async (args: Prisma.InstrumentFindManyArgs) => {
      calls.instruments.push(args);
      if (fail) throw new Error('Database unavailable.');
      return empty ? [] : instruments;
    } },
    user: { findMany: async (args: Prisma.UserFindManyArgs) => { calls.traders.push(args); return empty ? [] : traders; } },
    trade: { findMany: async () => { throw new Error('Do not scan trades for lookup options.'); } },
    $transaction: async () => { throw new Error('Independent reference reads need no transaction.'); },
  };
  const database = fake as unknown as Parameters<typeof createTradeRepository>[0];
  return { repository: createTradeRepository(database), calls, fake };
}

test('filter options read both reference tables with minimal fields, trader role and stable ordering', async () => {
  const h = setup();
  assert.deepEqual(await h.repository.listFilterOptions(), { instruments, traders });
  assert.deepEqual(h.calls.instruments, [{ select: { symbol: true, name: true }, orderBy: { symbol: 'asc' } }]);
  assert.deepEqual(h.calls.traders, [{
    where: { role: 'TRADER' }, select: { id: true, displayName: true },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
  }]);
});

test('both independent reference reads start without waiting for each other', async () => {
  const h = setup();
  let finish!: (rows: typeof instruments) => void;
  h.fake.instrument.findMany = async (args) => {
    h.calls.instruments.push(args);
    return new Promise((resolve) => { finish = resolve; });
  };
  const result = h.repository.listFilterOptions();
  assert.equal(h.calls.instruments.length, 1);
  assert.equal(h.calls.traders.length, 1);
  finish(instruments);
  assert.deepEqual(await result, { instruments, traders });
});

test('empty reference tables do not require any trades to populate the options', async () => {
  assert.deepEqual(await setup(true).repository.listFilterOptions(), { instruments: [], traders: [] });
});

test('repository failures propagate to the route error handler', async () => {
  await assert.rejects(setup(false, true).repository.listFilterOptions(), /Database unavailable/);
});
