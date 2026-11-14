import { useRef, useState, type SubmitEvent } from 'react';
import { ApiError } from '../api/api-client';
import { tradeApi } from '../api/trade-api';
import { createTradeRequestSchema, type CreateTradeRequest } from '../api/trade-create-contract';
import type { Trade } from '../api/trade-contract';

type CreateTradeFormProps = {
  onCreated: (trade: Trade) => void;
  onSessionExpired: () => void;
};

function emptyForm() {
  return {
    symbol: '',
    side: 'BUY',
    quantity: '',
    price: '',
    tradeDate: new Date().toISOString().slice(0, 19), book: '', counterparty: '',
  };
}

type FormValues = ReturnType<typeof emptyForm>;
const inputClass = 'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:bg-slate-100';
const buttonClass = 'min-h-11 rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-50';

export function CreateTradeForm({ onCreated, onSessionExpired }: CreateTradeFormProps) {
  const [values, setValues] = useState(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  // Retry the exact request/key after an uncertain response.
  const attempt = useRef<{ key: string; input: CreateTradeRequest } | null>(null);
  const submitting = useRef(false);

  function update(field: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setMessage('');
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    if (!attempt.current) {
      const executionTime = new Date(values.tradeDate + 'Z');
      const validation = createTradeRequestSchema.safeParse({
        ...values,
        tradeDate: Number.isFinite(executionTime.getTime()) ? executionTime.toISOString() : '',
      });
      if (!validation.success) {
        const fieldErrors: Partial<Record<keyof FormValues, string>> = {};
        for (const issue of validation.error.issues) {
          const field = issue.path[0] as keyof FormValues;
          if (field && !fieldErrors[field]) fieldErrors[field] = issue.message;
        }
        setErrors(fieldErrors);
        return;
      }

      attempt.current = { key: crypto.randomUUID(), input: validation.data };
    }

    submitting.current = true;
    setSaving(true);
    setMessage('');

    try {
      const trade = await tradeApi.create(attempt.current.input, attempt.current.key);
      attempt.current = null;
      setUncertain(false);
      setSuccess('Trade created: ' + trade.symbol + ' · ' + trade.id);
      setValues(emptyForm());
      onCreated(trade);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return;
      }

      const definiteRejection = error instanceof ApiError && [400, 403, 409, 413, 415].includes(error.status);
      if (definiteRejection) {
        attempt.current = null;
        setUncertain(false);
        setMessage(error.code === 'UNKNOWN_INSTRUMENT'
          ? 'Choose a seeded instrument, for example AAPL or MSFT.'
          : error.message);
      } else {
        setUncertain(true);
        setMessage('The outcome is unconfirmed. Retry trade to safely check the same submission.');
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section aria-label="Create a trade" className="flex-1 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      {success && <p role="status" className="mb-3 text-sm text-emerald-800">{success}</p>}
      <form onSubmit={(event) => { void submit(event); }} noValidate>
        <h2 className="text-lg font-semibold text-slate-950">Create trade</h2>
        <p className="mt-1 text-sm text-slate-600">USD equities · Execution time is entered in UTC.</p>
        {message && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{message}</p>}
        <fieldset disabled={saving || uncertain} className="mt-4 grid gap-4 grid-cols-2">
          {([
            ['symbol', 'Ticker', 'text', 'AAPL'],
            ['quantity', 'Quantity', 'text', '100'],
            ['price', 'Price (USD)', 'text', '227.4500'],
            ['tradeDate', 'Execution time (UTC)', 'datetime-local', ''],
            ['book', 'Book', 'text', 'Optional'],
            ['counterparty', 'Counterparty', 'text', 'Optional'],
          ] as const).map(([field, label, type, placeholder]) => (
            <label key={field} className={'text-sm font-medium text-slate-700' + (field === 'tradeDate' ? ' col-span-2' : '')}>
              {label}
              <input className={inputClass} type={type} value={values[field]}
                placeholder={placeholder} step={type === 'datetime-local' ? '1' : undefined}
                inputMode={field === 'quantity' || field === 'price' ? 'decimal' : undefined}
                maxLength={field === 'symbol' ? 12 : field === 'book' ? 64 : field === 'counterparty' ? 120 : 32}
                aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? field + '-error' : undefined}
                onChange={(event) => update(field, event.target.value)} />
              {errors[field] && <span id={field + '-error'} className="mt-1 block text-sm text-red-800">{errors[field]}</span>}
            </label>
          ))}
          <label className="text-sm font-medium text-slate-700">
            Side
            <select className={inputClass} value={values.side} onChange={(event) => update('side', event.target.value)}>
              <option value="BUY">Buy</option><option value="SELL">Sell</option>
            </select>
          </label>
        </fieldset>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="submit" disabled={saving} className={buttonClass + ' bg-blue-700 text-white hover:bg-blue-800'}>
            {saving ? 'Saving trade…' : uncertain ? 'Retry trade' : 'Create trade'}
          </button>
          <button type="button" disabled={saving || uncertain} className={buttonClass + ' border border-slate-300 text-slate-800'}
            onClick={() => { setValues(emptyForm()); setErrors({}); setMessage(''); setSuccess(''); }}>
            Reset form
          </button>
        </div>
      </form>
    </section>
  );
}
