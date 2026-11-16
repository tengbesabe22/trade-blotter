import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { ApiError } from '../../api/api-client';
import { cancelTradeConflictSchema, cancelTradeRequestSchema } from '../../api/contracts/trades/trade-cancel-contract';
import { tradeApi } from '../../api/trades/trade-api';
import type { Trade } from '../../api/contracts/trades/trade-contract';

type CancelTradePanelProps = {
  trade: Trade;
  latestTrade?: Trade;
  onCancelled: (trade: Trade) => void;
  onClose: () => void;
  onSessionExpired: () => void;
};

const buttonClass = 'min-h-11 rounded-lg px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-50';

export function CancelTradePanel({ trade, latestTrade, onCancelled, onClose, onSessionExpired }: CancelTradePanelProps) {
  // The target/version change only after explicit review, never because SSE arrived.
  const [baseline, setBaseline] = useState(trade);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState<Trade | null>(null);
  const submitting = useRef(false);
  const panel = useRef<HTMLElement>(null);

  let currentTrade = conflict;
  if (latestTrade && latestTrade.version > baseline.version && latestTrade.version > (currentTrade?.version ?? 0)) {
    currentTrade = latestTrade;
  }
  const cancelled = baseline.status === 'CANCELLED' || currentTrade?.status === 'CANCELLED';

  useEffect(() => {
    panel.current?.focus();
    panel.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  function reviewLatest() {
    if (!currentTrade || cancelled) return;
    setBaseline(currentTrade);
    setConflict(null);
    setMessage('');
    setUncertain(false);
    // Keep the reason; reviewing new details is separate from confirming cancellation.
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || currentTrade || cancelled) return;

    const validation = cancelTradeRequestSchema.safeParse({ expectedVersion: baseline.version, reason });
    if (!validation.success) {
      setReasonError(validation.error.issues[0]?.message ?? 'Provide a valid cancellation reason.');
      return;
    }

    submitting.current = true;
    setSaving(true);
    setMessage('');
    setReasonError('');
    setUncertain(false);
    try {
      const result = await tradeApi.cancel(baseline.id, validation.data);
      onCancelled(result);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
      } else if (error instanceof ApiError && error.status === 409 && error.code === 'TRADE_CONFLICT') {
        const result = cancelTradeConflictSchema.safeParse(error.responseBody);
        if (result.success && result.data.currentTrade.id === baseline.id) setConflict(result.data.currentTrade);
        else setMessage('Unable to read the current trade. Refresh trades before trying again.');
      } else if (error instanceof ApiError && [400, 403, 404, 413, 415].includes(error.status)) {
        setMessage(error.message);
      } else {
        setUncertain(true);
        setMessage('The outcome is unconfirmed. Your reason is kept; check the latest trade before trying again.');
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <section ref={panel} tabIndex={-1} aria-labelledby="cancel-title" className="flex-1 rounded-xl border border-red-200 bg-white p-4 focus-visible:outline-2 focus-visible:outline-red-700 sm:p-6">
      <h2 id="cancel-title" className="text-lg font-semibold text-slate-950">Cancel {baseline.symbol} trade?</h2>
      <p className="mt-1 break-all text-xs text-slate-600">Trade {baseline.id} · Version {baseline.version}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        {([
          ['Side', baseline.side], ['Quantity', baseline.quantity], ['Price (USD)', baseline.price],
          ['Execution time (UTC)', baseline.tradeDate.replace('T', ' ').replace('Z', '')],
        ] as const).map(([label, value]) => (
          <div key={label}><dt className="text-slate-600">{label}</dt><dd className="break-words font-medium text-slate-950">{value}</dd></div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-slate-700">The trade will remain in the blotter as CANCELLED. This cannot be undone here.</p>
      {cancelled ? (
        <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">This trade is already cancelled. No further action is needed.</p>
      ) : currentTrade && (
        <div role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
          <p>This trade has changed. Review latest before confirming cancellation.</p>
          <button type="button" disabled={saving} onClick={reviewLatest} className={buttonClass + ' mt-2 border border-amber-400'}>Review latest</button>
        </div>
      )}
      {message && !cancelled && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{message}</p>}
      <form aria-label="Cancel trade" aria-busy={saving} onSubmit={(event) => { void submit(event); }} noValidate>
        <label htmlFor="cancel-reason" className="mt-4 block text-sm font-medium text-slate-700">Reason (optional)</label>
        <textarea id="cancel-reason" value={reason} maxLength={500} rows={2} disabled={saving || cancelled}
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-red-700 disabled:bg-slate-100"
          aria-invalid={Boolean(reasonError)} aria-describedby={reasonError ? 'cancel-reason-error' : undefined}
          onChange={(event) => { setReason(event.target.value); setReasonError(''); if (!uncertain) setMessage(''); }} />
        {reasonError && <p id="cancel-reason-error" className="mt-1 text-sm text-red-800">{reasonError}</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="submit" disabled={saving || cancelled || currentTrade !== null} className={buttonClass + ' bg-red-700 text-white hover:bg-red-800'}>
            {saving ? 'Cancelling trade…' : 'Confirm cancellation'}
          </button>
          <button type="button" disabled={saving} onClick={onClose} className={buttonClass + ' border border-slate-300 text-slate-800'}>
            {cancelled || uncertain ? 'Close' : 'Keep trade'}
          </button>
        </div>
      </form>
    </section>
  );
}
