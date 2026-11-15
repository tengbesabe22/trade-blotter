import { useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tradeApi } from '../api/trade-api';
import type { SymbolSummary } from '../api/trade-summary-contract';
import { mergePositionSummaries } from './trade-summary-merge';

export const positionSummaryQueryKey = ['position-summaries'] as const;

export function usePositionSummaries(enabled: boolean) {
  const queryClient = useQueryClient();
  // Keep one newest event per instrument, even before the tab opens. This also
  // protects against an older baseline arriving after an event. Unmount releases it.
  const buffered = useRef<SymbolSummary[]>([]);
  const userRequestPending = useRef(false);

  const query = useQuery({
    queryKey: positionSummaryQueryKey,
    enabled,
    queryFn: async ({ signal }) => {
      const activity = userRequestPending.current ? 'user' : 'background';
      userRequestPending.current = false;
      const response = await tradeApi.summaries(signal, activity);
      const cached = queryClient.getQueryData<SymbolSummary[]>(positionSummaryQueryKey) ?? [];
      // Compare each symbol independently; neither an HTTP response nor a stale
      // trade version is allowed to roll its position back.
      return mergePositionSummaries(mergePositionSummaries(response.summaries, cached), buffered.current);
    },
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const receiveSummaries = useCallback((incoming: SymbolSummary[]) => {
    if (incoming.length === 0) return;
    buffered.current = mergePositionSummaries(buffered.current, incoming);
    // Preserve a failed-baseline warning until a snapshot succeeds. Events are
    // still buffered and will be merged into the retry response.
    if (queryClient.getQueryState(positionSummaryQueryKey)?.status === 'error') return;
    queryClient.setQueryData<SymbolSummary[]>(positionSummaryQueryKey, (current) =>
      current ? mergePositionSummaries(current, incoming) : undefined);
  }, [queryClient]);

  function markUserRequest() { userRequestPending.current = true; }
  function refresh() {
    if (query.isFetching) return;
    markUserRequest();
    void query.refetch();
  }

  return { query, receiveSummaries, markUserRequest, refresh };
}
