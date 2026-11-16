import { Writable } from 'node:stream';
import { createLogger } from '../../src/logging/logger';

// Capture real Pino output without writing to stdout or opening a database.
export function captureLogs(level = 'debug') {
  let output = '';
  const destination = new Writable({
    write: (chunk, _encoding, done) => {
      output += chunk.toString();
      done();
    },
  });

  return {
    logger: createLogger(level, destination),
    output: () => output,
    records: (): Record<string, unknown>[] => output.trim().split('\n')
      .filter(Boolean).map((line) => JSON.parse(line)),
  };
}
