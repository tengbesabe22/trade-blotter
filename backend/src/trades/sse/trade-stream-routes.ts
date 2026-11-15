import { randomUUID } from 'node:crypto';
import timers from 'node:timers/promises';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import type { Logger } from 'pino';
import { createLogger } from '../../logging/logger';
import { errorMetadata } from '../../logging/error-metadata';
import type { RequestLogEnv } from '../../logging/request-logger';
import type { AuthEnv, AuthOptions } from '../../auth/auth-contract';
import type { AuthRepository } from '../../auth/auth-repository';
import { requireSession } from '../../auth/auth-middleware';
import { SESSION_COOKIE_NAME } from '../../auth/session-config';
import { hashSessionToken, isSessionActive } from '../../auth/session-utils';
import type { StreamReady, TradeChange } from './trade-stream-contract';
import { SlowSseClientError, type TradeBroadcaster } from './trade-broadcaster';

const HEARTBEAT_INTERVAL_MS = 15_000;
type CloseReason = 'client_disconnected' | 'session_inactive' | 'stream_error'
  | 'slow_client' | 'subscription_closed';

export function createTradeStreamRoutes(
  repository: AuthRepository,
  options: AuthOptions,
  broadcaster: TradeBroadcaster,
  logger: Logger = createLogger('silent'),
) {
  const routes = new Hono<AuthEnv & RequestLogEnv>();

  routes.get('/', requireSession(repository, options, { recordActivity: false }), (c) => {
    c.header('X-Accel-Buffering', 'no');

    // Hash the cookie once; requireSession has already validated it.
    const tokenHash = hashSessionToken(getCookie(c, SESSION_COOKIE_NAME)!);
    const connectionId = randomUUID();
    const startedAt = performance.now();
    const connectionLogger = logger.child({
      connectionId,
      // The request middleware generated this ID; no client value is reused.
      requestId: c.get('requestId'),
    });

    const response = streamSSE(c, async (stream) => {
      // Cancelling the stream also cancels its pending heartbeat timer.
      const lifetime = new AbortController();
      let subscription: ReadableStreamDefaultReader<TradeChange> | undefined;
      let closeReason: CloseReason = 'client_disconnected';

      function handleFailure(error: unknown) {
        // Abort sets this flag synchronously: concurrent loop failures are logged once.
        // It also excludes timer cancellation caused by normal cleanup.
        if (stream.aborted) return;

        if (error instanceof SlowSseClientError) {
          closeReason = 'slow_client'; // The broadcaster already logged the warning.
        } else {
          closeReason = 'stream_error';
          connectionLogger.error({ event: 'sse.failed', ...errorMetadata(error) });
        }
        stream.abort();
      }

      stream.onAbort(() => {
        lifetime.abort();
        void subscription?.cancel().catch(() => {});
      });
      const abort = () => stream.abort();
      const signal = c.req.raw.signal;
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) stream.abort();

      try {
        if (stream.aborted) return;

        // Register before ready so events arriving during the handshake are buffered.
        const reader = broadcaster.subscribe(connectionId).getReader();
        subscription = reader;
        // Overflow must interrupt even a write blocked behind a slow browser.
        void reader.closed.catch(handleFailure);

        const ready: StreamReady = {
          schemaVersion: 1, connectionId,
          serverTime: (options.now?.() ?? new Date()).toISOString(),
        };
        await stream.writeSSE({
          event: 'stream.ready',
          data: JSON.stringify(ready),
          retry: 1000,
        });
        if (stream.aborted) return;

        // Connection opened successfully
        connectionLogger.info({ event: 'sse.opened' });

        // Re-read the session to detect logout/expiry after the connection opened.
        // Validation does not record activity, so passive updates cannot renew idle time.
        async function sessionStillActive() {
          const session = await repository.findSession(tokenHash);
          if (stream.aborted) return false;
          if (!isSessionActive(session, options.now?.() ?? new Date())) {
            closeReason = 'session_inactive'; // We cannot distinguish logout from expiry here.
            return false;
          }
          return true;
        }

        // Consume this connection's event buffer as trades arrive, without a timer.
        async function sendTrades() {
          while (!stream.aborted) {
            const { done, value: change } = await reader.read();
            if (stream.aborted) return;
            if (done) {
              closeReason = 'subscription_closed';
              return;
            }
            if (!await sessionStillActive()) return;

            await stream.writeSSE({
              event: 'trade.changed',
              id: change.changeId,
              data: JSON.stringify(change),
            });
            // The write helper returned; this is not browser acknowledgement.
            if (!stream.aborted) connectionLogger.debug({ event: 'sse.sent', changeId: change.changeId });
          }
        }

        // Independently keep quiet connections alive and check their session.
        async function sendHeartbeats() {
          while (!stream.aborted) {
            await timers.setTimeout(HEARTBEAT_INTERVAL_MS, undefined, { signal: lifetime.signal });
            if (!await sessionStillActive()) return;

            // Comments keep traffic flowing without renewing idle time or producing logs.
            await stream.write(': heartbeat\n\n');
          }
        }

        // Wait for a whole loop to end/fail, not the first trade or heartbeat.
        // finally stops the other loop and releases this connection.
        await Promise.race([sendTrades(), sendHeartbeats()]);
      } catch (error) {
        // Handle failures here: Hono's SSE error callback can echo the raw message.
        // Close without forwarding an internal error frame or printing a raw exception.
        handleFailure(error);
      } finally {
        stream.abort();
        lifetime.abort();
        await subscription?.cancel().catch(() => {});
        signal.removeEventListener('abort', abort);
        // One cleanup path produces one closure record, including failed handshakes.
        connectionLogger.info({
          event: 'sse.closed', closeReason,
          connectionDurationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
        });
      }
    });

    response.headers.set('Cache-Control', 'no-store');
    return response;
  });

  return routes;
}
