import type { Ref } from 'react';

type TradeListHeaderProps = {
  titleRef?: Ref<HTMLHeadingElement>;
  tradeCount?: number;
  isFetching: boolean;
  sessionExpired: boolean;
  onRefresh: () => void;
};

export function TradeListHeader({ titleRef, tradeCount, isFetching, sessionExpired, onRefresh }: TradeListHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-4 sm:px-6">
      <div>
        <h1 ref={titleRef} tabIndex={-1} id="trades-title" className="text-xl font-semibold tracking-tight text-slate-950">
          Trades
        </h1>
        <p aria-live="polite" className="mt-1 text-sm text-slate-600">
          {sessionExpired || tradeCount === undefined ? 'USD equities · All traders' : `${tradeCount} ${tradeCount === 1 ? 'trade' : 'trades'} shown`}
        </p>
      </div>
      {!sessionExpired && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60"
        >
          {isFetching && tradeCount !== undefined ? 'Refreshing…' : 'Refresh trades'}
        </button>
      )}
    </div>
  );
}
