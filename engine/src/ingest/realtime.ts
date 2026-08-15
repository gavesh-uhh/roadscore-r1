/**
 * The Supabase Realtime ingest path — the engine's LATENCY path.
 *
 * ENGINE-PLAN §3: "Realtime provides *latency*; the sweeper provides
 * *completeness*." Everything in this file is written on that premise. A row
 * missed here is not a data loss incident, it is a row the sweeper will pick up
 * within `SWEEPER_INTERVAL_MS`. What matters is that a miss is **loud** — a
 * silently dead channel looks identical to a quiet fleet, and the only symptom
 * would be event latency quietly rising from 200 ms to 5 s with nobody noticing.
 *
 * So this module's real job is not "deliver rows" (the sweeper guarantees that);
 * it is "deliver rows fast, and shout when it cannot".
 *
 * Known and accepted limitations of `postgres_changes`, all of which the sweeper
 * covers:
 *   * Messages are dropped on reconnect, on channel error and under load. There
 *     is no replay, no offset and no acknowledgement — it is fire-and-forget.
 *   * The payload is the row as WAL saw it, so `jsonb` arrives already parsed
 *     but `bigint` arrives as a JSON number (fine at telemetry-id magnitudes).
 *   * It fans out per subscriber and has a throughput ceiling; §3's scale path
 *     is broadcast-from-database or logical replication, and this module is
 *     behind `IngestSource` precisely so that is a one-file swap.
 */

import { createClient } from '@supabase/supabase-js';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../config/env.js';
import type { Logger } from '../util/log.js';
import type { IngestSource, RawRow } from '../types.js';

/** The env fields this source reads. Structural, so tests need not build a full `Env`. */
export type RealtimeEnv = Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>;

export interface RealtimeOptions {
  /** Table to subscribe to. Overridable for tests only. */
  table?: string;
  schema?: string;
  /** First reconnect delay, doubling to `maxBackoffMs`. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injected for tests — lets a fake channel stand in for the network. */
  client?: SupabaseClient;
}

export interface RealtimeStats {
  rowsDelivered: number;
  subscribes: number;
  channelErrors: number;
  timeouts: number;
  closes: number;
  handlerErrors: number;
  connected: boolean;
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/**
 * WAL payload → `RawRow`.
 *
 * Realtime hands back the row with `jsonb` columns already parsed and everything
 * else as JSON scalars. Missing columns are normalised to `null` rather than
 * `undefined` so the shape matches the sweeper's output byte-for-byte — the two
 * sources feed the same `normalizeRow`, and a difference between them would be a
 * bug that only appears when Realtime happens to win the race.
 */
export function realtimeRecordToRawRow(rec: Record<string, unknown>): RawRow | null {
  const id = toNum(rec['id']);
  const deviceId = rec['device_id'];
  if (!Number.isFinite(id) || typeof deviceId !== 'string') return null;

  const ts = rec['ts'];
  const recv = rec['server_received_at'];

  return {
    id,
    device_id: deviceId,
    ts: typeof ts === 'string' ? ts : null,
    uptime_ms: toNum(rec['uptime_ms']),
    seq: toNum(rec['seq']),
    samples: (rec['samples'] as number | null) ?? null,
    accel_raw: (rec['accel_raw'] ?? null) as RawRow['accel_raw'],
    accel_cal: (rec['accel_cal'] ?? null) as RawRow['accel_cal'],
    gyro_raw: (rec['gyro_raw'] ?? null) as RawRow['gyro_raw'],
    gyro_cal: (rec['gyro_cal'] ?? null) as RawRow['gyro_cal'],
    gps: (rec['gps'] ?? null) as RawRow['gps'],
    mic: (rec['mic'] ?? null) as RawRow['mic'],
    calibration: (rec['calibration'] ?? null) as RawRow['calibration'],
    wifi_rssi: (rec['wifi_rssi'] as number | null) ?? null,
    accel_fs_g: (rec['accel_fs_g'] as number | null) ?? null,
    gyro_fs_dps: (rec['gyro_fs_dps'] as number | null) ?? null,
    fw_version: (rec['fw_version'] as string | null) ?? null,
    dropped_posts: (rec['dropped_posts'] as number | null) ?? null,
    // Realtime delivers on commit, so a row with no `server_received_at` is
    // impossible in practice (the column is `not null default now()`). Falling
    // back to the epoch rather than to the local clock keeps this module free of
    // a wall-clock read, which is what lets a captured Realtime stream replay
    // identically.
    server_received_at: typeof recv === 'string' ? recv : new Date(0).toISOString(),
  };
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    if (typeof t.unref === 'function') t.unref();
    signal?.addEventListener('abort', done, { once: true });
    function done(): void {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
  });

export function createRealtimeSource(
  env: RealtimeEnv,
  log: Logger,
  options: RealtimeOptions = {},
): IngestSource & { stats: () => RealtimeStats } {
  const logger = log.child({ module: 'realtime' });
  const schema = options.schema ?? 'public';
  const table = options.table ?? 'telemetry';
  const baseBackoff = options.baseBackoffMs ?? 1_000;
  const maxBackoff = options.maxBackoffMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;

  const client =
    options.client ??
    createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        // A long-lived server process. There is no user, no browser storage to
        // persist into, and no refresh cycle worth running — leaving these on
        // makes the client try to write to a `localStorage` that does not exist.
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        // 1 Hz per device. The default of 10 events/s throttles a fleet of more
        // than ten devices, and a throttled Realtime path silently degrades into
        // "sweeper with extra steps".
        params: { eventsPerSecond: 100 },
      },
    });

  let onRow: ((row: RawRow) => Promise<void> | void) | null = null;
  let channel: RealtimeChannel | null = null;
  let stopped = false;
  let attempt = 0;
  let abort = new AbortController();
  /** Resolves when the current subscription ends, so the supervisor can retry. */
  let ended: (() => void) | null = null;

  const stats: RealtimeStats = {
    rowsDelivered: 0,
    subscribes: 0,
    channelErrors: 0,
    timeouts: 0,
    closes: 0,
    handlerErrors: 0,
    connected: false,
  };

  function endSubscription(): void {
    const fn = ended;
    ended = null;
    if (fn) fn();
  }

  /**
   * Subscribe once and resolve when the subscription ends for any reason.
   *
   * Every non-SUBSCRIBED state resolves the promise, which returns control to
   * the supervisor loop and triggers a backoff + resubscribe. supabase-js does
   * have its own socket-level reconnect, but it does not re-establish a channel
   * that the server has errored out, and it gives no signal we can log — so we
   * own the lifecycle rather than hoping.
   */
  function subscribeOnce(): Promise<void> {
    return new Promise<void>((resolve) => {
      ended = resolve;

      // Unique channel name per attempt. Reusing a name against a channel the
      // server still considers alive is a well-known way to get a silent
      // no-delivery subscription.
      const name = `roadscore:${table}:${stats.subscribes}`;
      stats.subscribes++;

      const ch = client
        .channel(name)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema, table },
          (payload: { new: Record<string, unknown> }) => {
            const row = realtimeRecordToRawRow(payload.new ?? {});
            if (!row) {
              logger.warn(
                { keys: Object.keys(payload.new ?? {}) },
                'realtime INSERT payload missing id/device_id; dropped (sweeper will recover it)',
              );
              return;
            }
            stats.rowsDelivered++;
            // Fire-and-forget with an explicit catch. Realtime's callback is not
            // awaited by the transport, so an unhandled rejection here would take
            // the whole process down on Node's default policy — and it would do
            // so for a row the sweeper is about to redeliver anyway.
            void (async () => {
              try {
                await onRow?.(row);
              } catch (err) {
                stats.handlerErrors++;
                logger.error(
                  { err, telemetryId: row.id, deviceId: row.device_id },
                  'realtime row handler threw; row dropped (sweeper will redeliver)',
                );
              }
            })();
          },
        )
        .subscribe((status: string, err?: Error) => {
          switch (status) {
            case 'SUBSCRIBED':
              stats.connected = true;
              attempt = 0;
              logger.info({ schema, table, channel: name }, 'realtime channel subscribed');
              return;

            case 'CHANNEL_ERROR':
              stats.connected = false;
              stats.channelErrors++;
              // LOUD, per §3. This is the state where rows are being dropped and
              // the engine's latency guarantee is gone; only the sweeper is
              // holding correctness up.
              logger.error(
                { err, channel: name, channelErrors: stats.channelErrors },
                'realtime CHANNEL_ERROR — rows are being dropped, falling back to sweeper latency',
              );
              break;

            case 'TIMED_OUT':
              stats.connected = false;
              stats.timeouts++;
              logger.error(
                { channel: name, timeouts: stats.timeouts },
                'realtime subscription TIMED_OUT — rows are being dropped, reconnecting',
              );
              break;

            case 'CLOSED':
              stats.connected = false;
              stats.closes++;
              // Expected during our own `stop()`; unexpected otherwise.
              if (stopped) {
                logger.info({ channel: name }, 'realtime channel closed');
              } else {
                logger.warn(
                  { channel: name, closes: stats.closes },
                  'realtime channel closed unexpectedly; reconnecting',
                );
              }
              break;

            default:
              logger.debug({ status, channel: name }, 'realtime status');
              return;
          }
          endSubscription();
        });

      channel = ch;
    });
  }

  return {
    async start(handler): Promise<void> {
      onRow = handler;
      stopped = false;
      abort = new AbortController();

      while (!stopped) {
        await subscribeOnce();
        if (stopped) break;

        // Remove the dead channel before retrying, or supabase-js accumulates
        // one zombie channel per reconnect and keeps heartbeating all of them.
        if (channel) {
          try {
            await client.removeChannel(channel);
          } catch (err) {
            logger.debug({ err }, 'removeChannel failed on a dead channel; ignoring');
          }
          channel = null;
        }

        attempt++;
        // Exponential backoff, capped. No jitter and none needed: a single
        // engine instance is not a thundering herd, and a deterministic delay is
        // one less thing to reason about in an incident. If this ever runs at
        // N replicas, add jitter here.
        const delay = Math.min(baseBackoff * 2 ** Math.min(attempt - 1, 5), maxBackoff);
        logger.warn(
          { attempt, delayMs: delay, ...stats },
          'realtime disconnected; backing off before resubscribe (sweeper still guarantees completeness)',
        );
        await sleep(delay, abort.signal);
      }
    },

    async stop(): Promise<void> {
      stopped = true;
      abort.abort();
      endSubscription();
      if (channel) {
        try {
          await client.removeChannel(channel);
        } catch (err) {
          logger.debug({ err }, 'removeChannel failed during stop; ignoring');
        }
        channel = null;
      }
      // Only tear the socket down if we own the client. A caller-injected one
      // may be shared with something else.
      if (!options.client) {
        try {
          await client.realtime.disconnect();
        } catch (err) {
          logger.debug({ err }, 'realtime disconnect failed; ignoring');
        }
      }
      stats.connected = false;
      logger.info({ ...stats }, 'realtime source stopped');
    },

    stats: () => ({ ...stats }),
  };
}
