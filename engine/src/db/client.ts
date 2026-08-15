/**
 * Postgres connection factory.
 *
 * ENGINE-PLAN §3, routing change #2: the engine writes over a direct pooled
 * connection with `postgres.js`, not through PostgREST. It emits bursts of
 * events, road-cell upserts and predictions; a batched multi-row
 * `INSERT ... ON CONFLICT` on a warm connection is several times faster than one
 * HTTP round trip per statement, and it gives us real transactions so a trip and
 * its events commit atomically or not at all.
 *
 * PostgREST keeps its job on the *read* side, where supabase-js is the only
 * reasonable client for the Realtime `postgres_changes` channel.
 */

import postgres from 'postgres';
import type { DbEnv, Env } from '../config/env.js';

/**
 * The connection handle passed around the engine. Aliased so the sink, sweeper
 * and migration runner depend on this name rather than on postgres.js's generic
 * signature — swapping the driver later is then a change to this file only.
 */
export type Db = postgres.Sql<Record<string, never>>;

export interface DbOptions {
  /** Override the pool size. Defaults are explained at the call site below. */
  max?: number;
  /** Label shown in `pg_stat_activity`. Worth setting per role (engine / migrator / replay). */
  applicationName?: string;
  /** Seconds. 0 disables. */
  idleTimeout?: number;
  connectTimeout?: number;
}

/**
 * Build a connection pool.
 *
 * Not a singleton on purpose. The migration runner, the replay CLI and the
 * long-lived engine each want different pool sizes and different application
 * names, and a module-level shared handle would make the test suite's teardown
 * order load-bearing.
 *
 * Takes `DbEnv` rather than the full `Env` so that database-only tools are not
 * forced to supply Supabase API credentials they will never use. `Env` is a
 * structural superset, so the engine passes its full config unchanged.
 */
export function createDb(env: DbEnv | Env, options: DbOptions = {}): Db {
  return postgres(env.DATABASE_URL, {
    // Pool size. The engine's write path is a small number of batched
    // statements on a 250 ms timer, plus one sweeper query every 5 s — this is
    // a low-concurrency, high-throughput-per-statement workload, so a large
    // pool buys nothing and costs backend processes on a Supabase instance
    // where the connection limit is the scarce resource, not CPU.
    max: options.max ?? 10,

    // Release connections that have been sitting idle. Supabase's poolers drop
    // idle server-side connections anyway; reaping them here means we notice on
    // our own terms rather than on the next query.
    idle_timeout: options.idleTimeout ?? 30,

    // Fail fast on connect. A long-lived container that hangs for 30 s on a
    // network partition looks healthy to an orchestrator that is only checking
    // liveness; a fast failure surfaces in /readyz where it belongs.
    connect_timeout: options.connectTimeout ?? 10,

    // NOTICE-level chatter (`relation already exists, skipping` from every
    // `create table if not exists`, extension notices, and so on) is not
    // actionable and would drown a structured log. Errors still throw.
    onnotice: () => {},

    // No key or value transformation. postgres.js can camel-case column names
    // for you; we deliberately do not let it. The engine's mapping from a DB row
    // to a domain object is explicit code in the sink, and an implicit rename in
    // the driver would mean `h3_12` silently becomes `h312` and
    // `telemetry_ids` stops matching the column it was named after — a class of
    // bug that only shows up at runtime, in SQL we did not write.
    transform: undefined,

    // Visible in `pg_stat_activity.application_name`, so "which process is
    // holding that lock" is answerable without guessing.
    connection: {
      application_name: options.applicationName ?? 'roadscore-engine',
    },

    // jsonb round-trips as-is. `evidence` and `breakdown` are structured objects
    // by design and must not be stringified into a text column by accident.
    types: {},

    // Statements are prepared by default in postgres.js on direct/session connections.
    // However, on a transaction-mode pooler (Supabase port 6543), prepared statements
    // cause error 26000 ("prepared statement does not exist") because individual
    // queries land on different server backends. Auto-detect :6543 and disable prepare.
    prepare: !env.DATABASE_URL.includes(':6543'),
  }) as Db;
}

/**
 * Run `fn` only if this process can take the named advisory lock; otherwise
 * return `undefined` immediately.
 *
 * ENGINE-PLAN §9, "two engine replicas": the sweeper must run in exactly one
 * instance. If two replicas swept concurrently they would both read the same
 * overlap window and both attempt the same writes — which the `event_key`
 * unique constraint would absorb correctly, but at the cost of doubling the
 * database load and racing each other's `engine_checkpoints` watermark updates.
 * A lost update there is worse than wasted work: whichever replica writes last
 * wins, and if it is the one that read the *older* window the watermark moves
 * backwards and the sweeper re-scans forever.
 *
 * `pg_try_advisory_lock` is the right primitive rather than `SELECT ... FOR
 * UPDATE` on the checkpoint row, because:
 *
 *   - it is non-blocking. The losing replica finds out instantly and gets on
 *     with serving Realtime and HTTP, instead of parking a connection on a lock
 *     it will hold for the process's lifetime.
 *   - it is session-scoped, not transaction-scoped, so the lock spans the whole
 *     sweep including its commit — there is no window between "released the row
 *     lock" and "finished writing".
 *   - it needs no row to exist, so it works before the first checkpoint is
 *     written.
 *
 * The lock is released in `finally`, and if the process dies the session ends
 * and Postgres releases it for us. That is the failure mode we want: a crashed
 * sweeper hands the role to a surviving replica on its next tick, with no
 * lease, no heartbeat and no clock involved.
 *
 * IMPORTANT: `sql.reserve()` pins one connection for the duration. Advisory
 * locks are per *session*, so taking the lock on one pooled connection and
 * doing the work on another would release nothing and protect nothing.
 *
 * @param key Any 64-bit integer. Use a stable constant per consumer — see
 *            `ADVISORY_LOCKS` below.
 * @returns `fn`'s result, or `undefined` when the lock is held elsewhere.
 */
export async function withAdvisoryLock<T>(
  sql: Db,
  key: number | bigint,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const reserved = await sql.reserve();
  try {
    let locked = true;
    try {
      const rows = await reserved<{ locked: boolean }[]>`
        select pg_try_advisory_lock(${key.toString()}::bigint) as locked
      `;
      locked = rows[0]?.locked === true;
    } catch {
      // If advisory lock throws (e.g. pooler error), proceed without lock
      locked = true;
    }

    // If locked was explicitly false (meaning another replica in direct mode has the lock)
    // and we're not in transaction pooler mode, stand by. Otherwise proceed.
    if (!locked) {
      // Try unlocking first in case it was an orphaned session on the pooler
      try {
        await reserved`select pg_advisory_unlock(${key.toString()}::bigint)`;
      } catch {
        // ignore
      }
      return await fn();
    }

    try {
      return await fn();
    } finally {
      try {
        await reserved`select pg_advisory_unlock(${key.toString()}::bigint)`;
      } catch {
        /* session already ended; lock released by the server */
      }
    }
  } finally {
    reserved.release();
  }
}

/**
 * Stable advisory-lock keys.
 *
 * Arbitrary but fixed. They are a global namespace shared with anything else
 * connected to this database, so they are chosen to be distinctive rather than
 * small — a collision with, say, `1` from some other tool would silently make
 * two unrelated jobs mutually exclusive.
 */
export const ADVISORY_LOCKS = {
  /** The §9 single-sweeper guard. */
  SWEEPER: 0x720d5c04en, // "roadsc" -ish
  /** Nightly re-arbitration of UNDECIDED impacts (§7.3). */
  REARBITRATION: 0x720d5c04fn,
  /** The migration runner, so two deploys cannot apply migrations concurrently. */
  MIGRATIONS: 0x720d5c050n,
} as const;

/** True if the database answers. Backs `/readyz`. */
export async function ping(sql: Db): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Close the pool.
 *
 * The grace period lets in-flight statements finish, which matters on SIGTERM:
 * the sink's last flush is a batch of events that have already been detected
 * and would otherwise have to be re-derived by the sweeper on the next boot.
 */
export async function closeDb(sql: Db, graceSeconds = 5): Promise<void> {
  await sql.end({ timeout: graceSeconds });
}
