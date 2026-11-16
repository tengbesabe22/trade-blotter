import type { SymbolSummary } from '../api/contracts/trades/trade-summary-contract';

// Snapshots are absolute: keep the newest revision per instrument, never add totals.
export function mergePositionSummaries(current: SymbolSummary[], incoming: SymbolSummary[]): SymbolSummary[] {
  const rows = new Map(current.map((row) => [row.instrumentId.toLowerCase(), row]));
  let changed = false;
  for (const row of incoming) {
    const key = row.instrumentId.toLowerCase();
    const existing = rows.get(key);
    if (existing && existing.version >= row.version) continue;
    rows.set(key, row);
    changed = true;
  }
  return changed ? [...rows.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)) : current;
}
