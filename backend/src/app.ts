import { Hono } from 'hono';
import { createLoginRoutes, type LoginOptions } from './auth/login.js';
import type { LoginStore } from './auth/login-store.js';

// Separate app construction from the listening server so requests are testable.
export function createApp(store: LoginStore, options: LoginOptions) {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.route('/api/auth', createLoginRoutes(store, options));

  app.onError((error, c) => {
    console.error('Request failed:', error.name);

    return c.json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' }, 500);
  });

  return app;
}
