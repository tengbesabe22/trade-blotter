import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AuthEnv, AuthOptions } from '../../auth/auth-contract';
import type { AuthRepository } from '../../auth/auth-repository';
import { requireSession } from '../../auth/auth-middleware';
import type { StreamReady } from './trade-stream-contract';

export function createTradeStreamRoutes(repository: AuthRepository, options: AuthOptions) {
  const routes = new Hono<AuthEnv>();

  routes.get('/', requireSession(repository, options, { recordActivity: false }), (c) => {
    c.header('X-Accel-Buffering', 'no');

    const response = streamSSE(c, async (stream) => {
      // Hono closes the stream when this callback finishes, so wait for disconnection.
      const disconnected = new Promise<void>((resolve) => { stream.onAbort(resolve); });
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
        await disconnected;
      } finally {
        signal.removeEventListener('abort', abort);
      }
    });

    response.headers.set('Cache-Control', 'no-store');
    return response;
  });

  return routes;
}
