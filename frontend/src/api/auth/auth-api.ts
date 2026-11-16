import { ApiError, apiRequest } from '../api-client';
import { authResponseSchema, type AuthResponse, type LoginRequest } from '../contracts/auth/auth-contract';

async function readAuthResponse(response: Response): Promise<AuthResponse> {
  const body: unknown = await response.json().catch(() => null);
  const validation = authResponseSchema.safeParse(body);

  if (!validation.success) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned an unexpected response.',
    );
  }

  return validation.data;
}

export const authApi = {
  login: async (credentials: LoginRequest): Promise<AuthResponse> => {
    const response = await apiRequest('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });

    return readAuthResponse(response);
  },

  me: async (signal?: AbortSignal): Promise<AuthResponse> => {
    const response = await apiRequest('/auth/me', { signal });

    return readAuthResponse(response);
  },

  logout: async (): Promise<void> => {
    // Logout returns 204 with no JSON body.
    await apiRequest('/auth/logout', { method: 'POST' });
  },
};
