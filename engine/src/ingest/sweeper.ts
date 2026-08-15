/**
 * The watermark sweeper — the engine's completeness guarantee.
 *
 * ENGINE-PLAN §3: "Realtime alone is not sufficient. `postgres_changes` is
 * best-effort: messages are dropped on reconnect, on channel error, and under
 * load. The sweeper is not optional belt-and-braces, it is the correctness
 * guarantee. Realtime provides *latency*; the sweeper provides *completeness*."
 *
 * It is also the recovery path in §9: while the engine is down, telemetry keeps
 * landing in Postgres, and on restart this loop backfills from
 * `engine_checkpoints` without anyone doing anything.
 *
 * =========================================================================
 * WHY A NAIVE `>` CURSOR SKIPS ROWS — the single most important comment here
 * =========================================================================
 *
 * `telemetry.server_received_at` is `timestamptz not null default now()`, and in
 * Postgres `now()` is `transaction_timestamp()`: the instant the transaction
 * STARTED, not the instant it committed. It is deliberately stable for the whole
 * transaction so that two statements in it agree on the time.
 *
 * The consequence is that rows commit OUT OF ORDER relative to the column that
 * timestamps them. Two concurrent inserts:
 *
 *      T1: BEGIN at 12:00:00.000 ── (slow: TLS renegotiation, a checkpoint
 *          stall, a lock wait, an ESP32 retry) ──────────── COMMIT 12:00:00.900
 *      T2:            BEGIN at 12:00:00.500 ── COMMIT 12:00:00.600
 *
 * T2's row is visible at .600 with `server_received_at = 12:00:00.500`.
 * T1's row is visible at .900 with `server_received_at = 12:00:00.000`.
 *
 * A sweep at 12:00:00.700 reads T2, sees max(server_received_at) = .500, and
 * stores that as its watermark. The next sweep asks for
 * `server_received_at > 12:00:00.500`. T1's row — now visible, timestamped .000
 * — is behind the cursor. It is not late, it is INVISIBLE, permanently, and
 * nothing in the system will ever report it missing. The engine simply produces
 * slightly wrong scores forever.
 *
 * This is not a rare race. It is the normal behaviour of any table whose
 * timestamp default is `now()`, and it gets worse under exactly the load where
 * you most need the sweeper.
 *
 * The fix (§3, verbatim):
 *
 *     select * from telemetry
 *     where server_received_at > $watermark - interval '10 seconds'
 *     order by server_received_at
 *     limit 5000;
 *
 * Re-scan a 10 s overlap every sweep and de-duplicate on `id` through a bounded
 * LRU set. The overlap must exceed the longest plausible insert transaction; 10 s
 * is generous for a 1 Hz device on an HTTP POST, and `SWEEPER_OVERLAP_S` is
 * floored at 1 in env.ts specifically so nobody can "optimise" it to zero and
 * silently reintroduce this bug.
 *
 * Two further properties make the overlap free rather than merely safe:
 *   * `telemetry_recv_idx` (migration 001) turns the scan into a bounded index
 *     range scan instead of a full table scan repeated every 5 seconds.
 *   * `driving_events.event_key` is UNIQUE (migration 002), so even if a
 *     duplicate row escapes the LRU, the event it produces collapses onto the
 *     existing row instead of double-counting a penalty.
 *
 * Ordering caveat, stated rather than papered over: `order by server_received_at`
 * is ARRIVAL order, and §2.6 insists that per-device processing order is
 * `(device_id, boot_id, seq)`. The sweeper does not sort by `seq`, because it
 * cannot — a global `order by` on arrival time is what the index supports and
 * what bounds the scan. Per-device re-ordering is the router's job, and the ring
 * carries `seq` so a detector can see a discontinuity. Within one device at 1 Hz
 * arrival order and `seq` order coincide almost always; when they do not, §9's
 * deferred re-process queue is the designed answer.
 */

import type { Db } from '../db/client.js';
import { ADVISORY_LOCKS, withAdvisoryLock } from '../db/client.js';
import type { Env } from '../config/env.js';
import type { Logger } from '../util/log.js';
import type { IngestSource, RawRow } from '../types.js';
import { BoundedIdSet } from './lru.js';

/** `engine_checkpoints.consumer` for this loop. Seeded by migration 002. */
export const SWEEPER_CONSUMER = 'sweeper';

/** The env fields the sweeper reads. Structural, so tests need not build a full `Env`. */
export type SweeperEnv = Pick<
  Env,
  'SWEEPER_INTERVAL_MS' | 'SWEEPER_OVERLAP_S' | 'SWEEPER_BATCH'
>;

export interface SweeperOptions {
  /** Ids retained for dedupe. Must comfortably exceed rows-per-overlap-window. */
  dedupeCap?: number;
  /**
   * Skip the advisory lock. Only for a single-process replay/backfill where the
   * caller knows no other replica exists — never in the long-lived engine.
   */
  skipLock?: boolean;
  /** Injected for tests, so a sweep can be driven deterministically. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface SweepStats {
  sweeps: number;
  rowsRead: number;
  rowsDelivered: number;
  duplicatesDropped: number;
  errors: number;
  lockContended: number;
  lastWatermark: string | null;
  lastId: number | null;
}

/** Row shape as it comes back from Postgres. jsonb blocks arrive already parsed. */
interface TelemetryRow {
  id: string | number;
  device_id: string;
  ts: Date | string | null;
  uptime_ms: string | number;
  seq: string | number;
  samples: number | null;
  accel_raw: unknown;
  accel_cal: unknown;
  gyro_raw: unknown;
  gyro_cal: unknown;
  gps: unknown;
  mic: unknown;
  calibration: unknown;
  wifi_rssi: number | null;
  server_received_at: Date | string;
  [k: string]: unknown;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * `bigint` columns come back from postgres.js as strings — deliberately, since
 * `Number` silently loses precision past 2^53. `telemetry.id` will not reach
 * that this decade, and every downstream consumer (the LRU, `telemetry_ids`,
 * the JSONL capture) wants a number, so the conversion happens once, here.
 */
function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

function toRawRow(r: TelemetryRow): RawRow {
  return {
    id: toNum(r.id),
    device_id: r.device_id,
    ts: toIso(r.ts),
    uptime_ms: toNum(r.uptime_ms),
    seq: toNum(r.seq),
    samples: r.samples ?? null,
    accel_raw: (r.accel_raw ?? null) as RawRow['accel_raw'],
    accel_cal: (r.accel_cal ?? null) as RawRow['accel_cal'],
    gyro_raw: (r.gyro_raw ?? null) as RawRow['gyro_raw'],
    gyro_cal: (r.gyro_cal ?? null) as RawRow['gyro_cal'],
    gps: (r.gps ?? null) as RawRow['gps'],
    mic: (r.mic ?? null) as RawRow['mic'],
    calibration: (r.calibration ?? null) as RawRow['calibration'],
    wifi_rssi: r.wifi_rssi ?? null,
    // Firmware asks #1/#4/#6: columns may not exist yet. `?? null` rather than a
    // required read, so the engine works against both schemas.
    accel_fs_g: (r['accel_fs_g'] as number | null) ?? null,
    gyro_fs_dps: (r['gyro_fs_dps'] as number | null) ?? null,
    fw_version: (r['fw_version'] as string | null) ?? null,
    dropped_posts: (r['dropped_posts'] as number | null) ?? null,
    server_received_at: toIso(r.server_received_at) ?? new Date(0).toISOString(),
  };
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    // Do not hold the event loop open on a timer the process is done with.
    if (typeof t.unref === 'function') t.unref();
    signal?.addEventListener('abort', done, { once: true });
    function done(): void {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
  });

export function createSweeperSource(
  db: Db,
  env: SweeperEnv,
  log: Logger,
  options: SweeperOptions = {},
): IngestSource & { stats: () => SweepStats; sweepOnce: () => Promise<number> } {
  const sleep = options.sleep ?? defaultSleep;
  // Default cap covers ~20× a 1 000-device fleet's 10 s overlap window.
  const seen = new BoundedIdSet(options.dedupeCap ?? 200_000);
  const logger = log.child({ module: 'sweeper' });

  let running = false;
  let stopped = false;
  let loopDone: Promise<void> | null = null;
  let onRow: ((row: RawRow) => Promise<void> | void) | null = null;
  // Cuts the inter-sweep sleep short on `stop()`. Without it a SIGTERM waits out
  // the full interval — or the full 60 s error backoff — before the process can
  // exit, which an orchestrator reads as a hung container and SIGKILLs.
  let abort = new AbortController();

  const stats: SweepStats = {
    sweeps: 0,
    rowsRead: 0,
    rowsDelivered: 0,
    duplicatesDropped: 0,
    errors: 0,
    lockContended: 0,
    lastWatermark: null,
    lastId: null,
  };

  /**
   * Read the checkpoint.
   *
   * Migration 002 seeds `('sweeper', now() - interval '1 hour')`, so the row
   * normally exists. If it does not — a database migrated by hand, or a consumer
   * name that has never run — we start one hour back rather than at the epoch.
   * Starting at the epoch on a table with months of history would replay
   * everything on first boot; one hour is enough to cover a rolling deploy and
   * is bounded regardless of table size.
   */
  async function readCheckpoint(): Promise<{ watermark: Date; lastId: number | null }> {
    const rows = await db<{ watermark: Date; last_id: string | null }[]>`
      select watermark, last_id
      from public.engine_checkpoints
      where consumer = ${SWEEPER_CONSUMER}
    `;
    const row = rows[0];
    if (!row) {
      const fallback = new Date(Date.now() - 3_600_000);
      logger.warn(
        { consumer: SWEEPER_CONSUMER, watermark: fallback.toISOString() },
        'no sweeper checkpoint row; starting one hour back',
      );
      return { watermark: fallback, lastId: null };
    }
    return {
      watermark: row.watermark,
      lastId: row.last_id === null ? null : toNum(row.last_id),
    };
  }

  /**
   * Advance the checkpoint.
   *
   * `greatest(watermark, excluded.watermark)` is not decoration. §9 warns that a
   * lost update here is worse than wasted work: if a stale writer moved the
   * watermark backwards the sweeper would re-scan the same window forever and
   * never catch up to live. The advisory lock should make concurrent writers
   * impossible; this is the belt to its braces, and it costs nothing.
   */
  async function writeCheckpoint(watermark: Date, lastId: number | null): Promise<void> {
    await db`
      insert into public.engine_checkpoints (consumer, watermark, last_id, updated_at)
      values (${SWEEPER_CONSUMER}, ${watermark}, ${lastId}, now())
      on conflict (consumer) do update set
        watermark  = greatest(public.engine_checkpoints.watermark, excluded.watermark),
        last_id    = excluded.last_id,
        updated_at = now()
    `;
    stats.lastWatermark = watermark.toISOString();
    stats.lastId = lastId;
  }

  /**
   * One pass. Returns the number of rows READ (not delivered), so the caller can
   * tell a full batch — meaning "there is more, go again immediately" — from a
   * partial one.
   */
  async function sweepOnce(): Promise<number> {
    const { watermark, lastId: prevId } = await readCheckpoint();

    // The overlap window. See the header for why `>` alone loses rows.
    const from = new Date(watermark.getTime() - env.SWEEPER_OVERLAP_S * 1000);

    const rows = await db<TelemetryRow[]>`
      select *
      from public.telemetry
      where server_received_at > ${from}
      order by server_received_at
      limit ${env.SWEEPER_BATCH}
    `;

    stats.sweeps++;
    stats.rowsRead += rows.length;
    if (rows.length === 0) return 0;

    let maxRecv = watermark;
    let maxId = prevId;
    let delivered = 0;
    let dupes = 0;

    for (const r of rows) {
      const recv = r.server_received_at instanceof Date
        ? r.server_received_at
        : new Date(String(r.server_received_at));
      if (recv.getTime() > maxRecv.getTime()) maxRecv = recv;

      const id = toNum(r.id);
      if (!Number.isFinite(id)) {
        logger.warn({ row: r.id }, 'telemetry row with unparseable id; skipping');
        continue;
      }
      if (maxId === null || id > maxId) maxId = id;

      if (!seen.addIfNew(id)) {
        dupes++;
        continue;
      }

      if (onRow) await onRow(toRawRow(r));
      delivered++;
    }

    stats.rowsDelivered += delivered;
    stats.duplicatesDropped += dupes;

    // Checkpoint AFTER delivery, never before. If the process dies mid-batch the
    // watermark has not moved and the next boot re-reads the whole window — at
    // worst duplicated work, which the LRU and `event_key` both absorb. The
    // opposite order would lose rows on every crash, which nothing absorbs.
    await writeCheckpoint(maxRecv, maxId);

    logger.debug(
      {
        read: rows.length,
        delivered,
        duplicates: dupes,
        watermark: maxRecv.toISOString(),
        overlapS: env.SWEEPER_OVERLAP_S,
      },
      'sweep complete',
    );

    return rows.length;
  }

  /** One tick: take the lock, drain as long as batches come back full. */
  async function tick(): Promise<void> {
    const work = async (): Promise<void> => {
      // Drain rather than sweep-once-per-interval. After an outage the backlog
      // can be hours deep, and waiting `SWEEPER_INTERVAL_MS` between 5 000-row
      // batches would make recovery take longer than the outage did. Bounded so
      // one tick cannot monopolise the loop indefinitely.
      for (let i = 0; i < 100 && !stopped; i++) {
        const read = await sweepOnce();
        if (read < env.SWEEPER_BATCH) return;
      }
      logger.warn('sweeper still behind after 100 batches; continuing next tick');
    };

    if (options.skipLock) {
      await work();
      return;
    }

    // §9: exactly one replica sweeps. `pg_try_advisory_lock` is non-blocking, so
    // the losing replica finds out instantly and gets on with Realtime and HTTP
    // instead of parking a connection on a lock it would hold for the process's
    // whole lifetime.
    const result = await withAdvisoryLock(db, ADVISORY_LOCKS.SWEEPER, work);
    if (result === undefined) {
      stats.lockContended++;
      // Loud on the first contention, quiet afterwards: in a two-replica deploy
      // this is the steady state and would otherwise be a log line every 5 s
      // forever.
      if (stats.lockContended === 1) {
        logger.info('sweeper advisory lock held by another replica; standing by');
      } else {
        logger.debug({ contended: stats.lockContended }, 'sweeper lock still held elsewhere');
      }
    }
  }

  async function loop(): Promise<void> {
    // Consecutive-failure backoff. A DB that is down does not get hammered every
    // 5 s, and an operator sees a bounded, obviously-degraded log rather than a
    // firehose.
    let consecutiveErrors = 0;

    while (!stopped) {
      try {
        await tick();
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        stats.errors++;
        // §3 says the sweeper is the correctness guarantee, so its failures are
        // never debug-level. A sweeper that is silently dead looks exactly like
        // a healthy engine until the scores come out wrong.
        logger.error(
          { err, consecutiveErrors, totalErrors: stats.errors },
          'sweep failed; telemetry backfill is stalled',
        );
      }

      const backoff =
        consecutiveErrors === 0
          ? env.SWEEPER_INTERVAL_MS
          : Math.min(env.SWEEPER_INTERVAL_MS * 2 ** Math.min(consecutiveErrors, 5), 60_000);
      if (stopped) break;
      await sleep(backoff, abort.signal);
    }
  }

  return {
    async start(handler): Promise<void> {
      if (running) throw new Error('sweeper already started');
      running = true;
      stopped = false;
      abort = new AbortController();
      onRow = handler;
      logger.info(
        {
          intervalMs: env.SWEEPER_INTERVAL_MS,
          overlapS: env.SWEEPER_OVERLAP_S,
          batch: env.SWEEPER_BATCH,
        },
        'sweeper started',
      );
      loopDone = loop();
      // Resolves when the loop exits, i.e. after `stop()`. `start` is the
      // lifetime of the source, matching `IngestSource`'s contract.
      await loopDone;
    },

    async stop(): Promise<void> {
      stopped = true;
      running = false;
      abort.abort();
      if (loopDone) {
        await loopDone.catch(() => {});
        loopDone = null;
      }
      logger.info({ ...stats, lru: seen.stats }, 'sweeper stopped');
    },

    stats: () => ({ ...stats }),
    sweepOnce,
  };
}
