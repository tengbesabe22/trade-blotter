import { randomUUID } from 'node:crypto';
import timers from 'node:timers/promises';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import type { AuthEnv, AuthOptions } from '../../auth/auth-contract';
import type { AuthRepository } from '../../auth/auth-repository';
import { requireSession } from '../../auth/auth-middleware';
import { SESSION_COOKIE_NAME } from '../../auth/session-config';
import { hashSessionToken, isSessionActive } from '../../auth/session-utils';
import type { StreamReady } from './trade-stream-contract';
import type { TradeBroadcaster } from './trade-broadcaster';

const HEARTBEAT_INTERVAL_MS = 15_000;

export function createTradeStreamRoutes(
  repository: AuthRepository,
  options: AuthOptions,
  broadcaster: TradeBroadcaster,
) {
  const routes = new Hono<AuthEnv>();

  routes.get('/', requireSession(repository, options, { recordActivity: false }), (c) => {
    c.header('X-Accel-Buffering', 'no');

    // Hash the cookie once; requireSession has already validated it.
    const tokenHash = hashSessionToken(getCookie(c, SESSION_COOKIE_NAME)!);

    const response = streamSSE(c, async (stream) => {
      // Cancelling the stream also cancels its pending heartbeat timer.
      const lifetime = new AbortController();
      // Register before ready so events arriving during the handshake are buffered.
      const subscription = broadcaster.subscribe().getReader();
      // Overflow must interrupt even a write blocked behind a slow browser.
      void subscription.closed.catch(() => stream.abort());
      stream.onAbort(() => {
        lifetime.abort();
        void subscription.cancel().catch(() => {});
      });
      const abort = () => stream.abort();
      const signal = c.req.raw.signal;
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) stream.abort();

      try {
        if (stream.aborted) return;

        const ready: StreamReady = {
          schemaVersion: 1,
          connectionId: randomUUID(),
          serverTime: (options.now?.() ?? new Date()).toISOString(),
        };
        await stream.writeSSE({
          event: 'stream.ready',
          data: JSON.stringify(ready),
          retry: 1000,
        });

        // Re-read the session to detect logout/expiry after the connection opened.
        // Validation does not record activity, so passive updates cannot renew idle time.
        async function sessionStillActive() {
          const session = await repository.findSession(tokenHash);
          return !stream.aborted && isSessionActive(session, options.now?.() ?? new Date());
        }

        // Consume this connection's event buffer as trades arrive, without a timer.
        async function sendTrades() {
          while (!stream.aborted) {
            // Wait without polling. `done` means the subscription has ended.
            const { done, value: change } = await subscription.read();
            if (done || !await sessionStillActive()) return;

            await stream.writeSSE({
              event: 'trade.changed',
              id: change.changeId,
              data: JSON.stringify(change),
            });
          }
        }

        // Independently keep quiet connections alive and check their session.
        async function sendHeartbeats() {
          while (!stream.aborted) {
            // The abort signal cancels this wait when the connection closes.
            await timers.setTimeout(HEARTBEAT_INTERVAL_MS, undefined, { signal: lifetime.signal });
            if (!await sessionStillActive()) return;

            // Comments keep traffic flowing without renewing idle time.
            await stream.write(': heartbeat\n\n');
          }
        }

        // Both loops run concurrently and keep looping after each message.
        // race() waits for a whole loop to end/fail, not the first trade or heartbeat.
        // finally then stops the other loop and releases this connection.
        await Promise.race([sendTrades(), sendHeartbeats()]);
      } catch (error) {
        // Normal disconnection aborts the timer. Other failures reach Hono's logger
        // and close the stream without sending internal error details to the client.
        if (!lifetime.signal.aborted) throw error;
      } finally {
        // Stop both loops whether the client disconnected, a session expired or a task failed.
        stream.abort();
        lifetime.abort();
        await subscription.cancel().catch(() => {});
        signal.removeEventListener('abort', abort);
      }
    });

    response.headers.set('Cache-Control', 'no-store');
    return response;
  });

  return routes;
}
