import {
  cancelTradeIdSchema,
  cancelTradeRequestSchema,
  cancelTradeResponseSchema,
  type CancelTradeRequest,
} from './trade-cancel-contract';
import {
  amendTradeIdSchema,
  amendTradeRequestSchema,
  amendTradeResponseSchema,
  type AmendTradeRequest,
} from './trade-amend-contract';
import { createTradeRequestSchema, createTradeResponseSchema, type CreateTradeRequest } from './trade-create-contract';
import { tradeFilterOptionsSchema, type TradeFilterOptions } from './trade-filter-options-contract';
import { ApiError, apiRequest } from './api-client';
import { defaultTradeListQuery, tradeListQuerySchema, tradeListResponseSchema, type TradeListQuery, type TradeListResponse } from './trade-contract';

export const tradeApi = {
  filterOptions: async (signal?: AbortSignal): Promise<TradeFilterOptions> => {
    const response = await apiRequest('/trades/filter-options', { signal });
    const body: unknown = await response.json().catch(() => null);
    const validation = tradeFilterOptionsSchema.safeParse(body);

    if (!validation.success) {
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned unexpected trade options.');
    }

    return validation.data;
  },

  cancel: async (tradeId: string, input: CancelTradeRequest) => {
    const id = cancelTradeIdSchema.parse(tradeId);
    const request = cancelTradeRequestSchema.parse(input);
    const response = await apiRequest(`/trades/${id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const body: unknown = await response.json().catch(() => null);
    const validation = cancelTradeResponseSchema.safeParse(body);

    if (
      !validation.success ||
      validation.data.trade.id !== id ||
      validation.data.trade.version !== request.expectedVersion + 1
    ) {
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected cancellation response.');
    }

    return validation.data.trade;
  },

  amend: async (tradeId: string, input: AmendTradeRequest) => {
    const id = amendTradeIdSchema.parse(tradeId);
    const request = amendTradeRequestSchema.parse(input);
    const response = await apiRequest(`/trades/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const body: unknown = await response.json().catch(() => null);
    const validation = amendTradeResponseSchema.safeParse(body);

    if (!validation.success || validation.data.trade.id !== id) {
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected amendment response.');
    }

    return validation.data.trade;
  },

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
    if (request.status) parameters.set('status', request.status);
    if (request.side) parameters.set('side', request.side);

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
