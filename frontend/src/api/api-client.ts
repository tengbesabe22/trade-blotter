import { z } from 'zod';
import { apiUrl } from './api-url';

const apiErrorSchema = z.object({ code: z.string(), message: z.string() });

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  // Keep structured error details untrusted until a feature schema validates them.
  readonly responseBody: unknown;

  constructor(status: number, code: string, message: string, responseBody?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.responseBody = responseBody;
  }
}

export async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(apiUrl(path), {
    ...options,
    // Include the API's HttpOnly cookie when the frontend and API have different origins.
    credentials: 'include',
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = apiErrorSchema.safeParse(body);

    throw new ApiError(
      response.status,
      error.success ? error.data.code : 'REQUEST_FAILED',
      error.success ? error.data.message : 'The request failed. Please try again.',
      body,
    );
  }

  return response;
}
