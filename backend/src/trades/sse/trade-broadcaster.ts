import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { createLogger } from '../../logging/logger';
import type { TradeChange } from './trade-stream-contract';

const MAX_QUEUED_EVENTS = 100;
type Subscriber = {
  connectionId: string;
  controller: ReadableStreamDefaultController<TradeChange>;
};

// A typed reason lets the route distinguish overflow from unexpected failures.
export class SlowSseClientError extends Error {
  constructor() {
    super('Slow SSE client; reconnect to resynchronise.');
    this.name = 'SlowSseClientError';
  }
}

// One backend process fans out events without waiting for individual browsers.
export function createTradeBroadcaster(logger: Logger = createLogger('silent')) {
  const subscribers = new Set<Subscriber>();

  return {
    subscribe: (connectionId = randomUUID()) => {
      let subscriber: Subscriber;

      return new ReadableStream<TradeChange>({
        start: (controller) => {
          subscriber = { connectionId, controller };
          subscribers.add(subscriber);
        },
        cancel: () => { subscribers.delete(subscriber); },
      }, { highWaterMark: MAX_QUEUED_EVENTS });
    },

    broadcast: (change: TradeChange) => {
      for (const subscriber of subscribers) {
        if ((subscriber.controller.desiredSize ?? 0) <= 0) {
          // Bound memory. This client must reconnect and fetch current state.
          subscribers.delete(subscriber);
          logger.warn({
            event: 'sse.slow_client_dropped',
            connectionId: subscriber.connectionId, queueLimit: MAX_QUEUED_EVENTS,
          });
          subscriber.controller.error(new SlowSseClientError());
          continue;
        }

        subscriber.controller.enqueue(change);
      }
    },
  };
}

export type TradeBroadcaster = ReturnType<typeof createTradeBroadcaster>;
