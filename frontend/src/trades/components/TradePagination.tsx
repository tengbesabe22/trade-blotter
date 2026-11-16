import type { TradeListResponse } from '../../api/contracts/trades/trade-contract';

type TradePaginationProps = {
  pageInfo: TradeListResponse['pageInfo'] | undefined;
  isFetching: boolean;
  isFirstPage: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onFirstPage: () => void;
};

const buttonClass = 'min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50';

export function TradePagination({ pageInfo, isFetching, isFirstPage, onPrevious, onNext, onFirstPage }: TradePaginationProps) {
  return (
    <nav aria-label="Trade pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 sm:px-6">
      <button type="button" className={buttonClass} onClick={onFirstPage} disabled={isFirstPage}>
        First page
      </button>
      <div className="flex gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={isFetching || isFirstPage}
          onClick={onPrevious}
        >
          Previous
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={isFetching || !pageInfo?.nextCursor}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
