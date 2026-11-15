import pino, { type DestinationStream, type Logger } from 'pino';
import { z } from 'zod';

const logLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

export function createLogger(level = 'info', destination?: DestinationStream): Logger {
  const validation = logLevelSchema.safeParse(level);
  if (!validation.success) throw new Error('LOG_LEVEL must be a supported log level.');

  return pino({
    level: validation.data,
    base: { service: 'trade-blotter-api' }, // Omit host/device identifiers.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    // Call sites allowlist metadata. These known fields are a second line of defense.
    // Free-form messages are redacted too; use fixed event names instead.
    redact: {
      paths: [
        'msg', 'password', 'credentials', 'token', 'tokenHash', 'session', 'sessionId',
        'user', 'userId', 'tradeId', 'email', 'name', 'ip', 'userAgent', 'headers',
        'req', 'res', 'request', 'response', 'body', 'query', 'payload', 'trade',
        'summaries', 'reason', 'err', 'error', 'databaseUrl', 'DATABASE_URL',
      ],
      censor: '[REDACTED]',
    },
  }, destination);
}
