import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app';
import { streamReadySchema, tradeChangeSchema, type TradeChange } from '../src/trades/sse/trade-stream-contract';
import { createTradeBroadcaster } from '../src/trades/sse/trade-broadcaster';
import { createAuthFixture, origin, user } from './auth-fixtures';

const startTime = Date.parse('2026-11-13T09:00:00Z');
const token = 'a'.repeat(43);
const tokenHash = createHash('sha256').update(token).digest('hex');

async function setup(role: 'TRADER' | 'READ_ONLY' = 'TRADER') {
  const auth = createAuthFixture();
  const broadcaster = createTradeBroadcaster();
  auth.users.get('jsmith@example.com')!.role = role;
  let time = startTime + 60_000;

  await auth.repository.createSession({
    userId: user.id, tokenHash,
    lastSeenAt: new Date(startTime),
    expiresAt: new Date(startTime + 8 * 60 * 60 * 1000),
  });

  const app = createApp({
    auth: auth.repository,
    trades: {
      listSummaries: async () => { throw new Error('Unexpected summary lookup in this test.'); },
      listHistory: async () => { throw new Error('Unexpected history lookup in this test.'); },
      listFilterOptions: async () => { throw new Error('Unexpected filter-options lookup in this test.'); },
      cancel: async () => { throw new Error('Unexpected trade cancellation in this test.'); },
      amend: async () => { throw new Error('Unexpected trade amendment in this test.'); },
      list: async () => { throw new Error('Opening SSE must not load trades.'); },
      create: async () => { throw new Error('Opening SSE must not create trades.'); },
    },
  }, { origin, secureCookies: false, now: () => new Date(time) }, { broadcaster });

  return {
    auth, app, broadcaster,
    setTime: (next: number) => { time = next; },
    request: (authenticated = true, signal?: AbortSignal) => app.request('/api/events', {
      headers: authenticated ? { Cookie: 'blotter_session=' + token } : {},
      signal,
    }),
  };
}

test('SSE rejects an unauthenticated request before starting a stream', async () => {
  const h = await setup();
  const response = await h.request(false);

  assert.equal(response.status, 401);
  assert.equal((await response.json() as { code: string }).code, 'UNAUTHENTICATED');
});

for (const role of ['TRADER', 'READ_ONLY'] as const) {
  test(`SSE accepts ${role}, sends ready, and remains open until cancelled`, async () => {
    const h = await setup(role);
    const response = await h.request();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type') ?? '', /text\/event-stream/);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Accel-Buffering'), 'no');

    const reader = response.body!.getReader();
    try {
      const frame = new TextDecoder().decode((await reader.read()).value);
      assert.match(frame, /event: stream.ready/);
      assert.match(frame, /retry: 1000/);
      assert.ok(frame.endsWith('\n\n'));
      const data = frame.split('\n').find((line) => line.startsWith('data: '))!.slice(6);
      const ready = streamReadySchema.parse(JSON.parse(data));
      assert.equal(ready.serverTime, '2026-11-13T09:01:00.000Z');

      let ended = false;
      const pending = reader.read().then((result) => { ended = true; return result; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(ended, false);
      await reader.cancel();
      assert.equal((await pending).done, true);
    } finally {
      await reader.cancel();
    }
  });
}

test('opening and reconnecting SSE do not extend session idle time', async () => {
  const h = await setup();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await h.request();
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    assert.equal(h.auth.sessions.get(tokenHash)?.lastSeenAt.getTime(), startTime);
  }
});

for (const reason of ['idle', 'hard-expired', 'revoked'] as const) {
  test(`SSE rejects ${reason} sessions at connection time`, async () => {
    const h = await setup();
    if (reason === 'revoked') {
      h.auth.sessions.clear();
    } else {
      const time = startTime + (reason === 'idle' ? 5 * 60_000 : 8 * 60 * 60_000);
      h.setTime(time);
      if (reason === 'hard-expired') {
        // Keep idle time valid so this case specifically exercises the hard expiry.
        h.auth.sessions.get(tokenHash)!.lastSeenAt = new Date(time - 60_000);
      }
    }

    const response = await h.request();
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { code: string }).code, 'UNAUTHENTICATED');
  });
}

// Let stream writes and timer continuations settle without waiting for real seconds.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

async function readNext(reader: ReadableStreamDefaultReader<Uint8Array>) {
  return Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => {
      setImmediate(() => reject(new Error('Expected a stream frame or closure.')));
    }),
  ]);
}

test('SSE sends comment heartbeats every 15 seconds without extending idle time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await setup();
  const findSession = t.mock.method(h.auth.repository, 'findSession');
  const reader = (await h.request()).body!.getReader();

  try {
    await reader.read(); // stream.ready
    await settle();
    t.mock.timers.tick(14_999);
    await settle();
    assert.equal(findSession.mock.callCount(), 1); // Connection check only.

    for (const elapsed of [15_000, 30_000]) {
      h.setTime(startTime + 60_000 + elapsed);
      t.mock.timers.tick(elapsed === 15_000 ? 1 : 15_000);
      const frame = await readNext(reader);
      assert.equal(new TextDecoder().decode(frame.value), ': heartbeat\n\n');
      await settle();
    }

    assert.equal(findSession.mock.callCount(), 3);
    assert.equal(h.auth.sessions.get(tokenHash)?.lastSeenAt.getTime(), startTime);
  } finally {
    await reader.cancel();
  }
});

for (const reason of ['idle', 'hard-expired', 'revoked'] as const) {
  test(`SSE closes an open stream when the session becomes ${reason}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await setup();
    const reader = (await h.request()).body!.getReader();

    try {
      await reader.read();
      await settle();

      if (reason === 'revoked') {
        await h.auth.repository.deleteSession(tokenHash);
      } else {
        const time = startTime + (reason === 'idle' ? 5 * 60_000 : 8 * 60 * 60_000);
        h.setTime(time);
        if (reason === 'hard-expired') {
          h.auth.sessions.get(tokenHash)!.lastSeenAt = new Date(time - 60_000);
        }
      }

      t.mock.timers.tick(15_000);
      assert.equal((await readNext(reader)).done, true);
    } finally {
      await reader.cancel();
    }
  });
}

test('SSE uses current session activity from other authenticated requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await setup();
  const reader = (await h.request()).body!.getReader();

  try {
    await reader.read();
    await settle();
    h.setTime(startTime + 5 * 60_000);
    await h.auth.repository.touchSession(tokenHash, new Date(startTime + 4 * 60_000));

    t.mock.timers.tick(15_000);
    assert.equal(new TextDecoder().decode((await readNext(reader)).value), ': heartbeat\n\n');
  } finally {
    await reader.cancel();
  }
});

for (const disconnect of ['reader cancellation', 'request abort'] as const) {
  test(`SSE stops session checks after ${disconnect}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await setup();
    const findSession = t.mock.method(h.auth.repository, 'findSession');
    const controller = new AbortController();
    const reader = (await h.request(true, controller.signal)).body!.getReader();

    try {
      await reader.read();
      await settle();
      t.mock.timers.tick(15_000);
      await readNext(reader); // Confirm ongoing checks started before disconnecting.
      await settle();
      const checks = findSession.mock.callCount();

      if (disconnect === 'reader cancellation') {
        await reader.cancel();
      } else {
        controller.abort();
        assert.equal((await readNext(reader)).done, true);
      }

      t.mock.timers.tick(60_000);
      await settle();
      assert.equal(findSession.mock.callCount(), checks);
    } finally {
      await reader.cancel();
    }
  });
}

test('SSE closes safely if an ongoing session lookup fails', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await setup();
  const reader = (await h.request()).body!.getReader();

  try {
    await reader.read();
    await settle();
    const findSession = t.mock.method(h.auth.repository, 'findSession', async () => {
      throw new Error('Private database details');
    });
    t.mock.method(console, 'error', () => {});

    t.mock.timers.tick(15_000);
    assert.equal((await readNext(reader)).done, true);
    t.mock.timers.tick(60_000);
    await settle();
    assert.equal(findSession.mock.callCount(), 1);
  } finally {
    await reader.cancel();
  }
});

const change: TradeChange = {
  schemaVersion: 1,
  changeId: 'd197282d-99ca-4260-833a-702f97d1cba2',
  type: 'TRADE_CREATED',
  occurredAt: '2026-11-13T09:01:00.000Z',
  trade: {
    id: 'f1550000-0000-4000-8000-000000100003',
    symbol: 'AAPL', side: 'BUY', quantity: '5000.000000', price: '227.4500',
    trader: user.displayName, ownerId: user.id,
    book: null, counterparty: null, status: 'ACTIVE', version: 1,
    tradeDate: '2026-11-13T09:00:00.000Z',
    createdAt: '2026-11-13T09:01:00.000Z', updatedAt: '2026-11-13T09:01:00.000Z',
  },
};

for (const role of ['TRADER', 'READ_ONLY'] as const) {
  test(`SSE immediately sends creation, amendment and cancellation events to their owner and a different ${role}`, async () => {
    const h = await setup();
    const other = { ...user, id: 'd197282d-99ca-4260-833a-702f97d1cba4', displayName: 'ADOE', role };
    const otherToken = 'b'.repeat(43);
    h.auth.users.set('adoe@example.com', other);
    await h.auth.repository.createSession({
      userId: other.id, tokenHash: createHash('sha256').update(otherToken).digest('hex'),
      lastSeenAt: new Date(startTime), expiresAt: new Date(startTime + 8 * 60 * 60_000),
    });
    const first = (await h.request()).body!.getReader();
    const secondResponse = await h.app.request('/api/events', {
      headers: { Cookie: `blotter_session=${otherToken}` },
    });
    const second = secondResponse.body!.getReader();

    try {
      // Events arriving during the handshake must stay buffered behind stream.ready.
      const amendment = { ...change, type: 'TRADE_AMENDED' as const,
        changeId: 'd197282d-99ca-4260-833a-702f97d1cba5',
        trade: { ...change.trade, price: '228.5000', version: 2 } };
      const cancellation = { ...amendment, type: 'TRADE_CANCELLED' as const,
        changeId: 'd197282d-99ca-4260-833a-702f97d1cba6',
        trade: { ...amendment.trade, status: 'CANCELLED' as const, version: 3 } };
      h.broadcaster.broadcast(change);
      h.broadcaster.broadcast(amendment);
      h.broadcaster.broadcast(cancellation);
      for (const reader of [first, second]) {
        assert.match(new TextDecoder().decode((await reader.read()).value), /event: stream.ready/);
        for (const expected of [change, amendment, cancellation]) {
          const frame = new TextDecoder().decode((await readNext(reader)).value);
          assert.match(frame, /event: trade.changed/);
          assert.match(frame, new RegExp(`id: ${expected.changeId}`));
          const data = frame.split('\n').find((line) => line.startsWith('data: '))!.slice(6);
          assert.deepEqual(tradeChangeSchema.parse(JSON.parse(data)), expected);
        }
      }
      assert.equal(h.auth.sessions.get(tokenHash)?.lastSeenAt.getTime(), startTime);
    } finally {
      await first.cancel();
      await second.cancel();
    }
  });
}

test('SSE cancels its broadcaster subscription when the client disconnects', async (t) => {
  const h = await setup();
  let cancelled = 0;
  t.mock.method(h.broadcaster, 'subscribe', () => new ReadableStream<TradeChange>({
    cancel: () => { cancelled += 1; },
  }));
  const reader = (await h.request()).body!.getReader();
  try {
    await reader.read();
  } finally {
    await reader.cancel();
  }
  await settle();
  assert.equal(cancelled, 1);
});

test('a revoked session cannot receive a trade before its next heartbeat', async () => {
  const h = await setup();
  const reader = (await h.request()).body!.getReader();
  try {
    await reader.read();
    h.auth.sessions.clear();
    h.broadcaster.broadcast(change);
    assert.equal((await readNext(reader)).done, true);
  } finally {
    await reader.cancel();
  }
});

test('a session lookup failure during trade delivery closes the stream safely', async (t) => {
  const h = await setup();
  const reader = (await h.request()).body!.getReader();
  try {
    await reader.read();
    t.mock.method(h.auth.repository, 'findSession', async () => { throw new Error('Private database details'); });
    t.mock.method(console, 'error', () => {});
    h.broadcaster.broadcast(change);
    assert.equal((await readNext(reader)).done, true);
  } finally {
    await reader.cancel();
  }
});

test('broadcaster overflow closes SSE even when a trade write is blocked', async () => {
  const h = await setup();
  const reader = (await h.request()).body!.getReader();
  try {
    await reader.read();
    await settle();
    h.broadcaster.broadcast(change);
    await settle();
    h.broadcaster.broadcast(change);
    await settle();
    for (let index = 0; index < 101; index += 1) h.broadcaster.broadcast(change);
    await settle();

    await readNext(reader); // A frame already buffered in the HTTP response can remain.
    assert.equal((await readNext(reader)).done, true);
  } finally {
    await reader.cancel();
  }
});
