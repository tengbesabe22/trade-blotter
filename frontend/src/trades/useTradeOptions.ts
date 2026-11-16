import { useQuery } from '@tanstack/react-query';
import { tradeApi } from '../api/trades/trade-api';

export function useTradeOptions() {
  return useQuery({
    // Separate from ['trades'], so trade mutations/reconnects leave options alone.
    queryKey: ['trade-options'],
    queryFn: ({ signal }) => tradeApi.filterOptions(signal),
    staleTime: Infinity,
    // Retain options between consumers; the signed-in workspace owns the client.
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
