import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { TradeFilterOptions } from '../api/contracts/trades/trade-filter-options-contract';

type InstrumentSelectorProps = {
  instruments: TradeFilterOptions['instruments'];
  value: string;
  onChange: (symbol: string) => void;
  disabled?: boolean;
  error?: string;
};

export function InstrumentSelector({ instruments, value, onChange, disabled = false, error }: InstrumentSelectorProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // Search text is temporary. Only an explicit choice commits a ticker to the parent.
  const [search, setSearch] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeOption = useRef<HTMLLIElement>(null);
  const term = (search ?? '').trim().toLowerCase();
  const matches = instruments.filter((instrument) =>
    instrument.symbol.toLowerCase().includes(term) || instrument.name.toLowerCase().includes(term));
  const expanded = open && !disabled;
  const activeId = expanded && matches[activeIndex] ? `${id}-option-${activeIndex}` : undefined;

  useEffect(() => {
    if (expanded) activeOption.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, expanded, search]);

  function closeList() {
    setOpen(false);
    setSearch(null);
    setActiveIndex(-1);
  }

  function choose(symbol: string) {
    if (disabled) return;
    onChange(symbol);
    closeList();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled || event.nativeEvent.isComposing) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (event.key === 'ArrowDown') {
        setActiveIndex(expanded ? Math.min(activeIndex + 1, matches.length - 1) : 0);
      } else {
        setActiveIndex(expanded && activeIndex >= 0 ? Math.max(activeIndex - 1, 0) : matches.length - 1);
      }
    } else if (event.key === 'Enter') {
      // Enter chooses an option; it must never submit the surrounding trade form.
      event.preventDefault();
      const instrument = expanded ? matches[activeIndex] : undefined;
      if (instrument) choose(instrument.symbol);
    } else if (event.key === 'Escape') {
      if (expanded) event.preventDefault();
      closeList();
    } else if (event.key === 'Tab') {
      closeList(); // Preserve the browser's normal Tab focus movement.
    }
  }

  return (
    <div className="relative min-w-0">
      <label htmlFor={`${id}-input`} className="text-sm font-medium text-slate-700">Ticker</label>
      <div className="relative mt-1">
        <input id={`${id}-input`} type="text" role="combobox" autoComplete="off" maxLength={120}
          value={expanded ? search ?? value : value} disabled={disabled} placeholder="Search instruments"
          aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={expanded}
          aria-controls={expanded ? `${id}-list` : undefined} aria-activedescendant={activeId}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : `${id}-hint`}
          onFocus={() => { if (!disabled) { setSearch(null); setOpen(true); setActiveIndex(-1); } }}
          onClick={() => { if (!disabled) setOpen(true); }} onBlur={closeList} onKeyDown={handleKeyDown}
          onChange={(event) => {
            if (disabled) return;
            setSearch(event.target.value);
            setOpen(true);
            setActiveIndex(0);
            onChange(''); // Editing invalidates any previously committed ticker.
          }}
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:bg-slate-100" />
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          className="pointer-events-none absolute right-3 top-3 size-5 text-slate-500"><path d="m6 9 6 6 6-6" /></svg>
      </div>
      {error
        ? <p id={`${id}-error`} className="mt-1 text-sm text-red-800">{error}</p>
        : <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">Search by ticker or company name.</p>}
      {expanded && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-60 overflow-auto rounded-lg border border-slate-300 bg-white p-1 shadow-lg">
          <ul id={`${id}-list`} role="listbox" aria-label="Instruments">
            {matches.map((instrument, index) => (
              <li key={instrument.symbol} id={`${id}-option-${index}`} role="option" aria-selected={index === activeIndex}
                ref={index === activeIndex ? activeOption : null}
                // Keep focus on the input so blur cannot remove the option before click.
                onMouseDown={(event) => event.preventDefault()} onClick={() => choose(instrument.symbol)}
                onMouseEnter={() => setActiveIndex(index)}
                className={'cursor-pointer rounded px-3 py-2 text-sm ' + (index === activeIndex ? 'bg-blue-50 text-blue-900' : 'text-slate-800')}>
                <span className="font-semibold">{instrument.symbol}</span> — {instrument.name}
              </li>
            ))}
          </ul>
          {matches.length === 0 && <p role="status" className="px-3 py-2 text-sm text-slate-600">
            {instruments.length === 0 ? 'No instruments available.' : 'No matching instruments.'}
          </p>}
        </div>
      )}
    </div>
  );
}
