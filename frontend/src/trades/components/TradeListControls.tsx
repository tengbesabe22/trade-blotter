import { useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError } from '../../api/api-client';
import { useTradeOptions } from '../hooks/useTradeOptions';
import { tradeDateFilterSchema, utcDayBoundary } from '../utils/trade-date-filter';
import type { TradeListQuery } from '../../api/contracts/trades/trade-contract';

type TradeListControlsProps = {
  query: TradeListQuery;
  onChange: (query: TradeListQuery) => void;
  onSessionExpired: () => void;
};

const selectClass = 'mt-1 min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

export function TradeListControls({ query, onChange, onSessionExpired }: TradeListControlsProps) {
  // Text and date drafts stay local until Apply or Enter submits them together.
  const [book, setBook] = useState(query.book ?? '');
  const [counterparty, setCounterparty] = useState(query.counterparty ?? '');
  const [from, setFrom] = useState(query.tradeDateFrom?.slice(0, 10) ?? '');
  const [through, setThrough] = useState(() => query.tradeDateTo
    ? utcDayBoundary(query.tradeDateTo.slice(0, 10), -1).slice(0, 10) : '');
  const [dateError, setDateError] = useState('');
  const dateErrorId = useId();

  const dateValidation = tradeDateFilterSchema.safeParse({ from, through });
  const draftFilters = {
    book: book.trim().toLowerCase() || undefined,
    counterparty: counterparty.trim().toLowerCase() || undefined,
    ...(dateValidation.success ? dateValidation.data : { tradeDateFrom: undefined, tradeDateTo: undefined }),
  };
  const filtersChanged = !dateValidation.success || draftFilters.book !== query.book ||
    draftFilters.counterparty !== query.counterparty || draftFilters.tradeDateFrom !== query.tradeDateFrom ||
    draftFilters.tradeDateTo !== query.tradeDateTo;

  const options = useTradeOptions();
  const instruments = options.data?.instruments ?? [];
  const traders = options.data?.traders ?? [];
  const lookupExpired = options.error instanceof ApiError && options.error.status === 401;
  const lookupUnavailable = options.isPending || options.isError;
  const hasFilters = Boolean(
    query.symbol || query.traderId || query.status || query.side ||
    query.book || query.counterparty || query.tradeDateFrom || query.tradeDateTo,
  );

  useEffect(() => {
    if (lookupExpired) onSessionExpired();
  }, [lookupExpired, onSessionExpired]);

  function update(changes: Partial<Omit<TradeListQuery, 'after'>>) {
    // Changing filters, order or size always starts from the first page.
    onChange({ ...query, ...changes, after: undefined });
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dateValidation.success) {
      setDateError(dateValidation.error.issues[0].message);
      return;
    }

    setDateError('');
    if (filtersChanged) update(draftFilters);
  }

  function clearFilters() {
    setBook('');
    setCounterparty('');
    setFrom('');
    setThrough('');
    setDateError('');
    // Clearing an unapplied draft alone does not change the server query.
    if (hasFilters) {
      update({ symbol: undefined, traderId: undefined, status: undefined, side: undefined,
        book: undefined, counterparty: undefined, tradeDateFrom: undefined, tradeDateTo: undefined });
    }
  }

  return (
    <section aria-labelledby="trade-controls-title" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 id="trade-controls-title" className="text-lg font-semibold text-slate-950">Sort and filter</h2>
        <button type="button" onClick={clearFilters} disabled={!hasFilters && !book && !counterparty && !from && !through}
          className="min-h-9 rounded-lg px-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-default disabled:text-slate-400 disabled:hover:bg-transparent">
          Clear filters
        </button>
      </div>
      {options.isFetching && <p role="status" className="mt-3 text-sm text-slate-600">Loading filter options…</p>}
      {options.isError && !lookupExpired && (
        <div role="alert" className="mt-3 text-sm text-red-800">
          <p>Unable to load filter options. Please try again.</p>
          <button type="button" disabled={options.isFetching} onClick={() => { void options.refetch(); }}
            className="mt-2 min-h-11 rounded-lg border border-slate-300 px-3 py-2 font-semibold focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-50">Retry filter options</button>
        </div>
      )}
      {options.isSuccess && instruments.length === 0 && <p role="status" className="mt-3 text-sm text-slate-600">No ticker options available.</p>}
      {options.isSuccess && traders.length === 0 && <p role="status" className="mt-3 text-sm text-slate-600">No trader options available.</p>}
      <div className="mt-4 grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex min-w-0 flex-col text-sm font-medium text-slate-700">
            Ticker
            <select aria-label="Ticker filter" className={selectClass} value={query.symbol ?? ''} disabled={lookupUnavailable}
              onChange={(event) => update({ symbol: event.target.value || undefined })}>
              <option value="">All</option>
              {instruments.map((instrument) => <option key={instrument.symbol} value={instrument.symbol}>{instrument.symbol} — {instrument.name}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col text-sm font-medium text-slate-700">
            Trader
            <select aria-label="Trader filter" className={selectClass} value={query.traderId ?? ''} disabled={lookupUnavailable}
              onChange={(event) => update({ traderId: event.target.value || undefined })}>
              <option value="">All</option>
              {traders.map((trader) => <option key={trader.id} value={trader.id}>{trader.displayName}</option>)}
            </select>
          </label>
        </div>
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
        <form aria-label="Trade filters" onSubmit={applyFilters}>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col text-sm font-medium text-slate-700">
              Book
              <input aria-label="Book filter" className={selectClass + ' w-full'} value={book} maxLength={64}
                onChange={(event) => setBook(event.target.value)} />
            </label>
            <label className="flex min-w-0 flex-col text-sm font-medium text-slate-700">
              Counterparty
              <input aria-label="Counterparty filter" className={selectClass + ' w-full'} value={counterparty} maxLength={120}
                onChange={(event) => setCounterparty(event.target.value)} />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col text-sm font-medium text-slate-700">
              From (UTC)
              <input type="date" className={selectClass + ' w-full'} value={from}
                aria-invalid={dateError ? true : undefined} aria-describedby={dateError ? dateErrorId : undefined}
                onChange={(event) => { setFrom(event.target.value); setDateError(''); }} />
            </label>
            <label className="flex min-w-0 flex-col text-sm font-medium text-slate-700">
              Through (UTC)
              <input type="date" className={selectClass + ' w-full'} value={through}
                aria-invalid={dateError ? true : undefined} aria-describedby={dateError ? dateErrorId : undefined}
                onChange={(event) => { setThrough(event.target.value); setDateError(''); }} />
            </label>
          </div>
          {dateError && <p id={dateErrorId} role="alert" className="mt-2 text-sm text-red-800">{dateError}</p>}
          <button type="submit" disabled={!filtersChanged}
            className="mt-2 min-h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50">
            Apply filters
          </button>
        </form>
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
