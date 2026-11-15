import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import type { Logger } from 'pino';

const methods = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']);
const databaseErrors = new Set([
  'PrismaClientKnownRequestError', 'PrismaClientUnknownRequestError',
  'PrismaClientInitializationError', 'PrismaClientValidationError',
  'PrismaClientRustPanicError',
]);

function errorMetadata(error: Error | undefined) {
  if (!error) return {};
  // Never serialize an error or its message/stack: either can contain request/SQL data.
  if (databaseErrors.has(error.name)) {
    const code = 'code' in error && typeof error.code === 'string' && /^P\d{4}$/.test(error.code)
      ? error.code : undefined;
    return { errorCategory: 'database_error', ...(code ? { errorCode: code } : {}) };
  }
  return { errorCategory: error.name === 'ZodError' ? 'validation_error' : 'unexpected_error' };
}

export function createRequestLogger(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const requestId = randomUUID();
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
