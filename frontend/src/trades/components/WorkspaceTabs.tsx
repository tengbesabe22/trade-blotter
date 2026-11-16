import { useRef, type KeyboardEvent } from 'react';

export type WorkspaceTab = 'trades' | 'positions';

type WorkspaceTabsProps = {
  activeTab: WorkspaceTab;
  onSelect: (tab: WorkspaceTab) => void;
};

export function WorkspaceTabs({ activeTab, onSelect }: WorkspaceTabsProps) {
  const tradesTab = useRef<HTMLButtonElement>(null);
  const positionsTab = useRef<HTMLButtonElement>(null);

  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    let next: WorkspaceTab;
    if (event.key === 'Home') next = 'trades';
    else if (event.key === 'End') next = 'positions';
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = activeTab === 'trades' ? 'positions' : 'trades';
    else return;
    event.preventDefault();
    onSelect(next);
    (next === 'trades' ? tradesTab : positionsTab).current?.focus();
  }

  return (
    <div role="tablist" aria-label="Workspace views" onKeyDown={navigateTabs}
      className="mb-3 flex w-fit gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
      <button ref={tradesTab} type="button" role="tab" id="trades-tab" aria-controls="trades-panel"
        aria-selected={activeTab === 'trades'} tabIndex={activeTab === 'trades' ? 0 : -1} onClick={() => onSelect('trades')}
        className={'rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ' +
          (activeTab === 'trades' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>
        Trades
      </button>
      <button ref={positionsTab} type="button" role="tab" id="positions-tab" aria-controls="positions-panel"
        aria-selected={activeTab === 'positions'} tabIndex={activeTab === 'positions' ? 0 : -1} onClick={() => onSelect('positions')}
        className={'rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ' +
          (activeTab === 'positions' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>
        Position Summary
      </button>
    </div>
  );
}
