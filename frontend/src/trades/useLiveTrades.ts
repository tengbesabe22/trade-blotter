import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tradeApi } from '../api/trade-api';
import type { Trade, TradeListQuery } from '../api/trade-contract';
import { streamReadySchema, tradeChangeSchema } from '../api/trade-stream-contract';
import { isLiveFirstPage, mergeLiveTradePage, mergeNewestTrades, type LiveTradePage } from './trade-merge';

const FILTER_REFILL_DELAY_MS = 100;

export type StreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

// Malformed JSON becomes a validation failure instead of escaping the event listener.
function eventData(event: Event): unknown {
  try { return JSON.parse((event as MessageEvent<string>).data); }
  catch { return null; }
}

// One SSE connection feeds the active Query cache; HTTP supplies initial/reconnect snapshots.
export function useLiveTrades(request: TradeListQuery, savedTrade: Trade | null = null) {
  const queryClient = useQueryClient();
  const queryKey = ['trades', request] as const;
  // Retain at most 200 newest trades, even after caching: an older HTTP response
  // can still arrive later. mergeNewestTrades evicts excess rows; unmount releases the buffer.
  const buffered = useRef<Trade[]>([]);
  // Counts accepted updates, not duplicate messages, schema versions or trade versions.
  const receivedTradeCount = useRef(0);
  // Automatic fetches stay passive; a deliberate action marks only the next fetch.
  const userRequestPending = useRef(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>(() =>
    typeof EventSource === 'undefined' ? 'unavailable' : 'connecting');

  const query = useQuery<LiveTradePage>({
    queryKey,
    // Keep the grid mounted while changing pages so its height and scroll stay stable.
    placeholderData: (previous, previousQuery) => {
      const previousRequest = previousQuery?.queryKey[1] as TradeListQuery | undefined;
      // Keep paging smooth, but do not show rows from a different filter selection.
      const sameFilters = previousRequest?.symbol === request.symbol &&
        previousRequest?.traderId === request.traderId &&
        previousRequest?.status === request.status && previousRequest?.side === request.side &&
        previousRequest?.book === request.book && previousRequest?.counterparty === request.counterparty &&
        previousRequest?.tradeDateFrom === request.tradeDateFrom && previousRequest?.tradeDateTo === request.tradeDateTo;
      return sameFilters ? previous : undefined;
    },
    // Wait for ready, or allow HTTP-only fallback when streaming is unavailable.
    enabled: streamStatus === 'connected' || streamStatus === 'unavailable',
    queryFn: async ({ signal }) => {
      // Compare this count after the request to detect updates received while it waited.
      const receivedCountAtStart = receivedTradeCount.current;
      const activity = userRequestPending.current ? 'user' : 'background';
      userRequestPending.current = false;
      const page = await tradeApi.list(request, signal, activity);
      if (signal.aborted) return page;

      // Merge after the fetch, so an older response cannot erase a received event.
      const merged = mergeLiveTradePage(page, buffered.current, request);
      // A refresh can clear an off-page notice only if no updates arrived during it.
      // Example: count 7 -> 8 means the response may not include that latest update.
      return !isLiveFirstPage(request) && receivedTradeCount.current === receivedCountAtStart
        ? { ...merged, hasNewTrades: false }
        : merged;
    },
    gcTime: 0, // Release inactive pages instead of caching the entire trading history.
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const { refetch, isFetching, isError } = query;
  const needsRefill = query.data?.needsRefill === true;
  useEffect(() => {
    if (!needsRefill || isFetching || isError) return;
    if (streamStatus !== 'connected' && streamStatus !== 'unavailable') return;
    // The event already removed the row. Batch nearby exits into one passive,
    // page-sized read; failures keep the live rows and use the manual Refresh action.
    const timer = setTimeout(() => { void refetch(); }, FILTER_REFILL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [needsRefill, isFetching, isError, refetch, streamStatus]);

  // Effect Events see the latest request/queryKey from render. The listener can
  // target the current page without reopening the SSE connection after navigation.
  const receiveTrade = useEffectEvent((trade: Trade) => {
    const existing = buffered.current.find((record) => record.id === trade.id);
    if (existing && existing.version >= trade.version) return;

    buffered.current = mergeNewestTrades(buffered.current, [trade]);
    receivedTradeCount.current += 1;
    // Before the first snapshot, keep the event in the buffer; otherwise update the table now.
    queryClient.setQueryData<LiveTradePage>(queryKey, (page) =>
      page ? mergeLiveTradePage(page, [trade], request) : undefined);
  });

  // Mutation responses enter the same version guard/buffer as SSE. Using an effect
  // also targets the latest page if navigation changed while the save was pending.
  useEffect(() => {
    if (savedTrade) receiveTrade(savedTrade);
  }, [savedTrade]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;

    // Native browser SSE client, not an event store. It handles transport reconnects.
    const source = new EventSource('/api/events'); // Same-origin HttpOnly cookies travel automatically.
    let active = true; // Ignore late callbacks after unmount/sign-out.
    let acceptsTrades = false; // Require a valid ready event before accepting trade messages.
    let generation = 0; // Connection transitions; separate from the received-trade counter.

    // Unknown payloads cannot safely update the cache; retain rows and offer HTTP refresh.
    function invalidStream() {
      acceptsTrades = false;
      generation += 1;
      source.close();
      setStreamStatus('unavailable');
    }

    source.addEventListener('stream.ready', async (event) => {
      if (!active) return;
      if (!streamReadySchema.safeParse(eventData(event)).success) {
        invalidStream();
        return;
      }

      acceptsTrades = true;
      const currentGeneration = ++generation;
      // A new connection needs a fresh snapshot. Keep event-applied rows while cancelling.
      await queryClient.cancelQueries({ queryKey: ['trades'] }, { revert: false });
      // A newer connection/error may have arrived while cancellation was pending.
      if (!active || generation !== currentGeneration) return;

      setStreamStatus('connected');
      void queryClient.invalidateQueries({ queryKey: ['trades'] });
    });
    source.addEventListener('trade.changed', (event) => {
      if (!active || !acceptsTrades) return;
      const change = tradeChangeSchema.safeParse(eventData(event));
      if (!change.success) {
        invalidStream();
        return;
      }
      receiveTrade(change.data.trade);
    });
    source.addEventListener('error', () => {
      if (!active) return;
      acceptsTrades = false;
      generation += 1;
      // CLOSED is terminal (for example HTTP 401); otherwise EventSource retries.
      setStreamStatus(source.readyState === EventSource.CLOSED ? 'unavailable' : 'reconnecting');
    });

    // Closing also stops native retries; the active guard prevents late cache writes.
    return () => {
      active = false;
      generation += 1;
      source.close();
    };
    // receiveTrade is an Effect Event and is intentionally excluded from dependencies.
  }, [queryClient]);

  function markUserRequest() {
    userRequestPending.current = true;
  }

  return { query, streamStatus, markUserRequest };
}
