import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import type { Logger } from 'pino';
import { errorMetadata } from './error-metadata';

export type RequestLogEnv = { Variables: { requestId: string } };

const methods = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']);

export function createRequestLogger(logger: Logger): MiddlewareHandler<RequestLogEnv> {
  return async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    const startedAt = performance.now();
    c.header('X-Request-ID', requestId);

    await next();

    // Use the registered endpoint, even if auth rejected it before its handler ran.
    // Unknown URLs and query/resource values must not enter logs.
    const matched = routePath(c, -1);
    const route = matched && !matched.includes('*') ? matched : 'unmatched';
    const status = c.res.status;
    if (route === '/api/health' && status === 200) return;

    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    logger[level]({
      event: 'http.response', requestId,
      method: methods.has(c.req.method) ? c.req.method : 'OTHER',
      route, status,
      // For SSE this is response setup time, not the connection lifetime.
      durationMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      ...errorMetadata(c.error),
    });
  };
}
