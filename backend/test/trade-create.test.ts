import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app';
import type { CurrentUser } from '../src/auth/auth-contract';
import type {
  CreateTradeCommand,
  NormalizedCreateTradeRequest,
  CreateTradeRequest,
  CreateTradeResponse,
  CreateTradeResult,
} from '../src/trades/creation/trade-create-contract';
import type { TradeRepository } from '../src/trades/trade-repository';
import { createAuthFixture, origin, user } from './auth-fixtures';

const requestBody: CreateTradeRequest = {
  symbol: 'AAPL',
  side: 'BUY',
  quantity: '5000',
  price: '227.45',
  tradeDate: '2026-08-18T09:15:23Z',
};

const normalizedInput: NormalizedCreateTradeRequest = {
  symbol: 'AAPL',
  side: 'BUY',
  quantity: '5000.000000',
  price: '227.4500',
  tradeDate: '2026-08-18T09:15:23.000Z',
  book: null,
  counterparty: null,
};

const createdBody: CreateTradeResponse = {
  trade: {
    id: 'f1550000-0000-4000-8000-000000100003',
    ...normalizedInput,
    trader: user.displayName,
    ownerId: user.id,
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-11-12T09:00:00.000Z',
    updatedAt: '2026-11-12T09:00:00.000Z',
  },
};

function fingerprint(input: NormalizedCreateTradeRequest): string {
  return createHash('sha256')
    .update(JSON.stringify({ method: 'POST', path: '/api/trades', input }))
    .digest('hex');
}

type SetupOptions = {
  role?: CurrentUser['role'];
  create?: (command: CreateTradeCommand) => Promise<CreateTradeResult>;
  onTradeChanged?: () => void;
};

async function setup(options: SetupOptions = {}) {
  const auth = createAuthFixture();
  auth.users.get('jsmith@example.com')!.role = options.role ?? 'TRADER';
  const now = new Date('2026-11-12T09:00:00Z');
  const token = 'a'.repeat(43);
  const commands: CreateTradeCommand[] = [];
  const notifications: string[] = [];

  await auth.repository.createSession({
    userId: user.id,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000),
  });

  // The fake supplies persistence outcomes; HTTP validation and mapping remain real.
  const trades: TradeRepository = {
    amend: async () => {
      throw new Error('Unexpected trade amendment in this test.');
    },

    list: async () => {
      throw new Error('Creation must not load the current trade list.');
    },

    create: async (command: CreateTradeCommand) => {
      commands.push(command);

      return options.create
        ? options.create(command)
        : { kind: 'created', body: createdBody };
    },
  };

  const app = createApp(
    { auth: auth.repository, trades },
    { origin, secureCookies: false, now: () => now },
    { onTradeChanged: () => {
      notifications.push('created');
      return options.onTradeChanged?.();
    } },
  );

  function request(body: unknown = requestBody, overrides: Record<string, string | null> = {}) {
    const headers = new Headers({
      Cookie: `blotter_session=${token}`,
      Origin: origin,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'create-trade-001',
    });

    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) headers.delete(key);
      else headers.set(key, value);
    }

    return app.request('/api/trades', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  return { request, commands, notifications };
}

async function expectError(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  const body = await response.json() as { code: string; message: string };
  assert.equal(body.code, code);
  assert.equal(typeof body.message, 'string');
}

test('create requires a session and does not call persistence when unauthenticated', async () => {
  const h = await setup();

  await expectError(await h.request(requestBody, { Cookie: null }), 401, 'UNAUTHENTICATED');
  assert.equal(h.commands.length, 0);
});

test('reviewers cannot create trades', async () => {
  const h = await setup({ role: 'READ_ONLY' });

  await expectError(await h.request(), 403, 'FORBIDDEN');
  assert.equal(h.commands.length, 0);
});

test('create rejects missing and untrusted origins before persistence', async () => {
  const h = await setup();

  for (const value of [null, 'null', 'https://other.example']) {
    await expectError(await h.request(requestBody, { Origin: value }), 403, 'FORBIDDEN_ORIGIN');
  }

  assert.equal(h.commands.length, 0);
});

test('create rejects an untrusted origin before processing an oversized body', async () => {
  const h = await setup();

  await expectError(
    await h.request(' '.repeat(4097), { Origin: 'https://other.example' }),
    403,
    'FORBIDDEN_ORIGIN',
  );
  assert.equal(h.commands.length, 0);
});

test('create returns the public 201 body and passes normalized, session-owned input', async () => {
  const h = await setup();

  const response = await h.request({
    ...requestBody,
    symbol: ' aapl ',
    tradeDate: '2026-08-18T17:15:23+08:00',
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), createdBody);
  assert.deepEqual(h.commands, [{
    userId: user.id,
    idempotencyKey: 'create-trade-001',
    requestFingerprint: fingerprint(normalizedInput),
    input: normalizedInput,
  }]);
});

test('equivalent decimal, timestamp, metadata, and property-order inputs have one fingerprint', async () => {
  const h = await setup();
  await h.request();
  await h.request({
    counterparty: '  ',
    book: null,
    tradeDate: '2026-08-18T17:15:23.000+08:00',
    price: '227.4500',
    quantity: '5000.000000',
    side: 'BUY',
    symbol: ' aapl ',
  });

  assert.equal(h.commands.length, 2);
  assert.deepEqual(h.commands[0], h.commands[1]);
});

test('create preserves fractional bounds, SELL, and trimmed optional metadata', async () => {
  const h = await setup();
  const response = await h.request({
    ...requestBody,
    side: 'SELL',
    quantity: '999999999.999999',
    price: '999999.9999',
    book: ' EQUITIES_UK ',
    counterparty: ' Example Bank ',
  });

  assert.equal(response.status, 201);
  const expectedInput: NormalizedCreateTradeRequest = {
    ...normalizedInput,
    side: 'SELL',
    quantity: '999999999.999999',
    price: '999999.9999',
    book: 'EQUITIES_UK',
    counterparty: 'Example Bank',
  };

  assert.deepEqual(h.commands[0].input, expectedInput);
  assert.equal(h.commands[0].requestFingerprint, fingerprint(expectedInput));
});

test('create accepts exact maximum and minimum positive decimal values', async () => {
  const h = await setup();

  for (const values of [
    { quantity: '1000000000', price: '1000000' },
    { quantity: '0.000001', price: '0.0001' },
  ]) {
    const response = await h.request({ ...requestBody, ...values }, {
      'Idempotency-Key': `boundary-${values.quantity}`,
    });

    assert.equal(response.status, 201);
  }

  assert.equal(h.commands.length, 2);
});

test('create rejects malformed, unknown, incorrectly typed, and out-of-range input', async () => {
  const invalidBodies: unknown[] = [
    null, [], '{broken', {},
    { ...requestBody, symbol: '' },
    { ...requestBody, symbol: 'A'.repeat(13) },
    { ...requestBody, side: 'buy' },
    { ...requestBody, quantity: 5000 },
    { ...requestBody, quantity: '0' },
    { ...requestBody, quantity: '-1' },
    { ...requestBody, quantity: '0.0000001' },
    { ...requestBody, quantity: '1000000000.000001' },
    { ...requestBody, price: 227.45 },
    { ...requestBody, price: '0' },
    { ...requestBody, price: '1.00001' },
    { ...requestBody, price: '1000000.0001' },
    ...['1e3', '1,000', '$10', ' 10 ', '01', 'NaN'].map((price) => ({ ...requestBody, price })),
    ...['invalid', '2026-02-30T09:00:00Z', '2026-08-18T09:00:00',
      '2026-08-18T09:00:00.0001Z'].map((tradeDate) => ({ ...requestBody, tradeDate })),
    { ...requestBody, book: 42 },
    { ...requestBody, book: 'A'.repeat(65) },
    { ...requestBody, counterparty: 'A'.repeat(121) },
    ...['userId', 'ownerId', 'trader', 'instrumentId', 'id', 'status', 'version',
      'createdAt', 'updatedAt', 'unexpected'].map((field) => ({ ...requestBody, [field]: 'spoofed' })),
  ];
  const h = await setup();

  for (const body of invalidBodies) {
    const response = await h.request(body);
    assert.equal(response.status, 400, `Accepted invalid body: ${JSON.stringify(body)}`);
    assert.equal((await response.json()).code, 'INVALID_INPUT');
  }

  assert.equal(h.commands.length, 0);
});

test('create requires a valid bounded idempotency key', async () => {
  const h = await setup();

  for (const key of [null, '', 'a'.repeat(121), 'invalid key']) {
    await expectError(await h.request(requestBody, { 'Idempotency-Key': key }), 400, 'INVALID_INPUT');
  }

  assert.equal(h.commands.length, 0);
});

test('create requires JSON but accepts its charset parameter', async () => {
  const h = await setup();

  for (const contentType of [null, 'text/plain']) {
    await expectError(
      await h.request(requestBody, { 'Content-Type': contentType }),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
    );
  }

  assert.equal(h.commands.length, 0);
  assert.equal((await h.request(requestBody, {
    'Content-Type': 'application/json; charset=utf-8',
  })).status, 201);
});

test('create rejects oversized bodies before persistence', async () => {
  const h = await setup();

  await expectError(await h.request(' '.repeat(4097)), 413, 'PAYLOAD_TOO_LARGE');
  assert.equal(h.commands.length, 0);
});

test('create replays the saved original response without loading current trades', async () => {
  const h = await setup({ create: async () => ({ kind: 'replayed', body: createdBody }) });

  const response = await h.request();

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), createdBody);
  assert.equal(h.commands.length, 1);
});

for (const outcome of [
  { kind: 'unknown-instrument', status: 400, code: 'UNKNOWN_INSTRUMENT' },
  { kind: 'idempotency-conflict', status: 409, code: 'IDEMPOTENCY_CONFLICT' },
] as const) {
  test(`create translates ${outcome.kind} into its public error`, async () => {
    const h = await setup({ create: async () => ({ kind: outcome.kind }) });

    await expectError(await h.request(), outcome.status, outcome.code);
    assert.equal(h.commands.length, 1);
  });
}

test('create hides unexpected persistence errors', async () => {
  const h = await setup({
    create: async () => {
      throw new Error('Private database connection details');
    },
  });

  const response = await h.request();

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  });
});

test('create wakes delivery only after persistence resolves and does not await delivery', async () => {
  let commit!: (result: CreateTradeResult) => void;
  const pendingCommit = new Promise<CreateTradeResult>((resolve) => { commit = resolve; });
  const h = await setup({
    create: () => pendingCommit,
    onTradeChanged: () => new Promise<void>(() => {}), // Delivery is still running.
  });

  const response = h.request();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(h.notifications, []);

  commit({ kind: 'created', body: createdBody });
  const completed = await Promise.race([
    response,
    new Promise<never>((_, reject) => {
      setImmediate(() => reject(new Error('The HTTP response must not wait for delivery.')));
    }),
  ]);
  assert.equal(completed.status, 201);
  assert.deepEqual(await completed.json(), createdBody);
  assert.deepEqual(h.notifications, ['created']);
});

test('idempotent replay and rejected create results do not wake delivery', async () => {
  const cases: [CreateTradeResult, number][] = [
    [{ kind: 'replayed', body: createdBody }, 201],
    [{ kind: 'unknown-instrument' }, 400],
    [{ kind: 'idempotency-conflict' }, 409],
  ];

  for (const [result, status] of cases) {
    const h = await setup({ create: async () => result });
    const response = await h.request();
    assert.equal(response.status, status);
    assert.deepEqual(h.notifications, []);
  }
});

test('a failed create transaction does not wake delivery', async (t) => {
  t.mock.method(console, 'error', () => {});
  const h = await setup({ create: async () => { throw new Error('Transaction rolled back'); } });
  assert.equal((await h.request()).status, 500);
  assert.deepEqual(h.notifications, []);
});
