import { z } from 'zod';
import type { Logger } from 'pino';
import { createLogger } from '../../logging/logger';
import { errorMetadata } from '../../logging/error-metadata';
import { tradeResponseSchema } from '../trade-contract';
import type { OutboxRepository, PendingTradeEvent } from './outbox-repository';
import { tradeChangeSchema, type TradeChange } from '../sse/trade-stream-contract';

// Reasons stay in storage; only the trade and snapshots are public event data.
const tradePayloadSchema = z.object({
  trade: tradeResponseSchema,
  summaries: tradeChangeSchema.shape.summaries,
});

const BATCH_SIZE = 100;
const RETRY_BASE_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

type RelayerOptions = {
  now?: () => Date;
  logger?: Logger;
  onError?: (error: unknown) => void;
};

/** Validates the saved snapshot and checks that it belongs to this outbox row. */
function toTradeChange(event: PendingTradeEvent): TradeChange {
  const { trade, summaries } = tradePayloadSchema.parse(event.payload);
  const change = tradeChangeSchema.parse({
    changeId: event.id,
    type: event.type,
    occurredAt: event.createdAt.toISOString(),
    trade,
    summaries,
  });

  if (change.trade.id !== event.tradeId || change.trade.version !== event.tradeVersion) {
    throw new Error('Outbox trade identity/version mismatch.');
  }

  return change;
}

export function createOutboxRelayer(
  repository: OutboxRepository,
  broadcast: (change: TradeChange) => void,
  options: RelayerOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? createLogger('silent');
  const onError = options.onError ?? (() => {});
  let activeRun: Promise<void> | null = null;
  // A wake received during delivery asks the current run to check for more work.
  let wakeRequested = false;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleWake(delayMs: number) {
    if (stopped) return;

    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { void wake(); }, Math.max(0, delayMs));
    retryTimer.unref(); // A pending retry must not keep a stopped server alive.
  }

  /** Delivers one event, or saves its retry deadline before moving to the next event. */
  async function relayEvent(event: PendingTradeEvent): Promise<void> {
    // Capture the attempt before scheduleRetry increments the saved retry count.
    const metadata = { changeId: event.id, type: event.type, attempt: event.retries + 1 };
    let operation = 'validate_payload';

    try {
      const change = toTradeChange(event);

      operation = 'broadcast';
      broadcast(change);
      // Local hand-off, not browser acknowledgement. A crash before marking
      // can repeat delivery, so clients must merge by trade ID/version.
      operation = 'mark_published';
      await repository.markPublished(event.id, now());
    } catch (error) {
      // On failure, schedule a retry: 1, 2, 4, 8, 16, then at most 30 seconds.
      const backoffMs = Math.min(MAX_RETRY_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** event.retries);
      const nextAttemptAt = new Date(now().getTime() + backoffMs);
      await repository.scheduleRetry(
        event.id, nextAttemptAt,
        error instanceof Error ? error.name : 'RelayError',
      ).catch((retryError: unknown) => {
        logger.error({
          event: 'outbox.failed', operation: 'schedule_retry',
          ...metadata, ...errorMetadata(retryError),
        });
        throw retryError;
      });

      // Report a scheduled retry only after its database write succeeds.
      logger.warn({
        event: 'outbox.retry_scheduled', operation, ...metadata,
        nextAttemptAt: nextAttemptAt.toISOString(), ...errorMetadata(error),
      });
      return;
    }

    // Publication means local hand-off and bookkeeping, not browser acknowledgement.
    logger.debug({ event: 'outbox.published', ...metadata });
  }

  /** Drains eligible batches, then arms one timer for the earliest remaining retry. */
  async function relayPending(): Promise<void> {
    while (wakeRequested && !stopped) {
      wakeRequested = false;
      const events = await repository.listPending(now(), BATCH_SIZE).catch((error: unknown) => {
        logger.error({ event: 'outbox.failed', operation: 'list_pending', ...errorMetadata(error) });
        throw error;
      });

      for (const event of events) {
        if (stopped) return;

        await relayEvent(event);
      }

      // A full batch may have more eligible events behind it.
      if (events.length === BATCH_SIZE) wakeRequested = true;
    }

    if (stopped) return;

    // One timer for the earliest saved deadline; no pending work means no timer.
    const nextAttemptAt = await repository.findNextAttemptAt().catch((error: unknown) => {
      logger.error({ event: 'outbox.failed', operation: 'find_next_attempt', ...errorMetadata(error) });
      throw error;
    });
    if (nextAttemptAt) scheduleWake(nextAttemptAt.getTime() - now().getTime());
  }

  function wake(): Promise<void> {
    if (stopped) return Promise.resolve();

    // Foreground work can arrive before a retry is due; recompute its deadline afterward.
    clearTimeout(retryTimer);
    retryTimer = undefined;
    wakeRequested = true;
    // Concurrent callers share this run and request another check for new work.
    if (activeRun) return activeRun;

    activeRun = relayPending().catch((error: unknown) => {
      // Database failures may prevent saving/reading a deadline. Retry this failed run once.
      scheduleWake(RETRY_BASE_DELAY_MS);
      onError(error); // The failed operation already logged the error.
    }).finally(() => {
      activeRun = null;
      // Include a wake arriving between the last batch and this cleanup.
      if (wakeRequested && !stopped) void wake();
    });
    return activeRun;
  }

  function stop() {
    stopped = true;
    wakeRequested = false;
    clearTimeout(retryTimer);
  }

  return { wake, stop };
}
