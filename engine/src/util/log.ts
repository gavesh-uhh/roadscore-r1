/**
 * Logger factory.
 *
 * ENGINE-PLAN §5 stack table: `pino`. One factory so every module gets the same
 * level, the same redaction list and the same serialisers — a logger built
 * ad-hoc in one file is the one that eventually prints the service_role key.
 *
 * Pretty in development, newline-delimited JSON in production. The transport is
 * loaded *optionally*: `pino-pretty` is a development convenience and is not in
 * `dependencies`, so a production image that never installs it must still boot.
 * A hard `transport: { target: 'pino-pretty' }` throws at construction time when
 * the module is absent, which would turn a cosmetic preference into a crash loop.
 */

import { createRequire } from 'node:module';
import pino from 'pino';
import type { Logger, LoggerOptions } from 'pino';

export type { Logger };

/**
 * The slice of the environment the logger needs.
 *
 * Deliberately structural rather than `Env`: the migration runner and the
 * capture script hold a `DbEnv`, and demanding Supabase credentials from them
 * just to get a logger would be a false dependency (the same argument
 * `loadDbEnv` makes in config/env.ts).
 */
export interface LogEnv {
  LOG_LEVEL: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  NODE_ENV: 'development' | 'test' | 'production';
}

/**
 * Keys whose values are never printed, wherever they appear in a log object.
 *
 * `pino`'s redaction runs on the serialised object, so this also covers an
 * accidental `log.info({ env })` — which is exactly the accident worth
 * defending against, because `Env` contains a full-database credential.
 */
const REDACT = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'serviceRoleKey',
  'password',
  'apikey',
  'authorization',
  '*.SUPABASE_SERVICE_ROLE_KEY',
  '*.DATABASE_URL',
  'req.headers.authorization',
  'headers.authorization',
];

function prettyTransport(): LoggerOptions['transport'] | undefined {
  try {
    // `import.meta.resolve` is sync in Node 22 but throws on a missing module in
    // a way that differs between loaders; createRequire.resolve is stable.
    const require = createRequire(import.meta.url);
    require.resolve('pino-pretty');
  } catch {
    return undefined;
  }
  return {
    target: 'pino-pretty',
    options: {
      colorize: true,
      // Sortable, unambiguous, and short enough to leave room for the message.
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname',
      singleLine: false,
    },
  };
}

export function createLogger(env: LogEnv, bindings: Record<string, unknown> = {}): Logger {
  const pretty = env.NODE_ENV === 'development' ? prettyTransport() : undefined;

  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT, censor: '[redacted]' },
    base: { service: 'roadscore-engine', ...bindings },
    // ISO-8601 rather than pino's default epoch millis. The engine's whole
    // §2.6 story is about being honest which clock a timestamp came from; a log
    // line that has to be decoded before it can be compared to a `ts` value is
    // an obstacle during exactly the incident where you need it most.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      // `level: "info"` instead of `level: 30`. Costs nothing and makes the raw
      // JSON greppable without a decoder ring.
      level: (label) => ({ level: label }),
    },
  };

  if (pretty) options.transport = pretty;

  return pino(options);
}

/**
 * A logger that discards everything. For unit tests and the replay harness,
 * which must write *only* the golden JSON to stdout (§10 step 3).
 */
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
