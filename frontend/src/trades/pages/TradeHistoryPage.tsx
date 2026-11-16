import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/api-client';
import { tradeApi } from '../../api/trades/trade-api';
import type { Trade } from '../../api/contracts/trades/trade-contract';
import type { TradeHistoryChange } from '../../api/contracts/trades/trade-history-contract';

const fieldLabels = {
  side: 'Side', quantity: 'Quantity', price: 'Price (USD)', book: 'Book',
  counterparty: 'Counterparty', tradeDate: 'Execution time (UTC)', status: 'Status',
} satisfies Record<TradeHistoryChange['field'], string>;
const actionLabels = { CREATED: 'Created', AMENDED: 'Amended', CANCELLED: 'Cancelled' };

function utcTime(value: string): string {
  return value.replace('T', ' ').replace('Z', ' UTC');
}

function fieldValue(field: TradeHistoryChange['field'], value: string | null): string {
  if (value === null) return '—';
  return field === 'tradeDate' ? utcTime(value) : value;
}

function TradeSnapshot({ trade }: { trade: Trade }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-3">
      {Object.entries(fieldLabels).map(([field, label]) => (
        <div key={field}>
          <dt className="text-xs text-slate-500">{label}</dt>
          <dd className="mt-1 break-words tabular-nums text-slate-900">
            {fieldValue(field as TradeHistoryChange['field'], trade[field as TradeHistoryChange['field']])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type TradeHistoryPageProps = {
  trade: Trade;
  onBack: () => void;
  onSessionExpired: () => void;
};

export function TradeHistoryPage({ trade, onBack, onSessionExpired }: TradeHistoryPageProps) {
  const title = useRef<HTMLHeadingElement>(null);
  const query = useQuery({
    queryKey: ['trade-history', trade.id],
    queryFn: ({ signal }) => tradeApi.history(trade.id, signal),
    retry: false,
    gcTime: 0, // Release history when closed; reopening reads the latest retained entries.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const sessionExpired = query.error instanceof ApiError && query.error.status === 401;
  const missingTrade = query.error instanceof ApiError && query.error.status === 404;

  useEffect(() => { title.current?.focus(); }, [trade.id]);

  return (
    <section aria-labelledby="history-title" className="min-h-[calc(100svh-6rem)] rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <button type="button" onClick={onBack} className="mb-3 rounded text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-2">
            ← Back to trades
          </button>
          <h1 ref={title} tabIndex={-1} id="history-title" className="text-xl font-semibold text-slate-950">Trade history</h1>
          <p className="mt-1 break-all text-sm text-slate-600">{trade.symbol} · {trade.id}</p>
          <p className="mt-1 text-xs text-slate-500">Newest changes first · Prices in USD · Times in UTC</p>
        </div>
        {!sessionExpired && (
          <button type="button" disabled={query.isFetching} onClick={() => { void query.refetch(); }}
            className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 disabled:opacity-60">
            {query.isFetching && query.data ? 'Refreshing history…' : 'Refresh history'}
          </button>
        )}
      </div>

      {sessionExpired ? (
        <div className="py-6">
          <p role="alert" className="text-sm text-red-800">Your session has expired. Sign in again to view history.</p>
          <button type="button" onClick={onSessionExpired} className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white">
            Sign in again
          </button>
        </div>
      ) : (
        <>
          {query.isError && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800">
              {missingTrade ? 'This trade could not be found.' : query.data
                ? 'Unable to refresh history. Showing the last loaded history. Please try again.'
                : 'Unable to load trade history. Please try again.'}
            </p>
          )}
          {query.isPending && <p role="status" className="py-10 text-center text-sm text-slate-600">Loading trade history…</p>}
          {!missingTrade && query.data && (
            <>
              {query.data.entries.length === 0 && <p className="py-10 text-center text-sm text-slate-600">No history recorded</p>}
              <ol className="mt-5 space-y-4">
                {query.data.entries.map((entry) => (
                  <li key={entry.id}>
                    <article aria-labelledby={`history-${entry.id}`} className="rounded-lg border border-slate-200 p-4">
                      <h2 id={`history-${entry.id}`} className="font-semibold text-slate-900">{actionLabels[entry.action]} · Version {entry.tradeVersion}</h2>
                      <p className="mt-1 text-sm text-slate-600">{entry.actor.displayName} · <time dateTime={entry.recordedAt}>{utcTime(entry.recordedAt)}</time></p>
                      {entry.reason && <p className="mt-2 break-words text-sm text-slate-800">{entry.reason}</p>}
                      {entry.changes === null && <p className="mt-3 text-sm text-slate-600">Previous version unavailable. Showing the recorded trade.</p>}
                      {entry.changes && entry.changes.length > 0 ? (
                        <table className="mt-3 w-full text-left text-sm">
                          <caption className="sr-only">Changes in version {entry.tradeVersion}</caption>
                          <thead className="text-xs text-slate-500"><tr><th scope="col" className="py-2">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                          <tbody>
                            {entry.changes.map((change) => (
                              <tr key={change.field} className="border-t border-slate-100">
                                <th scope="row" className="py-2 font-medium text-slate-700">{fieldLabels[change.field]}</th>
                                <td className="tabular-nums text-slate-600">{fieldValue(change.field, change.before)}</td>
                                <td className="tabular-nums text-slate-900">{fieldValue(change.field, change.after)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : <TradeSnapshot trade={entry.snapshot} />}
                    </article>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
