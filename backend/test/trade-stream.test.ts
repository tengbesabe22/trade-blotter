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
    request: (authenticated = true) => app.request('/api/events', {
      headers: authenticated ? { Cookie: 'blotter_session=' + token } : {},
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
