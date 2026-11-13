import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app';
import { streamReadySchema } from '../src/trades/sse/trade-stream-contract';
import { createAuthFixture, origin, user } from './auth-fixtures';

const startTime = Date.parse('2026-11-13T09:00:00Z');
const token = 'a'.repeat(43);
const tokenHash = createHash('sha256').update(token).digest('hex');

async function setup(role: 'TRADER' | 'READ_ONLY' = 'TRADER') {
  const auth = createAuthFixture();
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
      list: async () => { throw new Error('Opening SSE must not load trades.'); },
      create: async () => { throw new Error('Opening SSE must not create trades.'); },
    },
  }, { origin, secureCookies: false, now: () => new Date(time) });

  return {
    auth,
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
