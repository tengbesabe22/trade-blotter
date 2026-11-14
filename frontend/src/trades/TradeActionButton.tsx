import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

type TradeActionButtonProps = {
  action: 'amend' | 'cancel';
  label: string;
  disabled: boolean;
  onClick: () => void;
};

export function TradeActionButton({ action, label, disabled, onClick }: TradeActionButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  const tooltipId = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const tooltip = useRef<HTMLDivElement>(null);

  const showTooltip = useCallback(() => {
    if (disabled || !button.current) return;
    const bounds = button.current.getBoundingClientRect();
    setPosition({
      left: Math.max(64, Math.min(window.innerWidth - 64, bounds.left + bounds.width / 2)),
      top: Math.max(32, bounds.top),
    });
  }, [disabled]);

  function hideOnLeave(event: MouseEvent<HTMLElement>) {
    const next = event.relatedTarget;
    // Moving between the button and its tooltip keeps it open, without a timer.
    const stillOverAction = next instanceof window.Node &&
      (button.current?.contains(next) || tooltip.current?.contains(next));
    if (!stillOverAction && document.activeElement !== button.current) setPosition(null);
  }

  useEffect(() => {
    if (!position || disabled) return;
    function hide() { setPosition(null); }
    function onKeyDown(event: KeyboardEvent) { if (event.key === 'Escape') hide(); }
    function onViewportChange() {
      // Focusing a grid button can scroll it into view; keep its tooltip aligned.
      if (document.activeElement === button.current) showTooltip();
      else hide();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, [position, disabled, showTooltip]);

  return (
    <>
      <button ref={button} type="button" disabled={disabled} aria-label={label}
        aria-describedby={position ? tooltipId : undefined}
        onMouseEnter={showTooltip} onMouseLeave={hideOnLeave} onFocus={showTooltip} onBlur={() => setPosition(null)}
        onClick={() => { setPosition(null); onClick(); }}
        className={'flex size-8 shrink-0 items-center justify-center rounded focus-visible:outline-2 disabled:opacity-50 ' +
          (action === 'amend' ? 'text-blue-700 hover:bg-blue-50 focus-visible:outline-blue-700' : 'text-red-700 hover:bg-red-50 focus-visible:outline-red-700')}>
        <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          {action === 'amend' ? (
            <path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15z" />
          ) : (
            <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></>
          )}
        </svg>
      </button>
      {/* Portal outside the grid so row/cell overflow cannot clip the tooltip. */}
      {position && !disabled && createPortal(
        <div ref={tooltip} id={tooltipId} role="tooltip" style={position}
          onMouseLeave={hideOnLeave}
          className="fixed z-50 -translate-x-1/2 -translate-y-full pb-1">
          <div className="whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs text-white shadow-sm">
            {action === 'amend' ? 'Amend trade' : 'Cancel trade'}
          </div>
        </div>, document.body,
      )}
    </>
  );
}
