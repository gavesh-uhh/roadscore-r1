/**
 * Environment loading and validation.
 *
 * ENGINE-PLAN §11, Phase 0: "env/config with zod". The rule this file enforces
 * is that the process either has a complete, well-typed configuration or it
 * refuses to start — a long-lived container that boots with a missing
 * `SUPABASE_SERVICE_ROLE_KEY` and only discovers it on the first write is a
 * container that silently drops an hour of ingest.
 *
 * `loadEnv()` therefore throws once, with *every* problem listed, rather than
 * failing on the first one and making the operator play whack-a-mole across
 * three redeploys.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------
//
// Everything arriving from the environment is a string, including "8080" and
// "false". These helpers do the conversion *and* reject the values that
// `Number()` and truthiness would otherwise wave through — `Number('')` is 0
// and `Boolean('false')` is true, both of which are the kind of bug that only
// shows up in production.

/** A positive integer, given as a decimal string. */
function intVar(opts: { min?: number; max?: number } = {}) {
  const { min = 1, max = Number.MAX_SAFE_INTEGER } = opts;
  return z
    .string()
    .trim()
    .regex(/^-?\d+$/, 'must be an integer')
    .transform((s) => Number.parseInt(s, 10))
    .refine((n) => Number.isSafeInteger(n), 'must be a safe integer')
    .refine((n) => n >= min, `must be >= ${min}`)
    .refine((n) => n <= max, `must be <= ${max}`);
}

/** `true`/`false`/`1`/`0`/`yes`/`no`, case-insensitive. Anything else is an error. */
function boolVar() {
  return z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (s) => ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(s),
      "must be one of true/false/1/0/yes/no/on/off",
    )
    .transform((s) => ['true', '1', 'yes', 'on'].includes(s));
}

/**
 * A non-empty string, so `FOO=` is a failure rather than a silent empty value.
 *
 * `required_error` is set as well as `min(1)`: zod reports a plain "Required"
 * for an absent key and only reaches the `min` message when the key is present
 * but blank. Both paths need to say the same useful sentence, because "which
 * variable, and where do I get its value" is the entire job of this message.
 */
function requiredString(message: string) {
  return z
    .string({ required_error: message, invalid_type_error: message })
    .trim()
    .min(1, message);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const envSchema = z.object({
  // --- Supabase / Postgres -------------------------------------------------
  //
  // Two connections to the same project, on purpose (§3). The supabase-js
  // client exists only for the Realtime `postgres_changes` channel, which is
  // the one thing PostgREST does better than a raw connection. Every write goes
  // through `DATABASE_URL` with postgres.js, because the engine emits bursts of
  // events, road-cell upserts and predictions, and batched multi-row
  // `INSERT ... ON CONFLICT` on a pooled connection beats one HTTP round trip
  // per statement several times over — and gives us real transactions, so a
  // trip and its events commit atomically or not at all.
  SUPABASE_URL: requiredString('SUPABASE_URL is required (the https://<ref>.supabase.co project URL)').url(
    'must be a valid URL, e.g. https://abcdefgh.supabase.co',
  ),

  // service_role bypasses RLS. That is the point: the engine is the only writer
  // to the 002 tables and no client is ever allowed to be. It also means this
  // value is a full-database credential — it must never reach a browser bundle,
  // and it is the single most important thing in this file not to log.
  SUPABASE_SERVICE_ROLE_KEY: requiredString(
    'SUPABASE_SERVICE_ROLE_KEY is required (Project Settings → API → service_role). Never ship this to a client.',
  ),

  DATABASE_URL: requiredString('DATABASE_URL is required (postgres://... direct or pooled connection)').regex(
    /^postgres(ql)?:\/\//,
    'must start with postgres:// or postgresql://',
  ),

  // --- Process -------------------------------------------------------------
  PORT: intVar({ min: 1, max: 65535 }).default('8080'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- Sweeper (§3) --------------------------------------------------------
  //
  // The sweeper is the completeness guarantee, not a fallback: Realtime's
  // `postgres_changes` drops messages on reconnect, on channel error and under
  // load, so without this loop the engine's event stream has silent holes.
  SWEEPER_INTERVAL_MS: intVar({ min: 100 }).default('5000'),

  // The overlap that makes the watermark safe. `server_received_at` defaults to
  // `now()` = transaction START time, so rows commit out of order relative to
  // it and a strict `>` cursor permanently skips whatever committed late. We
  // re-scan this many seconds every sweep and de-duplicate on `id`. The floor of
  // 1 s is a guard against someone "optimising" this to 0 and reintroducing the
  // bug; it should comfortably exceed the longest insert transaction.
  SWEEPER_OVERLAP_S: intVar({ min: 1 }).default('10'),

  // Rows per sweep. Bounds the memory of one batch and the lock footprint of
  // one pass; the loop simply runs again if it filled the limit.
  SWEEPER_BATCH: intVar({ min: 1, max: 100_000 }).default('5000'),

  // --- Writer (§5) ---------------------------------------------------------
  //
  // The bottleneck is the DB write path, not detection — per row, detection is
  // single-digit microseconds. So the sink batches on whichever comes first:
  WRITER_FLUSH_MS: intVar({ min: 1 }).default('250'),
  WRITER_MAX_ROWS: intVar({ min: 1, max: 100_000 }).default('500'),

  // --- Feature flags -------------------------------------------------------
  //
  // Both ingest paths are independently switchable, which is what makes them
  // debuggable. Turning off Realtime leaves a pure sweeper engine — slower, but
  // provably complete, and the right configuration for a backfill run. Turning
  // off the sweeper isolates Realtime so its drop rate can actually be measured
  // rather than masked by the backfill quietly repairing it.
  ENABLE_REALTIME: boolVar().default('true'),
  ENABLE_SWEEPER: boolVar().default('true'),

  // --- State (§9, runaway state) -------------------------------------------
  //
  // Per-device state is ~11.5 KB of preallocated typed arrays. A device that
  // has gone quiet for this long is evicted, so a fleet that churns device ids
  // cannot grow the state map without bound. Must stay comfortably above the
  // trip-abandon timeout, or a device would be evicted mid-trip and its open
  // trip orphaned.
  DEVICE_STATE_TTL_MS: intVar({ min: 1000 }).default('1800000'), // 30 min
});

export type Env = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// .env support
// ---------------------------------------------------------------------------

/**
 * Load a `.env` file into `process.env` using Node 22's built-in loader.
 *
 * No dotenv dependency: `process.loadEnvFile` has been in Node since 20.6 and
 * this project targets 22. Guarded because the file is *optional* — in a
 * container the environment comes from the orchestrator and there is no `.env`
 * at all, and a missing file must not be fatal.
 *
 * Returns whether a file was actually loaded, so the caller can log it.
 */
export function loadDotEnv(path = '.env'): boolean {
  try {
    // Present since Node 20.6; typed as optional so a stale @types/node or a
    // non-Node runtime degrades to "no .env" rather than a TypeError.
    const loader = (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void })
      .loadEnvFile;
    if (typeof loader !== 'function') return false;
    loader(path);
    return true;
  } catch {
    // ENOENT is the overwhelmingly common case and is not an error. A malformed
    // .env also lands here; we stay silent because the validation below will
    // report the actual missing variables, which is the more useful message.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Aggregated error
// ---------------------------------------------------------------------------

/**
 * Thrown when configuration is incomplete or invalid. Carries every problem,
 * not just the first — see the file header for why that matters.
 */
export class EnvValidationError extends Error {
  readonly issues: { variable: string; message: string; received: string }[];

  constructor(issues: { variable: string; message: string; received: string }[]) {
    const lines = issues.map(
      (i) => `  - ${i.variable}: ${i.message}${i.received ? ` (received: ${i.received})` : ''}`,
    );
    super(
      `Invalid environment configuration — ${issues.length} problem${
        issues.length === 1 ? '' : 's'
      }:\n${lines.join('\n')}\n\nSee .env.example for the full list of variables and their defaults.`,
    );
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Variables whose values must never appear in an error message, a log line or a
 * stack trace. `received:` is redacted for these.
 */
const SECRET_VARS = new Set(['SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL']);

function describeReceived(name: string, raw: unknown): string {
  if (raw === undefined) return 'unset';
  if (SECRET_VARS.has(name)) return '<redacted>';
  const s = String(raw);
  if (s === '') return 'empty string';
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

// ---------------------------------------------------------------------------
// loadEnv
// ---------------------------------------------------------------------------

let cached: Env | null = null;

/**
 * Collect the raw candidate values, applying the `.env` file and the
 * empty-string-means-unset rule. Shared by `loadEnv` and `loadDbEnv`.
 */
function gatherSource(
  overrides: Record<string, string | undefined> | undefined,
  options: LoadEnvOptions,
): Record<string, string | undefined> {
  if (overrides !== undefined) {
    // An explicit override bag is used *instead of* the ambient environment,
    // not merged over it. A test that supplies a partial config wants to see
    // the resulting validation failure, not to silently inherit whatever the
    // CI runner happened to export.
    return overrides;
  }
  if (options.dotenv ?? true) loadDotEnv(options.dotenvPath ?? '.env');
  return process.env as Record<string, string | undefined>;
}

function compact(source: Record<string, string | undefined>): Record<string, string> {
  // Drop empty strings so zod's `.default()` applies. `FOO=` in a .env file and
  // an unset FOO mean the same thing to an operator, and they should mean the
  // same thing here — `requiredString` still rejects a blank value for the
  // variables that have no default.
  const input: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (typeof v === 'string' && v.trim() !== '') input[k] = v;
  }
  return input;
}

function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  input: Record<string, string>,
  source: Record<string, string | undefined>,
): z.infer<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map((issue) => {
    const name = issue.path.length > 0 ? String(issue.path[0]) : '(root)';
    return {
      variable: name,
      message: issue.message,
      received: describeReceived(name, source[name]),
    };
  });
  // Stable, alphabetical: the same broken config always produces the same
  // message, which makes it greppable in logs and diffable in test snapshots.
  issues.sort((a, b) => a.variable.localeCompare(b.variable));
  throw new EnvValidationError(issues);
}

export interface LoadEnvOptions {
  /** Read a `.env` file first. Off in tests so the developer's local file cannot leak in. */
  dotenv?: boolean;
  /** Path to the `.env` file. */
  dotenvPath?: string;
  /** Ignore the memoised value. */
  fresh?: boolean;
}

/**
 * Validate and return the process configuration.
 *
 * `overrides` exists for tests: pass an explicit bag of strings and this
 * function never touches `process.env` at all, which is what makes config
 * behaviour testable in-process without mutating global state that other tests
 * in the same worker can see.
 *
 *   loadEnv({ SUPABASE_URL: 'https://x.supabase.co', ... })
 *
 * When `overrides` is supplied the result is not memoised, for the same reason.
 */
export function loadEnv(
  overrides?: Record<string, string | undefined>,
  options: LoadEnvOptions = {},
): Env {
  const isExplicit = overrides !== undefined;

  if (!isExplicit && !options.fresh && cached) return cached;

  const source = gatherSource(overrides, options);
  const env = parseOrThrow(envSchema, compact(source), source);

  if (!isExplicit) cached = env;
  return env;
}

/**
 * The subset of the environment that only needs a database.
 *
 * The migration runner and the replay CLI talk to Postgres and never touch the
 * Realtime channel, so demanding `SUPABASE_URL` and the service_role key from
 * them is a false dependency — and a genuinely obstructive one, because it means
 * you cannot run migrations against a plain local Postgres or a CI container
 * without inventing two credentials that will never be used. This schema asks
 * for exactly what those tools need.
 */
export const dbEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  LOG_LEVEL: true,
  NODE_ENV: true,
});

export type DbEnv = z.infer<typeof dbEnvSchema>;

export function loadDbEnv(
  overrides?: Record<string, string | undefined>,
  options: LoadEnvOptions = {},
): DbEnv {
  const source = gatherSource(overrides, options);
  return parseOrThrow(dbEnvSchema, compact(source), source);
}

/** Drop the memoised environment. Tests only. */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * A one-line, secret-free summary for the startup log. Never print `Env`
 * directly — it holds the service_role key and the database password.
 */
export function describeEnv(env: Env): Record<string, string | number | boolean> {
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    supabaseHost: new URL(env.SUPABASE_URL).host,
    realtime: env.ENABLE_REALTIME,
    sweeper: env.ENABLE_SWEEPER,
    sweeperIntervalMs: env.SWEEPER_INTERVAL_MS,
    sweeperOverlapS: env.SWEEPER_OVERLAP_S,
    sweeperBatch: env.SWEEPER_BATCH,
    writerFlushMs: env.WRITER_FLUSH_MS,
    writerMaxRows: env.WRITER_MAX_ROWS,
    deviceStateTtlMs: env.DEVICE_STATE_TTL_MS,
  };
}
