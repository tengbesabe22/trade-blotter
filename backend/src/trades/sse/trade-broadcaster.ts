import type { TradeChange } from './trade-stream-contract';

const MAX_QUEUED_EVENTS = 100;

// One backend process fans out events without waiting for individual browsers.
export function createTradeBroadcaster() {
  const subscribers = new Set<ReadableStreamDefaultController<TradeChange>>();

  return {
    subscribe: () => {
      let controller: ReadableStreamDefaultController<TradeChange>;

      return new ReadableStream<TradeChange>({
        start: (subscriber) => {
          controller = subscriber;
          subscribers.add(controller);
        },
        cancel: () => { subscribers.delete(controller); },
      }, { highWaterMark: MAX_QUEUED_EVENTS });
    },

    broadcast: (change: TradeChange) => {
      for (const subscriber of subscribers) {
        if ((subscriber.desiredSize ?? 0) <= 0) {
          // Bound memory. This client must reconnect and fetch current state.
          subscribers.delete(subscriber);
          subscriber.error(new Error('Slow SSE client; reconnect to resynchronise.'));
          continue;
        }

        subscriber.enqueue(change);
      }
    },
  };
}

export type TradeBroadcaster = ReturnType<typeof createTradeBroadcaster>;
