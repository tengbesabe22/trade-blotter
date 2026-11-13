import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { ApiError } from '../api/api-client';
import { amendTradeConflictSchema, amendTradeRequestSchema, type AmendTradeRequest } from '../api/trade-amend-contract';
import { tradeApi } from '../api/trade-api';
import type { Trade } from '../api/trade-contract';

type AmendTradeFormProps = {
  trade: Trade;
  latestTrade?: Trade;
  onAmended: (trade: Trade) => void;
  onDiscard: () => void;
  onSessionExpired: () => void;
};

function formValues(trade: Trade) {
  return {
    side: trade.side, quantity: trade.quantity, price: trade.price,
    // Keep milliseconds: editing price must not silently alter execution time.
    tradeDate: trade.tradeDate.slice(0, -1),
    book: trade.book ?? '', counterparty: trade.counterparty ?? '', reason: '',
  };
}

type FormValues = ReturnType<typeof formValues>;

function comparableDecimal(value: string) {
  // Compare exact strings without floating-point rounding: 227.4500 equals 227.45.
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}

function changedFields(trade: Trade, input: AmendTradeRequest['changes']) {
  const changes = { ...input };
  for (const field of ['side', 'quantity', 'price', 'tradeDate', 'book', 'counterparty'] as const) {
    const unchanged = field === 'quantity' || field === 'price'
      ? comparableDecimal(changes[field] ?? '') === comparableDecimal(trade[field])
      : changes[field] === trade[field];
    if (unchanged) delete changes[field];
  }
  return changes;
}

const inputClass = 'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:bg-slate-100';
const buttonClass = 'min-h-11 rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50';

export function AmendTradeForm({ trade, latestTrade, onAmended, onDiscard, onSessionExpired }: AmendTradeFormProps) {
  // Keep the selected snapshot/version separate from live table data until Load latest.
  const [baseline, setBaseline] = useState(trade);
  const [values, setValues] = useState(() => formValues(trade));
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<Trade | null>(null);
  const submitting = useRef(false);
  const panel = useRef<HTMLElement>(null);

  // Review the highest known version, whether it arrived through SSE or a 409 response.
  let currentTrade = conflict;
  if (latestTrade && latestTrade.version > baseline.version && latestTrade.version > (currentTrade?.version ?? 0)) {
    currentTrade = latestTrade;
  }
  const cancelled = currentTrade?.status === 'CANCELLED';

  useEffect(() => {
    panel.current?.focus();
    panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  function update(field: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setMessage('');
  }

  function loadLatest() {
    if (!currentTrade || cancelled) return;
    setBaseline(currentTrade);
    setValues(formValues(currentTrade));
    setConflict(null);
    setErrors({});
    setMessage('');
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || currentTrade) return;

    const executionTime = new Date(values.tradeDate + 'Z');
    const validation = amendTradeRequestSchema.safeParse({
      expectedVersion: baseline.version,
      changes: {
        side: values.side, quantity: values.quantity, price: values.price,
        tradeDate: Number.isFinite(executionTime.getTime()) ? executionTime.toISOString() : '',
        book: values.book, counterparty: values.counterparty,
      },
      reason: values.reason,
    });
    if (!validation.success) {
      const fieldErrors: Partial<Record<keyof FormValues, string>> = {};
      for (const issue of validation.error.issues) {
        const field = (issue.path[0] === 'changes' ? issue.path[1] : issue.path[0]) as keyof FormValues;
        if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    const changes = changedFields(baseline, validation.data.changes);
    if (Object.keys(changes).length === 0) {
      setMessage('Change at least one trade field.');
      return;
    }

    submitting.current = true;
    setSaving(true);
    setMessage('');
    setErrors({});
    try {
      const amended = await tradeApi.amend(baseline.id, { ...validation.data, changes });
      onAmended(amended);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
      } else if (error instanceof ApiError && error.status === 409 && error.code === 'TRADE_CONFLICT') {
        const result = amendTradeConflictSchema.safeParse(error.responseBody);
        if (result.success && result.data.currentTrade.id === baseline.id) setConflict(result.data.currentTrade);
        else setMessage('Unable to read the current trade. Refresh trades before trying again.');
      } else if (error instanceof ApiError && [400, 403, 404, 413, 415].includes(error.status)) {
        setMessage(error.message);
      } else {
        setMessage('The outcome is unconfirmed. Your draft is kept; check the latest trade before trying again.');
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section ref={panel} tabIndex={-1} aria-labelledby="amend-title" className="mx-4 mb-4 rounded-xl border border-blue-200 bg-slate-50 p-4 focus-visible:outline-2 focus-visible:outline-blue-700 sm:mx-6 sm:p-6">
      <h2 id="amend-title" className="text-lg font-semibold text-slate-950">Amend {baseline.symbol}</h2>
      <p className="mt-1 break-all text-xs text-slate-600">Trade {baseline.id} · Version {baseline.version} · Ticker is fixed.</p>
      {currentTrade && (
        <div role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
          <p>{cancelled ? 'This trade has been cancelled and can no longer be amended.' : 'This trade has changed. Your draft is preserved. Load latest replaces it with the current trade.'}</p>
          {!cancelled && <button type="button" disabled={saving} className={buttonClass + ' mt-2 border border-amber-400'} onClick={loadLatest}>Load latest</button>}
        </div>
      )}
      {message && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{message}</p>}
      <form aria-label="Amend trade" onSubmit={(event) => { void submit(event); }} noValidate>
        <fieldset disabled={saving || cancelled} className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ['quantity', 'Quantity', 'text'], ['price', 'Price (USD)', 'text'],
            ['tradeDate', 'Execution time (UTC)', 'datetime-local'],
            ['book', 'Book', 'text'], ['counterparty', 'Counterparty', 'text'],
          ] as const).map(([field, label, type]) => (
            <div key={field} className="text-sm font-medium text-slate-700">
              <label htmlFor={'amend-' + field}>{label}</label>
              <input id={'amend-' + field} className={inputClass} type={type} value={values[field]}
                step={type === 'datetime-local' ? '0.001' : undefined}
                inputMode={field === 'quantity' || field === 'price' ? 'decimal' : undefined}
                maxLength={field === 'book' ? 64 : field === 'counterparty' ? 120 : 32}
                aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? 'amend-' + field + '-error' : undefined}
                onChange={(event) => update(field, event.target.value)} />
              {errors[field] && <span id={'amend-' + field + '-error'} className="mt-1 block text-sm text-red-800">{errors[field]}</span>}
            </div>
          ))}
          <label className="text-sm font-medium text-slate-700">
            Side
            <select className={inputClass} value={values.side} onChange={(event) => update('side', event.target.value)}>
              <option value="BUY">Buy</option><option value="SELL">Sell</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-3">
            Reason (optional)
            <textarea className={inputClass + ' py-2'} value={values.reason} maxLength={500} rows={2}
              aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? 'amend-reason-error' : undefined}
              onChange={(event) => update('reason', event.target.value)} />
            {errors.reason && <span id="amend-reason-error" className="mt-1 block text-sm text-red-800">{errors.reason}</span>}
          </label>
        </fieldset>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="submit" disabled={saving || currentTrade !== null} className={buttonClass + ' bg-blue-700 text-white hover:bg-blue-800'}>
            {saving ? 'Saving changes…' : 'Save changes'}
          </button>
          <button type="button" disabled={saving} onClick={onDiscard} className={buttonClass + ' border border-slate-300 text-slate-800'}>Discard changes</button>
        </div>
      </form>
    </section>
  );
}
