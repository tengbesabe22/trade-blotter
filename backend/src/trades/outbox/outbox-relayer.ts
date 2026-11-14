import { z } from 'zod';
import { tradeResponseSchema } from '../trade-contract';
import type { OutboxRepository } from './outbox-repository';
import { tradeChangeSchema, type TradeChange } from '../sse/trade-stream-contract';

// Reasons stay in storage; only the trade and snapshots are public event data.
const tradePayloadSchema = z.object({
  trade: tradeResponseSchema,
  summaries: tradeChangeSchema.shape.summaries,
});

const BATCH_SIZE = 100;
const RETRY_BASE_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

type RelayerOptions = { now?: () => Date; onError?: (error: unknown) => void };

export function createOutboxRelayer(
  repository: OutboxRepository,
  broadcast: (change: TradeChange) => void,
  options: RelayerOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const onError = options.onError ?? (() => {
    console.error('Outbox relay failed; pending events will be retried on a later wake.');
  });
  let activeRun: Promise<void> | null = null;
  let wakeRequested = false;

  async function relayPending() {
    while (wakeRequested) {
      wakeRequested = false;
      const events = await repository.listPending(now(), BATCH_SIZE);

      for (const event of events) {
        try {
          const { trade, summaries } = tradePayloadSchema.parse(event.payload);
          const change = tradeChangeSchema.parse({
            changeId: event.id, type: event.type,
            occurredAt: event.createdAt.toISOString(), trade, summaries,
          });
          if (change.trade.id !== event.tradeId || change.trade.version !== event.tradeVersion) {
            throw new Error('Outbox trade identity/version mismatch.');
          }

          broadcast(change);
          // Local hand-off, not browser acknowledgement. A crash before marking
          // can repeat delivery, so clients must merge by trade ID/version.
          await repository.markPublished(event.id, now());
        } catch (error) {
          // On failure, schedule a retry: 1, 2, 4, 8, 16, then at most 30 seconds.
          const backoffMs = Math.min(MAX_RETRY_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** event.retries);
          await repository.scheduleRetry(
            event.id, new Date(now().getTime() + backoffMs),
            error instanceof Error ? error.name : 'RelayError',
          );
        }
      }

      // A full batch may have more eligible events behind it.
      if (events.length === BATCH_SIZE) wakeRequested = true;
    }
  }

  function wake(): Promise<void> {
    wakeRequested = true;
    // Concurrent callers share this run and request another check for new work.
    if (activeRun) return activeRun;

    activeRun = relayPending().catch(onError).finally(() => {
      activeRun = null;
      // Include a wake arriving between the last batch and this cleanup.
      if (wakeRequested) void wake();
    });
    return activeRun;
  }

  return { wake };
}
