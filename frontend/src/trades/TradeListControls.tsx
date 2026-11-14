import type { TradeListQuery } from '../api/trade-contract';

type TradeListControlsProps = {
  query: TradeListQuery;
  onChange: (query: TradeListQuery) => void;
};

const selectClass = 'mt-1 min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

export function TradeListControls({ query, onChange }: TradeListControlsProps) {
  function update(changes: Partial<Pick<TradeListQuery, 'limit' | 'sortBy' | 'sortDirection' | 'status' | 'side'>>) {
    // Changing the result order or size always starts from the first page.
    onChange({ ...query, ...changes, after: undefined });
  }

  return (
    <section aria-labelledby="trade-controls-title" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 id="trade-controls-title" className="text-lg font-semibold text-slate-950">Sort and filter</h2>
      <div className="mt-4 grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col text-sm font-medium text-slate-700">
            Status
            <select className={selectClass} value={query.status ?? ''}
              onChange={(event) => update({ status: (event.target.value || undefined) as TradeListQuery['status'] })}>
              <option value="">All</option><option value="ACTIVE">Active</option><option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-col text-sm font-medium text-slate-700">
            Side
            <select className={selectClass} value={query.side ?? ''}
              onChange={(event) => update({ side: (event.target.value || undefined) as TradeListQuery['side'] })}>
              <option value="">All</option><option value="BUY">Buy</option><option value="SELL">Sell</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col text-sm font-medium text-slate-700">
          Sort by
          <select
            className={selectClass}
            value={query.sortBy}
            onChange={(event) => update({ sortBy: event.target.value as TradeListQuery['sortBy'] })}
          >
            <option value="tradeDate">Execution time</option>
            <option value="symbol">Ticker</option>
            <option value="trader">Trader</option>
            <option value="quantity">Quantity</option>
            <option value="price">Price</option>
            <option value="status">Status</option>
          </select>
        </label>
        <label className="flex flex-col text-sm font-medium text-slate-700">
          Sort direction
          <select
            className={selectClass}
            value={query.sortDirection}
            onChange={(event) => update({ sortDirection: event.target.value as 'asc' | 'desc' })}
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
        <label className="flex flex-col text-sm font-medium text-slate-700">
          Rows per page
          <select
            className={selectClass}
            value={query.limit}
            onChange={(event) => update({ limit: Number(event.target.value) })}
          >
            {[25, 50, 100, 200].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
          </select>
        </label>
      </div>
    </section>
  );
}
