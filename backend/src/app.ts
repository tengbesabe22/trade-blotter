import { Hono } from 'hono';
import { createLoginRoutes } from './auth/login';
import type { AuthStore } from './auth/auth-store';
import { createSessionRoutes } from './auth/session-routes';
import type { AuthOptions } from './auth/session';

// Separate app construction from the listening server so requests are testable.
export function createApp(store: AuthStore, options: AuthOptions) {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.use('/api/auth/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');

    await next();
  });

  app.route('/api/auth', createLoginRoutes(store, options));
  app.route('/api/auth', createSessionRoutes(store, options));

  app.onError((error, c) => {
    console.error('Request failed:', error.name);

    return c.json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }, 500);
  });

  return app;
}
