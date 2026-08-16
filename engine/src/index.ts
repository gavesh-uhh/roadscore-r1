/**
 * Engine entrypoint — ENGINE-PLAN §3.
 *
 *   ESP32 ──HTTPS/PostgREST──▶ public.telemetry ──┐
 *                                                 │ (a) Realtime postgres_changes
 *                                                 │ (b) watermark sweeper (backfill)
 *                                                 ▼
 *                                    roadscore-engine (this process)
 *
 * Both ingest paths run together, by design. §3: "Realtime provides *latency*; the
 * sweeper provides *completeness*." Neither is redundant — `postgres_changes` drops
 * messages on reconnect and under load, and the sweeper is the correctness
 * guarantee that makes those drops survivable.
 */

import { loadEnv } from './config/env.js';
import type { Env } from './config/env.js';
import { THRESHOLDS, RULE_VERSION } from './config/thresholds.js';
import { createDb, closeDb } from './db/client.js';
import type { Db } from './db/client.js';
import { createLogger } from './util/log.js';
import type { Logger } from './util/log.js';
import { createRealtimeSource } from './ingest/realtime.js';
import { createSweeperSource } from './ingest/sweeper.js';
import { createMergedSource } from './ingest/source.js';
import { PgSink } from './sink/writer.js';
import { Pipeline } from './pipeline.js';
import { startServer } from './http/server.js';
import { RoadMap } from './arbitrate/roadmap.js';
import { groupForRollup, rollupDaily } from './score/rollup.js';
import type { TripScoreInput } from './score/rollup.js';
import type { ScorableEvent } from './score/penalties.js';
import type { DeviceMeta, IngestSource, RoadCell, RoadDefect, Trip } from './types.js';

/** Load the static `device_id → vehicle_id → driver_id` mapping (§1 scope). */
async function loadDevices(sql: Db, log: Logger): Promise<Map<string, DeviceMeta>> {
  const rows = await sql<
    {
      device_id: string;
      vehicle_id: string | null;
      driver_id: string | null;
      accel_fs_g: string | number;
      gyro_fs_dps: string | number;
      active: boolean;
    }[]
  >`select device_id, vehicle_id, driver_id, accel_fs_g, gyro_fs_dps, active from devices`;

  const map = new Map<string, DeviceMeta>();
  for (const r of rows) {
    map.set(r.device_id, {
      deviceId: r.device_id,
      vehicleId: r.vehicle_id,
      driverId: r.driver_id,
      // numeric comes back as a string from postgres.js; Number() it here so the
      // unit conversion in §2.1 never silently does string arithmetic.
      accelFsG: Number(r.accel_fs_g),
      gyroFsDps: Number(r.gyro_fs_dps),
      active: r.active,
    });
  }
  log.info({ devices: map.size }, 'device registry loaded');
  return map;
}

/** Rehydrate the fleet road map so arbitration works from the first row. */
async function loadRoadMap(sql: Db, cfg: typeof THRESHOLDS, log: Logger): Promise<RoadMap> {
  const map = new RoadMap(cfg);
  const rows = await sql<
    {
      h3_12: string;
      heading_sector: number;
      centroid_lat: number | null;
      centroid_lon: number | null;
      pass_count: number;
      device_count: number;
      spike_count: number;
      rough_mean: string | number | null;
      rough_m2: string | number | null;
      roughness_index: string | number | null;
      defect_confidence: string | number | null;
      speed_p85_kmh: string | number | null;
      last_pass_at: Date | null;
    }[]
  >`select * from road_cells`;

  const cells: (RoadCell & { deviceIds?: string[] })[] = rows.map((r) => ({
    h3_12: r.h3_12,
    headingSector: r.heading_sector,
    centroidLat: r.centroid_lat,
    centroidLon: r.centroid_lon,
    passCount: r.pass_count,
    deviceCount: r.device_count,
    spikeCount: r.spike_count,
    roughMean: Number(r.rough_mean ?? 0),
    roughM2: Number(r.rough_m2 ?? 0),
    roughnessIndex: r.roughness_index === null ? null : Number(r.roughness_index),
    defectConfidence: Number(r.defect_confidence ?? 0),
    lastPassAt: r.last_pass_at === null ? null : r.last_pass_at.getTime() / 1000,
    speedP85Kmh: r.speed_p85_kmh === null ? null : Number(r.speed_p85_kmh),
    // `device_count` is persisted but the identities are not: the set would be
    // unbounded. On restart the count is trusted and new devices add to it.
    deviceIds: [],
  }));

  map.load(cells);
  log.info({ cells: cells.length }, 'road map loaded');
  return map;
}

async function loadDefects(sql: Db, log: Logger): Promise<RoadDefect[]> {
  const rows = await sql<
    {
      id: string;
      h3_12: string;
      heading_sector: number;
      lat: number | null;
      lon: number | null;
      confidence: string | number;
      severity: string;
      distinct_devices: number;
      spike_rate: string | number;
      first_seen: Date | null;
      last_seen: Date | null;
      status: string;
    }[]
  >`select * from road_defects where status = 'active'`;

  const defects = rows.map((r) => ({
    id: r.id,
    h3_12: r.h3_12,
    headingSector: r.heading_sector,
    lat: r.lat,
    lon: r.lon,
    confidence: Number(r.confidence),
    severity: r.severity as RoadDefect['severity'],
    distinctDevices: r.distinct_devices,
    spikeRate: Number(r.spike_rate),
    firstSeen: (r.first_seen?.getTime() ?? 0) / 1000,
    lastSeen: (r.last_seen?.getTime() ?? 0) / 1000,
    status: r.status as RoadDefect['status'],
  }));
  log.info({ defects: defects.length }, 'active road defects loaded');
  return defects;
}

async function runDailyRollup(db: Db, sink: PgSink, cfg: typeof THRESHOLDS, log: Logger): Promise<void> {
  try {
    const tripRows = await db<
      {
        id: string;
        device_id: string;
        vehicle_id: string | null;
        driver_id: string | null;
        started_at: Date;
        ended_at: Date | null;
        status: string;
        distance_m: string | number;
        duration_s: string | number | null;
        idle_s: string | number | null;
        gps_coverage: string | number | null;
        max_speed_kmh: string | number | null;
        avg_speed_kmh: string | number | null;
      }[]
    >`
      select id, device_id, vehicle_id, driver_id, started_at, ended_at, status,
             distance_m, duration_s, idle_s, gps_coverage, max_speed_kmh, avg_speed_kmh
      from trips
      where ended_at is not null and ended_at >= now() - interval '48 hours'
    `;

    if (tripRows.length === 0) return;

    const tripIds = tripRows.map((t) => t.id);
    const eventRows = await db<
      {
        trip_id: string | null;
        type: string;
        category: string;
        severity: string;
        confidence: string | number;
        attributed_to_driver: boolean;
        severity_censored: boolean;
        event_key: string | null;
        id: string;
      }[]
    >`
      select trip_id, type, category, severity, confidence, attributed_to_driver, severity_censored, event_key, id
      from driving_events
      where trip_id in ${db(tripIds)}
    `;

    const eventsByTrip = new Map<string, ScorableEvent[]>();
    for (const e of eventRows) {
      if (!e.trip_id) continue;
      const list = eventsByTrip.get(e.trip_id) ?? [];
      list.push({
        type: e.type as any,
        category: e.category as any,
        severity: e.severity as any,
        confidence: Number(e.confidence),
        attributedToDriver: e.attributed_to_driver,
        severityCensored: e.severity_censored,
        eventKey: e.event_key ?? undefined,
        id: e.id,
      });
      eventsByTrip.set(e.trip_id, list);
    }

    const tripInputs: TripScoreInput[] = tripRows.map((r) => {
      const trip: Trip = {
        id: r.id,
        deviceId: r.device_id,
        vehicleId: r.vehicle_id,
        driverId: r.driver_id,
        bootId: '',
        startedAt: r.started_at.getTime() / 1000,
        endedAt: r.ended_at ? r.ended_at.getTime() / 1000 : null,
        startLat: null,
        startLon: null,
        endLat: null,
        endLon: null,
        status: r.status as Trip['status'],
        distanceM: Number(r.distance_m),
        durationS: r.duration_s === null ? null : Number(r.duration_s),
        movingS: 0,
        idleS: r.idle_s === null ? 0 : Number(r.idle_s),
        maxSpeedKmh: r.max_speed_kmh === null ? 0 : Number(r.max_speed_kmh),
        speedSumKmh: 0,
        speedSamples: 0,
        avgSpeedKmh: r.avg_speed_kmh === null ? null : Number(r.avg_speed_kmh),
        telemetryFrom: null,
        telemetryTo: null,
        gpsFixRows: 0,
        totalRows: 0,
        gpsCoverage: r.gps_coverage === null ? null : Number(r.gps_coverage),
      };
      const events = eventsByTrip.get(r.id) ?? [];
      return { trip, events };
    });

    const groups = groupForRollup(tripInputs);
    for (const group of groups.values()) {
      const score = rollupDaily(group, cfg, RULE_VERSION);
      sink.enqueueScore(score);
    }
    await sink.flush();
    log.info({ rollupsComputed: groups.size }, 'daily scores rollup completed');
  } catch (err) {
    log.error({ err }, 'failed to compute daily score rollups');
  }
}

async function main(): Promise<void> {
  const env: Env = loadEnv();
  const log = createLogger(env, { service: 'roadscore-engine' });
  const cfg = {
    ...THRESHOLDS,
    ...(env.DEMO_MODE ? { demoMode: true } : {}),
  };

  log.info(
    { nodeEnv: env.NODE_ENV, ruleVersion: cfg.version, demoMode: cfg.demoMode, realtime: env.ENABLE_REALTIME, sweeper: env.ENABLE_SWEEPER },
    'starting',
  );

  const db = createDb(env);
  const sink = new PgSink(db, log, {
    flushMs: env.WRITER_FLUSH_MS,
    maxRows: env.WRITER_MAX_ROWS,
  });

  const devices = await loadDevices(db, log);
  if (devices.size === 0) {
    log.warn('no devices registered — every incoming row will be rejected until `devices` is seeded');
  }

  const map = await loadRoadMap(db, cfg, log);
  const pipeline = new Pipeline({ cfg, sink, log, devices, map, stateTtlMs: env.DEVICE_STATE_TTL_MS });
  pipeline.loadDefects(await loadDefects(db, log));

  // Periodic device registry and defect refresh (every 5s)
  const syncTimer = setInterval(async () => {
    try {
      const latestDevices = await loadDevices(db, log);
      pipeline.updateDeviceRegistry(latestDevices);
      const latestDefects = await loadDefects(db, log);
      pipeline.updateDefects(latestDefects);
    } catch (err) {
      log.error({ err }, 'failed to periodically sync devices and defects');
    }
  }, 5_000);

  // Periodic idle device / stale trip reaper (every 10s)
  const evictTimer = setInterval(async () => {
    try {
      const closed = pipeline.evictStale();
      if (closed.length > 0) {
        await sink.flush();
        log.info({ closedTrips: closed.length }, 'evicted stale idle devices and finalized trips');
      }
    } catch (err) {
      log.error({ err }, 'failed to run periodic stale device eviction');
    }
  }, 10_000);

  // Periodic daily rollup runner (every 5 minutes)
  const rollupTimer = setInterval(async () => {
    await runDailyRollup(db, sink, cfg, log);
  }, 300_000);

  // Run initial rollup on boot
  void runDailyRollup(db, sink, cfg, log);

  // --- ingest ---------------------------------------------------------------
  const sources: IngestSource[] = [];
  if (env.ENABLE_REALTIME) sources.push(createRealtimeSource(env, log));
  if (env.ENABLE_SWEEPER) sources.push(createSweeperSource(db, env, log));

  if (sources.length === 0) {
    log.warn('both ingest paths are disabled — the engine will process nothing');
  }

  // Dedupe across the two paths: the same row legitimately arrives twice, once
  // from Realtime and once inside the sweeper's 10 s overlap window (§3).
  const source = createMergedSource(sources, 200_000);

  let ingestStarted = false;
  const server = await startServer({
    pipeline,
    db,
    log,
    port: env.PORT,
    isReady: () => ingestStarted,
  });

  // --- shutdown -------------------------------------------------------------
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    try {
      clearInterval(syncTimer);
      clearInterval(evictTimer);
      clearInterval(rollupTimer);
      await source.stop();
      // Close open trips and flush everything still buffered, so a redeploy does
      // not lose the last 250 ms of derived events.
      await pipeline.shutdown();
      await sink.close();
      await server.close();
      await closeDb(db);
      log.info({ stats: pipeline.stats.rowsAccepted }, 'shutdown complete');
      process.exit(0);
    } catch (err) {
      log.error({ err }, 'unclean shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception');
    void shutdown('uncaughtException');
  });

  ingestStarted = true;
  await source.start((row) => pipeline.submit(row));
}

main().catch((err) => {
  // No logger guaranteed at this point — env validation may be what failed.
  console.error('fatal startup error:', err);
  process.exit(1);
});
