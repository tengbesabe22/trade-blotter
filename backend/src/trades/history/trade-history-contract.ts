import { z } from 'zod';
import { tradeResponseSchema } from '../trade-contract';

const tradeVersionSchema = z.number().int().positive().max(2_147_483_647);
const timestampSchema = z.iso.datetime({ precision: 3 });

export const tradeHistoryIdSchema = z.uuid().transform((id) => id.toLowerCase());

export const tradeHistoryChangeSchema = z.strictObject({
  field: z.enum(['side', 'quantity', 'price', 'book', 'counterparty', 'tradeDate', 'status']),
  before: z.string().nullable(),
  after: z.string().nullable(),
})
  .refine(
    (change) => change.before !== change.after,
    'A change must have different values.',
  )
  .refine((change) => {
    const fieldSchema = tradeResponseSchema.shape[change.field];

    return fieldSchema.safeParse(change.before).success
      && fieldSchema.safeParse(change.after).success;
  }, 'Change values must match the trade field format.');

export type TradeHistoryChange = z.infer<typeof tradeHistoryChangeSchema>;

export const tradeHistoryEntrySchema = z.strictObject({
  id: z.uuid(),
  tradeVersion: tradeVersionSchema,
  action: z.enum(['CREATED', 'AMENDED', 'CANCELLED']),
  actor: z.strictObject({
    id: z.uuid(),
    displayName: z.string().min(1).max(120).refine((value) => value.trim().length > 0),
  }),
  reason: z.string().max(500).nullable(),
  recordedAt: timestampSchema,
  snapshot: tradeResponseSchema,
  // [] for creation; null means the preceding version is unavailable.
  changes: z.array(tradeHistoryChangeSchema).max(7).nullable(),
})
  .refine(
    (entry) => entry.snapshot.version === entry.tradeVersion,
    'Snapshot version must match the entry.',
  )
  .refine((entry) => {
    const expectedStatus = entry.action === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE';

    if (entry.snapshot.status !== expectedStatus) {
      return false;
    }

    if (entry.action === 'CREATED') {
      return entry.tradeVersion === 1
        && entry.reason === null
        && entry.changes?.length === 0;
    }

    // Later actions need changes unless their preceding snapshot is unavailable.
    return entry.tradeVersion > 1
      && (entry.changes === null || entry.changes.length > 0);
  }, 'Action must match the trade state and available changes.')
  .refine((entry) => {
    if (entry.changes === null) {
      return true;
    }

    const fields = entry.changes.map((change) => change.field);
    const hasUniqueFields = new Set(fields).size === fields.length;
    const matchesSnapshot = entry.changes.every(
      (change) => change.after === entry.snapshot[change.field],
    );

    return hasUniqueFields && matchesSnapshot;
  }, 'Changes must be unique fields matching the resulting snapshot.');

export type TradeHistoryEntry = z.infer<typeof tradeHistoryEntrySchema>;

// A single trade is expected to have a short history; return every retained entry.
export const tradeHistoryResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  generatedAt: timestampSchema,
  tradeId: z.uuid(),
  entries: z.array(tradeHistoryEntrySchema),
})
  .refine(
    (history) => history.entries.every((entry) => entry.snapshot.id === history.tradeId),
    'Entries must belong to this trade.',
  )
  .refine(
    (history) => history.entries.every((entry, index) =>
      index === 0 || history.entries[index - 1].tradeVersion > entry.tradeVersion),
    'Versions must be newest first without duplicates.',
  );

export type TradeHistoryResponse = z.infer<typeof tradeHistoryResponseSchema>;
