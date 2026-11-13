import { ApiError, apiRequest } from './api-client';
import { tradeListResponseSchema, type TradeListResponse } from './trade-contract';

export const tradeApi = {
  list: async (signal?: AbortSignal): Promise<TradeListResponse> => {
    const response = await apiRequest('/trades', { signal });
    const body: unknown = await response.json().catch(() => null);
    const validation = tradeListResponseSchema.safeParse(body);

    if (!validation.success) {
      throw new ApiError(
        response.status,
        'INVALID_RESPONSE',
        'The server returned an unexpected trade response.',
      );
    }

    return validation.data;
  },
};
