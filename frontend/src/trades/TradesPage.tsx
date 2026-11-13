import { lazy, Suspense, useState } from 'react';
import { ApiError } from '../api/api-client';
import { useLiveTrades, type StreamStatus } from './useLiveTrades';
import { defaultTradeListQuery, type TradeListQuery } from '../api/trade-contract';
import { TradeListControls } from './TradeListControls';
import { TradePagination } from './TradePagination';

// Load the grid only when there are rows to display, keeping login lightweight.
const TradeTable = lazy(async () => {
  const { TradeTable } = await import('./TradeTable');
  return { default: TradeTable };
});

const streamMessages = {
  connecting: 'Connecting live updates…',
  connected: 'Live updates connected',
  reconnecting: 'Live connection lost. Showing last loaded data; reconnecting…',
  unavailable: 'Live updates unavailable. Use Refresh trades.',
} satisfies Record<StreamStatus, string>;

type TradesPageProps = {
  onSessionExpired: () => void;
};

export function TradesPage({ onSessionExpired }: TradesPageProps) {
  const [queryOptions, setQueryOptions] = useState(defaultTradeListQuery);
  // Each entry is the cursor used to request a visited page; null represents page one.
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const request = { ...queryOptions, after: cursorHistory.at(-1) ?? undefined };
  const isFirstPage = cursorHistory.length === 1;
  const { query, streamStatus, markUserRequest } = useLiveTrades(request);

  const trades = query.data?.trades;
  const sessionExpired = query.error instanceof ApiError && query.error.status === 401;

  function changeQuery(nextQuery: TradeListQuery) {
    markUserRequest();
    setQueryOptions(nextQuery);
    // reset to the first page when changing filters or sort order
    setCursorHistory([null]);
  }

  function nextPage() {
    const nextCursor = query.data?.pageInfo.nextCursor;
    if (nextCursor && !query.isFetching) {
      markUserRequest();
      setCursorHistory((history) => [...history, nextCursor]);
    }
  }

  function previousPage() {
    markUserRequest();
    setCursorHistory((history) => history.length > 1 ? history.slice(0, -1) : history);
  }

  function firstPage() {
    markUserRequest();
    setCursorHistory([null]);
  }

  function refreshTrades() {
    if (!query.isFetching) {
      markUserRequest();
      void query.refetch();
    }
  }

  return (
    <section aria-labelledby="trades-title" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-4 sm:px-6">
        <div>
          <h1 id="trades-title" className="text-xl font-semibold tracking-tight text-slate-950">
            Trades
          </h1>
          <p aria-live="polite" className="mt-1 text-sm text-slate-600">
            {sessionExpired || !trades ? 'USD equities · All traders' : `${trades.length} ${trades.length === 1 ? 'trade' : 'trades'} shown`}
          </p>
        </div>
        {!sessionExpired && (
          <button
            type="button"
            onClick={refreshTrades}
            disabled={query.isFetching}
            className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60"
          >
            {query.isFetching && trades ? 'Refreshing…' : 'Refresh trades'}
          </button>
        )}
      </div>

      {sessionExpired ? (
        <div className="p-6">
          <p role="alert" className="text-sm text-red-800">
            Your session has expired. Sign in again to view trades.
          </p>
          <button
            type="button"
            onClick={onSessionExpired}
            className="mt-4 min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            Sign in again
          </button>
        </div>
      ) : (
        <>
          <TradeListControls query={queryOptions} onChange={changeQuery} />
          <p aria-live="polite" className="px-4 pb-3 text-sm text-slate-600 sm:px-6">
            {streamStatus === 'connected' && query.isFetching
              ? 'Synchronising live updates…'
              : streamMessages[streamStatus]}
          </p>
          {!isFirstPage && query.data?.hasNewTrades && (
            <p role="status" className="mx-4 mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 sm:mx-6">
              New trades received. Refresh trades to synchronise this page.
            </p>
          )}
          {query.isError && (
            <p role="alert" className="m-4 rounded-lg bg-red-50 p-4 text-sm text-red-800">
              {trades
                ? 'Unable to refresh trades. Showing the last loaded data. Please try again.'
                : 'Unable to load trades. Please try again.'}
            </p>
          )}

          {query.isPending && (
            <p role="status" className="p-10 text-center text-sm text-slate-600">Loading trades…</p>
          )}

          {trades && trades.length === 0 && (
            <div className="px-6 py-12 text-center">
              <h2 className="font-semibold text-slate-900">{isFirstPage ? 'No trades yet' : 'No trades on this page'}</h2>
              <p className="mt-2 text-sm text-slate-600">
                {isFirstPage
                  ? 'Trades will appear here after they are recorded. Use Refresh trades to check again.'
                  : 'Trades may have moved since this page was loaded. Return to the first page to continue.'}
              </p>
            </div>
          )}

          {trades && trades.length > 0 && (
            <>
              <p className="px-4 py-3 text-xs leading-5 text-slate-600 sm:px-6">
                Prices in USD · Execution times in UTC. Scroll horizontally to see all columns.
                Use the sort controls to order all trades.
              </p>
              <Suspense fallback={<p role="status" className="p-10 text-center text-sm text-slate-600">Preparing trade table…</p>}>
                <TradeTable trades={trades} />
              </Suspense>
            </>
          )}
          <TradePagination
            pageInfo={query.data?.pageInfo}
            isFetching={query.isFetching}
            isFirstPage={isFirstPage}
            onFirstPage={firstPage}
            onPrevious={previousPage}
            onNext={nextPage}
          />
        </>
      )}
    </section>
  );
}
