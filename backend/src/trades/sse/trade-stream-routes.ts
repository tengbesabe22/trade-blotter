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

const HEARTBEAT_INTERVAL_MS = 15_000;

export function createTradeStreamRoutes(repository: AuthRepository, options: AuthOptions) {
  const routes = new Hono<AuthEnv>();

  routes.get('/', requireSession(repository, options, { recordActivity: false }), (c) => {
    c.header('X-Accel-Buffering', 'no');

    // Hash the cookie once; requireSession has already validated it.
    const tokenHash = hashSessionToken(getCookie(c, SESSION_COOKIE_NAME)!);

    const response = streamSSE(c, async (stream) => {
      // Cancelling the stream also cancels its pending heartbeat timer.
      const lifetime = new AbortController();
      stream.onAbort(() => lifetime.abort());
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

        // Sequential checks avoid overlapping database requests and heartbeat writes.
        while (!stream.aborted) {
          await timers.setTimeout(HEARTBEAT_INTERVAL_MS, undefined, { signal: lifetime.signal });

          const session = await repository.findSession(tokenHash);
          const now = options.now?.() ?? new Date();
          if (stream.aborted || !isSessionActive(session, now)) break;

          // SSE comments keep the connection active without becoming browser events.
          // Heartbeats validate the session; they never renew its idle timeout.
          await stream.write(': heartbeat\n\n');
        }
      } catch (error) {
        // Normal disconnection aborts the timer. Other failures reach Hono's logger
        // and close the stream without sending internal error details to the client.
        if (!lifetime.signal.aborted) throw error;
      } finally {
        lifetime.abort();
        signal.removeEventListener('abort', abort);
      }
    });

    response.headers.set('Cache-Control', 'no-store');
    return response;
  });

  return routes;
}
