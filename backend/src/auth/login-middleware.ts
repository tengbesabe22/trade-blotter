import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { loginRequestSchema, type LoginEnv } from './login-contract';

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
  const validation = loginRequestSchema.safeParse(body);

  if (!validation.success) {
    return c.json({ code: 'INVALID_INPUT', message: 'Provide a valid email and password.' }, 400);
  }

  c.set('credentials', validation.data);

  await next();
};
