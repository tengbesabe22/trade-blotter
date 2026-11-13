import { ApiError, apiRequest } from './api-client';
import { defaultTradeListQuery, tradeListQuerySchema, tradeListResponseSchema, type TradeListQuery, type TradeListResponse } from './trade-contract';

export const tradeApi = {
  list: async (query: TradeListQuery = defaultTradeListQuery, signal?: AbortSignal): Promise<TradeListResponse> => {
    const request = tradeListQuerySchema.parse(query);
    const parameters = new URLSearchParams({
      limit: String(request.limit), sortBy: request.sortBy, sortDirection: request.sortDirection,
    });
    if (request.after) parameters.set('after', request.after);

    const response = await apiRequest(`/trades?${parameters}`, { signal });
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
