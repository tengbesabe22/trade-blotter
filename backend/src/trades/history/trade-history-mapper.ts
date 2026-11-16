import type { Prisma } from '@trade-blotter/database';
import { tradeResponseSchema, type TradeResponse } from '../trade-contract';
import { tradeHistoryEntrySchema, type TradeHistoryChange, type TradeHistoryEntry } from './trade-history-contract';

export type TradeHistoryRecord = Prisma.TradeAuditGetPayload<{
  include: { actor: { select: { id: true; displayName: true } } };
}>;

const changeFields = ['side', 'quantity', 'price', 'book', 'counterparty', 'tradeDate', 'status'] as const;

/** Compares adjacent snapshots: e.g. v3 price 230 vs v2 price 227 produces one price change.
 * Returns [] for creation, or null when the immediately preceding version is missing.
 */
function describeChanges(
  current: TradeResponse,
  previous: TradeResponse | undefined,
): TradeHistoryChange[] | null {
  if (current.version === 1) return [];
  // For example, comparing v4 with v2 cannot tell us which edits happened in v4.
  if (!previous || previous.version !== current.version - 1) return null;

  return changeFields
    .filter((field) => current[field] !== previous[field])
    .map((field) => ({ field, before: previous[field], after: current[field] }));
}

export function toTradeHistoryEntries(rows: TradeHistoryRecord[]): TradeHistoryEntry[] {
  // JSONB is untyped at runtime. Validate saved snapshots before deriving changes.
  const snapshots = rows.map((row) => {
    const snapshot = tradeResponseSchema.parse(row.snapshot);
    if (snapshot.id !== row.tradeId || snapshot.version !== row.tradeVersion) {
      throw new Error('Audit snapshot does not match its trade and version.');
    }
    return snapshot;
  });

  return rows.map((row, index) => tradeHistoryEntrySchema.parse({
    id: row.id,
    tradeVersion: row.tradeVersion,
    action: row.action,
    actor: { id: row.actor.id, displayName: row.actor.displayName },
    reason: row.reason,
    recordedAt: row.recordedAt.toISOString(),
    snapshot: snapshots[index],
    changes: describeChanges(snapshots[index], snapshots[index + 1]),
  }));
}
