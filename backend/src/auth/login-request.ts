import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

type LoginCredentials = { email: string; password: string };
export type LoginEnv = { Variables: { credentials: LoginCredentials } };

export function requireTrustedOrigin(origin: string): MiddlewareHandler {
  return async (c, next) => {
    // Cookies travel automatically: reject requests from other sites to prevent cross-site login/logout requests.
    if (c.req.header('Origin') !== origin) {
      return c.json({ code: 'FORBIDDEN_ORIGIN', message: 'Request origin is not allowed.' }, 403);
    }

    await next();
  };
}

export const requireJsonLoginRequest: MiddlewareHandler<LoginEnv> = async (c, next) => {
  const contentType = c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase();

  if (contentType !== 'application/json') {
    return c.json({ code: 'INVALID_INPUT', message: 'Send email and password as JSON.' }, 400);
  }

  await next();
};

// Limit the body before parsing JSON or doing an expensive password check.
export const loginBodyLimit = bodyLimit({
  maxSize: 4096, // 4 KiB.
  onError: (c) =>
    c.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Login request is too large.' }, 413),
});

export const validateLoginCredentials: MiddlewareHandler<LoginEnv> = async (c, next) => {
  const body: unknown = await c.req.json().catch(() => null);

  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !('email' in body) ||
    typeof body.email !== 'string' ||
    !('password' in body) ||
    typeof body.password !== 'string'
  ) {
    return c.json({ code: 'INVALID_INPUT', message: 'Provide a valid email and password.' }, 400);
  }

  const email = body.email.trim().toLowerCase();
  const password = body.password; // Password whitespace is significant; never trim it.

  const validEmail = email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const validPassword = password.length > 0 && Buffer.byteLength(password, 'utf8') <= 1024;

  if (!validEmail || !validPassword) {
    return c.json({ code: 'INVALID_INPUT', message: 'Provide a valid email and password.' }, 400);
  }

  // The handler receives validated, normalized credentials through Hono's context.
  c.set('credentials', { email, password });

  await next();
};
