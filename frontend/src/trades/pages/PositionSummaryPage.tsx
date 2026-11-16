import type { UseQueryResult } from '@tanstack/react-query';
import type { SymbolSummary } from '../../api/contracts/trades/trade-summary-contract';

// Format the string digits directly: converting large quantities to Number loses precision.
function quantity(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  // Remove trailing fractional zeros (e.g. 500000 becomes 5).
  const decimals = fraction.replace(/0+$/, '');
  // Insert a comma before each group of three remaining whole digits: 12345 becomes 12,345.
  return whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (decimals ? '.' + decimals : '');
}

function direction(net: string): 'Long' | 'Short' | 'Flat' {
  if (net === '0.000000') return 'Flat';
  return net.startsWith('-') ? 'Short' : 'Long';
}
const directionStyles = { Long: 'text-emerald-800', Short: 'text-red-800', Flat: 'text-slate-600' };

type PositionSummaryPageProps = {
  query: UseQueryResult<SymbolSummary[], Error>;
  connectionMessage: string;
  sessionExpired: boolean;
  onRefresh: () => void;
  onSessionExpired: () => void;
};

export function PositionSummaryPage({ query, connectionMessage, sessionExpired, onRefresh, onSessionExpired }: PositionSummaryPageProps) {
  return (
    <section aria-labelledby="positions-title" className="min-h-[calc(100svh-9rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-4 sm:px-6">
        <div>
          <h1 id="positions-title" className="text-xl font-semibold tracking-tight text-slate-950">Position Summary</h1>
          <p className="mt-1 text-sm text-slate-600">All traders and books · All dates · USD equities</p>
          <p className="mt-1 text-xs text-slate-500">ACTIVE executions · Net = bought − sold · Zero opening positions assumed</p>
        </div>
        {!sessionExpired && (
          <button type="button" onClick={onRefresh} disabled={query.isFetching}
            className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60">
            Refresh positions
          </button>
        )}
      </div>

      {sessionExpired ? (
        <div className="p-6">
          <p role="alert" className="text-sm text-red-800">Your session has expired. Sign in again to view positions.</p>
          <button type="button" onClick={onSessionExpired} className="mt-4 min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2">
            Sign in again
          </button>
        </div>
      ) : (
        <>
          <p aria-live="polite" className="px-4 py-3 text-sm text-slate-600 sm:px-6">
            {query.isFetching && query.data ? 'Synchronising positions…' : connectionMessage}
          </p>
          {query.isError && (
            <p role="alert" className="mx-4 mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-800 sm:mx-6">
              {query.data ? 'Unable to refresh positions. Showing the last received data. Please try again.'
                : 'Unable to load positions. Please try again.'}
            </p>
          )}
          {query.isPending && <p role="status" className="p-10 text-center text-sm text-slate-600">Loading positions…</p>}
          {query.data?.length === 0 && <p className="p-10 text-center text-sm text-slate-600">No positions yet</p>}
          {query.data && query.data.length > 0 && (
            <div className="max-h-[calc(100svh-19rem)] overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Current net positions by symbol</caption>
                <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th scope="col" className="px-6 py-3">Symbol</th>
                    <th scope="col" className="px-6 py-3 text-right">Bought</th>
                    <th scope="col" className="px-6 py-3 text-right">Sold</th>
                    <th scope="col" className="px-6 py-3 text-right">Net quantity</th>
                    <th scope="col" className="px-6 py-3">Direction</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.map((row) => {
                    const positionDirection = direction(row.netQuantity);
                    return (
                      <tr key={row.instrumentId} className="border-t border-slate-100 hover:bg-slate-50">
                        <th scope="row" className="px-6 py-3 font-semibold text-slate-900">{row.symbol}</th>
                        <td className="px-6 py-3 text-right tabular-nums text-slate-700">{quantity(row.buyQuantity)}</td>
                        <td className="px-6 py-3 text-right tabular-nums text-slate-700">{quantity(row.sellQuantity)}</td>
                        <td className="px-6 py-3 text-right font-semibold tabular-nums text-slate-900">{quantity(row.netQuantity)}</td>
                        <td className={'px-6 py-3 font-medium ' + directionStyles[positionDirection]}>{positionDirection}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
