import { createTradeRequestSchema, createTradeResponseSchema, type CreateTradeRequest } from './trade-create-contract';
import { ApiError, apiRequest } from './api-client';
import { defaultTradeListQuery, tradeListQuerySchema, tradeListResponseSchema, type TradeListQuery, type TradeListResponse } from './trade-contract';

export const tradeApi = {
  create: async (input: CreateTradeRequest, idempotencyKey: string) => {
    const request = createTradeRequestSchema.parse(input);
    const response = await apiRequest('/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(request),
    });
    const body: unknown = await response.json().catch(() => null);
    const validation = createTradeResponseSchema.safeParse(body);
    if (!validation.success) {
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected trade response.');
    }
    return validation.data.trade;
  },

  list: async (
    query: TradeListQuery = defaultTradeListQuery,
    signal?: AbortSignal,
    activity: 'user' | 'background' = 'user',
  ): Promise<TradeListResponse> => {
    const request = tradeListQuerySchema.parse(query);
    const parameters = new URLSearchParams({
      limit: String(request.limit), sortBy: request.sortBy, sortDirection: request.sortDirection,
    });
    if (request.after) parameters.set('after', request.after);

    const response = await apiRequest(`/trades?${parameters}`, {
      signal,
      headers: activity === 'background' ? { 'X-Session-Activity': 'background' } : undefined,
    });
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
