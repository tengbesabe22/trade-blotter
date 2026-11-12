import { z } from 'zod';

const apiErrorSchema = z.object({ code: z.string(), message: z.string() });

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    ...options,
    // Vite proxies /api, so the browser handles HttpOnly cookies on the same origin.
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = apiErrorSchema.safeParse(body);

    throw new ApiError(
      response.status,
      error.success ? error.data.code : 'REQUEST_FAILED',
      error.success ? error.data.message : 'The request failed. Please try again.',
    );
  }

  return response;
}
