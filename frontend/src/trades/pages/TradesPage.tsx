import { lazy, Suspense, useCallback, useRef, useState, type ReactNode } from 'react';
import type { CurrentUser } from '../../api/contracts/auth/auth-contract';
import { AmendTradeForm } from '../components/AmendTradeForm';
import { CancelTradePanel } from '../components/CancelTradePanel';
import { ApiError } from '../../api/api-client';
import { useLiveTrades, type StreamStatus } from '../hooks/useLiveTrades';
import { defaultTradeListQuery, type TradeListQuery, type Trade } from '../../api/contracts/trades/trade-contract';
import { TradeListControls } from '../components/TradeListControls';
import { TradePagination } from '../components/TradePagination';
import { TradeHistoryPage } from './TradeHistoryPage';
import { PositionSummaryPage } from './PositionSummaryPage';
import { WorkspaceTabs, type WorkspaceTab } from '../components/WorkspaceTabs';
import { TradeListHeader } from '../components/TradeListHeader';

// Load the grid only when there are rows to display, keeping login lightweight.
const TradeTable = lazy(async () => {
  const { TradeTable } = await import('../components/TradeTable');
  return { default: TradeTable };
});

const streamMessages = {
  connecting: 'Connecting live updates…',
  connected: 'Live updates connected',
  reconnecting: 'Live connection lost. Showing last loaded data; reconnecting…',
  unavailable: 'Live updates unavailable. Use Refresh trades.',
} satisfies Record<StreamStatus, string>;

type SelectedTradeAction = { kind: 'amend' | 'cancel'; trade: Trade };

type TradesPageProps = {
  user: CurrentUser;
  onSessionExpired: () => void;
  tradePanel?: ReactNode;
  createSubmissionLocked?: boolean;
};

export function TradesPage({ user, onSessionExpired, tradePanel, createSubmissionLocked = false }: TradesPageProps) {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('trades');
  const [positionsRequested, setPositionsRequested] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<Trade | null>(null);
  const [selectedAction, setSelectedAction] = useState<SelectedTradeAction | null>(null);
  const [savedTrade, setSavedTrade] = useState<Trade | null>(null);
  const [success, setSuccess] = useState('');
  const tradesTitle = useRef<HTMLHeadingElement>(null);
  const [queryOptions, setQueryOptions] = useState(defaultTradeListQuery);
  // Each entry is the cursor used to request a visited page; null represents page one.
  const [cursorHistory, setCursorHistory] = useState<(string | null)[]>([null]);
  const request = { ...queryOptions, after: cursorHistory.at(-1) ?? undefined };
  const isFirstPage = cursorHistory.length === 1;
  const hasFilters = Boolean(
    queryOptions.symbol || queryOptions.traderId || queryOptions.status || queryOptions.side ||
    queryOptions.book || queryOptions.counterparty || queryOptions.tradeDateFrom || queryOptions.tradeDateTo,
  );
  const emptyTitle = hasFilters ? 'No matching trades' : 'No trades yet';
  const emptyDescription = hasFilters
    ? 'Try changing your filters.'
    : 'Trades will appear here after they are recorded. Use Refresh trades to check again.';
  const { query, streamStatus, markUserRequest, positions } = useLiveTrades(request, savedTrade, positionsRequested);

  const trades = query.data?.trades;
  const sessionExpired = (query.error instanceof ApiError && query.error.status === 401) ||
    (positions.query.error instanceof ApiError && positions.query.error.status === 401);

  function selectTab(tab: WorkspaceTab) {
    if (tab === 'positions' && !positionsRequested) {
      positions.markUserRequest();
      setPositionsRequested(true);
    }
    setActiveTab(tab);
  }

  const openAmendment = useCallback((trade: Trade) => {
    if (createSubmissionLocked) return;
    setSelectedAction((current) => current ?? { kind: 'amend', trade });
    setSuccess('');
  }, [createSubmissionLocked]);

  const openCancellation = useCallback((trade: Trade) => {
    if (createSubmissionLocked) return;
    setSelectedAction((current) => current ?? { kind: 'cancel', trade });
    setSuccess('');
  }, [createSubmissionLocked]);

  const openHistory = useCallback((trade: Trade) => {
    if (!createSubmissionLocked) setSelectedHistory(trade);
  }, [createSubmissionLocked]);

  function closeHistory() {
    setSelectedHistory(null);
    // Restore focus after the blotter becomes visible again.
    requestAnimationFrame(() => tradesTitle.current?.focus());
  }

  function closeTradeAction() {
    setSelectedAction(null);
    tradesTitle.current?.focus();
  }

  function changeQuery(nextQuery: TradeListQuery) {
    markUserRequest();
    setQueryOptions(nextQuery);
    // reset to the first page when changing filters or sort order
    setCursorHistory([null]);
  }

  function nextPage() {
    const nextCursor = query.data?.pageInfo.nextCursor;
    if (nextCursor && !query.isFetching && !query.isPlaceholderData) {
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

  const blotter = (
    <div className="grid min-h-[calc(100svh-9rem)] grid-cols-[minmax(0,1fr)_24rem] items-stretch gap-4">
      <section aria-labelledby="trades-title" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <TradeListHeader titleRef={tradesTitle} tradeCount={trades?.length}
          isFetching={query.isFetching} sessionExpired={sessionExpired} onRefresh={refreshTrades} />

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
            {success && <p role="status" className="mx-4 mb-4 text-sm text-emerald-800 sm:mx-6">{success}</p>}
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
                <h2 className="font-semibold text-slate-900">{isFirstPage ? emptyTitle : 'No trades on this page'}</h2>
                <p className="mt-2 text-sm text-slate-600">
                  {isFirstPage
                    ? emptyDescription
                    : 'Trades may have moved since this page was loaded. Return to the first page to continue.'}
                </p>
              </div>
            )}

            {trades && trades.length > 0 && (
              <>
                <p className="px-4 py-3 text-xs leading-5 text-slate-600 sm:px-6">
                  Prices in USD · Execution times in UTC. Scroll horizontally to see all columns.
                  Use the sort controls to order all trades.
                  {user.role === 'TRADER' && ' You can amend or cancel only your own active trades.'}
                </p>
                <Suspense fallback={<p role="status" className="p-10 text-center text-sm text-slate-600">Preparing trade table…</p>}>
                  <TradeTable trades={trades} user={user} actionsDisabled={selectedAction !== null || createSubmissionLocked}
                    onAmend={openAmendment} onCancel={openCancellation} onHistory={openHistory} />
                </Suspense>
              </>
            )}
            <TradePagination
              pageInfo={query.data?.pageInfo}
              isFetching={query.isFetching || query.isPlaceholderData}
              isFirstPage={isFirstPage}
              onFirstPage={firstPage}
              onPrevious={previousPage}
              onNext={nextPage}
            />
          </>
        )}
      </section>
      {!sessionExpired && (
        <aside aria-label="Trade controls" className="flex min-w-0 flex-col gap-4">
          <TradeListControls query={queryOptions} onChange={changeQuery} onSessionExpired={onSessionExpired} />
          {/* Keep creation mounted so switching panels never discards its draft. */}
          <div hidden={selectedAction !== null} className={selectedAction ? 'hidden' : 'flex flex-1 flex-col'}>
            {tradePanel}
          </div>
          {selectedAction?.kind === 'amend' && (
            <AmendTradeForm
              key={selectedAction.trade.id}
              trade={selectedAction.trade}
              latestTrade={trades?.find((trade) => trade.id === selectedAction.trade.id)}
              onSessionExpired={onSessionExpired}
              onDiscard={closeTradeAction}
              onAmended={(trade) => {
                setSavedTrade(trade);
                closeTradeAction();
                setSuccess('Trade amended: ' + trade.symbol + ' · ' + trade.id);
              }}
            />
          )}
          {selectedAction?.kind === 'cancel' && (
            <CancelTradePanel
              key={selectedAction.trade.id}
              trade={selectedAction.trade}
              latestTrade={trades?.find((trade) => trade.id === selectedAction.trade.id)}
              onSessionExpired={onSessionExpired}
              onClose={closeTradeAction}
              onCancelled={(trade) => {
                setSavedTrade(trade);
                closeTradeAction();
                setSuccess('Trade cancelled: ' + trade.symbol + ' · ' + trade.id);
              }}
            />
          )}
        </aside>
      )}
    </div>
  );

  return (
    <>
      {!selectedHistory && (
        <WorkspaceTabs activeTab={activeTab} onSelect={selectTab} />
      )}
      {/* Both views and the shared SSE stay mounted to preserve filters, drafts and live state. */}
      <div id="trades-panel" role="tabpanel" aria-labelledby="trades-tab" hidden={selectedHistory !== null || activeTab !== 'trades'}>
        {blotter}
      </div>
      <div id="positions-panel" role="tabpanel" aria-labelledby="positions-tab" hidden={selectedHistory !== null || activeTab !== 'positions'}>
        {positionsRequested && <PositionSummaryPage query={positions.query} connectionMessage={streamMessages[streamStatus]}
          sessionExpired={sessionExpired} onRefresh={positions.refresh} onSessionExpired={onSessionExpired} />}
      </div>
      {selectedHistory && (
        <TradeHistoryPage trade={selectedHistory} onBack={closeHistory} onSessionExpired={onSessionExpired} />
      )}
    </>
  );
}
