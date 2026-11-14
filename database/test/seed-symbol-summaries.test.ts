import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '../generated/prisma/client.ts';
import { insertSeedSymbolSummaries, type SeedSummaryTransaction } from '../prisma/seed-symbol-summaries.ts';

const totals = [{
  instrumentId: '33333333-3333-4333-8333-333333333333',
  buyQuantity: new Prisma.Decimal('999999999.999999'), sellQuantity: new Prisma.Decimal(0),
  buyValue: new Prisma.Decimal('999999999899999.0000000001'), sellValue: new Prisma.Decimal(0), version: 1,
}, {
  instrumentId: '44444444-4444-4444-8444-444444444444',
  buyQuantity: new Prisma.Decimal(0), sellQuantity: new Prisma.Decimal(0),
  buyValue: new Prisma.Decimal(0), sellValue: new Prisma.Decimal(0), version: 0,
}];

function writer(options: { empty?: boolean; inserted?: number; fail?: 'read' | 'write' } = {}) {
  const calls: string[] = [];
  let input: { data: Prisma.SymbolSummaryCreateManyInput[]; skipDuplicates: boolean } | undefined;
  const failure = new Error('Seed summary failure.');
  const tx = {
    $queryRaw: async () => {
      calls.push('read');
      if (options.fail === 'read') throw failure;
      return options.empty ? [] : totals;
    },
    symbolSummary: {
      createMany: async (data: NonNullable<typeof input>) => {
        calls.push('insert');
        input = data;
        if (options.fail === 'write') throw failure;
        return { count: options.inserted ?? totals.length };
      },
      updateMany: async () => { throw new Error('Rerunning the seed must not overwrite summaries.'); },
      deleteMany: async () => { throw new Error('Rerunning the seed must not delete summaries.'); },
    },
  };
  return { tx: tx as unknown as SeedSummaryTransaction, calls, failure, input: () => input };
}

test('summary seeding preserves exact database totals, zero rows and their initial versions', async () => {
  const h = writer();
  assert.equal(await insertSeedSymbolSummaries(h.tx), 2);
  assert.deepEqual(h.calls, ['read', 'insert']);
  assert.deepEqual(h.input(), { data: totals, skipDuplicates: true });
  assert.equal(h.input()?.data[0].buyValue?.toString(), '999999999899999.0000000001');
});

test('summary seed reruns preserve existing rows and report the actual inserted count', async () => {
  const h = writer({ inserted: 0 });
  assert.equal(await insertSeedSymbolSummaries(h.tx), 0);
  assert.equal(h.input()?.skipDuplicates, true);
  assert.deepEqual(h.calls, ['read', 'insert']);
});

test('an empty instrument catalogue requires no summary insert', async () => {
  const h = writer({ empty: true });
  assert.equal(await insertSeedSymbolSummaries(h.tx), 0);
  assert.deepEqual(h.calls, ['read']);
});

for (const fail of ['read', 'write'] as const) {
  test(`summary ${fail} failures propagate to the owning seed transaction`, async () => {
    const h = writer({ fail });
    await assert.rejects(insertSeedSymbolSummaries(h.tx), (error) => error === h.failure);
    assert.deepEqual(h.calls, fail === 'read' ? ['read'] : ['read', 'insert']);
  });
}
