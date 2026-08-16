#!/usr/bin/env node
/**
 * Cron / Maintenance Runner — ENGINE-PLAN §3, §7.3, §8, §11 Phase 5.
 *
 *   npx tsx scripts/maintenance.ts            run all periodic maintenance tasks
 *   npx tsx scripts/maintenance.ts --rollup   only refresh telemetry_rollup_1m
 *   npx tsx scripts/maintenance.ts --scores   only calculate daily score rollups
 *   npx tsx scripts/maintenance.ts --arbitrate only run road-defect re-arbitration
 *
 * Responsibilities:
 *   1. Incrementally refresh `telemetry_rollup_1m` (§3 routing change #3).
 *   2. Run retroactive re-arbitration on undecided road impact candidates (§7.3).
 *   3. Roll up driver and device daily scores and persist to `scores` table (§8).
 */

import { loadDbEnv, EnvValidationError } from '../src/config/env.js';
import { createDb, closeDb, ADVISORY_LOCKS } from '../src/db/client.js';
import type { Db } from '../src/db/client.js';
import { THRESHOLDS, RULE_VERSION } from '../src/config/thresholds.js';
import { rollupDaily, groupForRollup, type TripScoreInput } from '../src/score/rollup.js';
import { cellToLatLng } from 'h3-js';
import type { Trip } from '../src/types.js';

interface MaintenanceArgs {
  rollup: boolean;
  scores: boolean;
  arbitrate: boolean;
  hours: number;
  help: boolean;
}

function parseArgs(argv: string[]): MaintenanceArgs {
  const args: MaintenanceArgs = {
    rollup: false,
    scores: false,
    arbitrate: false,
    hours: 24,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;

    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--rollup') args.rollup = true;
    else if (a === '--scores') args.scores = true;
    else if (a === '--arbitrate') args.arbitrate = true;
    else if (a === '--hours') args.hours = Number(argv[++i]);
  }

  // If no specific flag set, run all tasks
  if (!args.rollup && !args.scores && !args.arbitrate) {
    args.rollup = true;
    args.scores = true;
    args.arbitrate = true;
  }

  return args;
}

const USAGE = `
Usage: npx tsx scripts/maintenance.ts [options]

  --rollup     refresh telemetry_rollup_1m table
  --scores     roll up daily scores for drivers/devices
  --arbitrate  run retroactive road defect re-arbitration
  --hours <n>  lookback window in hours (default: 24)
  -h, --help   show this message
`.trim();

/** Task 1: Refresh telemetry 1-minute rollup */
async function refreshRollup(db: Db, hours: number): Promise<number> {
  const from = new Date(Date.now() - hours * 3600 * 1000);
  const to = new Date();

  console.log(`[maintenance] Refreshing telemetry_rollup_1m from ${from.toISOString()} to ${to.toISOString()}...`);
  const res = await db<{ refresh_telemetry_rollup_1m: number }[]>`
    select public.refresh_telemetry_rollup_1m(${from}, ${to})
  `;
  const updated = res[0]?.refresh_telemetry_rollup_1m ?? 0;
  console.log(`[maintenance] telemetry_rollup_1m: ${updated} bucket(s) updated`);
  return updated;
}

/** Task 2: Retroactive re-arbitration for road defect candidates (§7.3) */
async function reArbitrateDefects(db: Db): Promise<number> {
  console.log('[maintenance] Running retroactive road defect re-arbitration...');

  // Find active road defects with updated consensus
  const defects = await db<
    {
      h3_12: string;
      heading_sector: number;
      centroid_lat: number | null;
      centroid_lon: number | null;
      pass_count: number;
      device_count: number;
      spike_count: number;
      roughness_index: number | null;
      defect_confidence: number;
    }[]
  >`
    select h3_12, heading_sector, centroid_lat, centroid_lon, pass_count, device_count, spike_count, roughness_index, defect_confidence
    from road_cells
    where device_count >= 3
  `;

  let promoted = 0;
  for (const c of defects) {
    const spikeRate = c.pass_count > 0 ? c.spike_count / c.pass_count : 0;
    if (spikeRate >= THRESHOLDS.arbitration.roadSpikeRate) {
      let lat = c.centroid_lat;
      let lon = c.centroid_lon;
      if (lat === null || lon === null) {
        try {
          const coords = cellToLatLng(c.h3_12);
          lat = coords[0];
          lon = coords[1];
        } catch {
          lat = null;
          lon = null;
        }
      }

      await db`
        insert into road_defects (
          h3_12, heading_sector, lat, lon, confidence, severity, distinct_devices, spike_rate, first_seen, last_seen, status
        )
        values (
          ${c.h3_12}, ${c.heading_sector}, ${lat}, ${lon}, ${c.defect_confidence},
          ${spikeRate > 0.8 ? 'high' : 'medium'},
          ${c.device_count}, ${spikeRate}, now(), now(), 'active'
        )
        on conflict (h3_12, heading_sector) do update set
          lat = coalesce(excluded.lat, road_defects.lat),
          lon = coalesce(excluded.lon, road_defects.lon),
          confidence = excluded.confidence,
          distinct_devices = excluded.distinct_devices,
          spike_rate = excluded.spike_rate,
          last_seen = now()
      `;
      promoted++;
    }
  }

  console.log(`[maintenance] Re-arbitrated defects: ${promoted} defect(s) updated/promoted`);
  return promoted;
}

/** Task 3: Roll up daily scores for closed trips (§8) */
async function rollupScores(db: Db, hours: number): Promise<number> {
  console.log(`[maintenance] Computing daily score rollups for the last ${hours} hours...`);

  const fromDate = new Date(Date.now() - hours * 3600 * 1000);

  // Fetch closed trips in the window
  const tripRows = await db<
    {
      id: string;
      device_id: string;
      driver_id: string | null;
      vehicle_id: string | null;
      boot_id: string;
      started_at: Date;
      ended_at: Date | null;
      start_lat: number | null;
      start_lon: number | null;
      end_lat: number | null;
      end_lon: number | null;
      distance_m: number;
      duration_s: number | null;
      moving_s: number;
      idle_s: number;
      max_speed_kmh: number | null;
      avg_speed_kmh: number | null;
      telemetry_from: string | null;
      telemetry_to: string | null;
      gps_coverage: string | number | null;
      status: string;
    }[]
  >`
    select * from trips
    where started_at >= ${fromDate} and status = 'closed'
  `;

  if (tripRows.length === 0) {
    console.log('[maintenance] No closed trips found in window');
    return 0;
  }

  // Fetch all driving events associated with these trips
  const tripIds = tripRows.map((t) => t.id);
  const eventRows = await db<
    {
      id: string;
      trip_id: string;
      type: string;
      category: string;
      severity: string;
      confidence: string | number;
      attributed_to_driver: boolean;
      severity_censored: boolean;
      event_key: string;
    }[]
  >`
    select id, trip_id, type, category, severity, confidence, attributed_to_driver, severity_censored, event_key
    from driving_events
    where trip_id = any(${tripIds})
  `;

  const eventsByTrip = new Map<string, ScorableEvent[]>();
  for (const e of eventRows) {
    const list = eventsByTrip.get(e.trip_id) ?? [];
    list.push({
      type: e.type as ScorableEvent['type'],
      category: e.category as ScorableEvent['category'],
      severity: e.severity as ScorableEvent['severity'],
      confidence: Number(e.confidence),
      attributedToDriver: e.attributed_to_driver,
      severityCensored: e.severity_censored,
      eventKey: e.event_key,
    });
    eventsByTrip.set(e.trip_id, list);
  }

  const tripInputs: TripScoreInput[] = tripRows.map((t) => {
    const tripObj: Trip = {
      id: t.id,
      deviceId: t.device_id,
      driverId: t.driver_id,
      vehicleId: t.vehicle_id,
      bootId: t.boot_id,
      startedAt: t.started_at.getTime() / 1000,
      endedAt: t.ended_at ? t.ended_at.getTime() / 1000 : null,
      startLat: t.start_lat,
      startLon: t.start_lon,
      endLat: t.end_lat,
      endLon: t.end_lon,
      distanceM: Number(t.distance_m),
      durationS: t.duration_s,
      movingS: t.moving_s,
      idleS: t.idle_s,
      maxSpeedKmh: t.max_speed_kmh === null ? 0 : Number(t.max_speed_kmh),
      speedSumKmh: 0,
      speedSamples: 0,
      avgSpeedKmh: t.avg_speed_kmh,
      telemetryFrom: t.telemetry_from ? Number(t.telemetry_from) : null,
      telemetryTo: t.telemetry_to ? Number(t.telemetry_to) : null,
      gpsFixRows: 0,
      totalRows: 0,
      gpsCoverage: t.gps_coverage !== null ? Number(t.gps_coverage) : null,
      status: t.status as Trip['status'],
    };
    return {
      trip: tripObj,
      events: eventsByTrip.get(t.id) ?? [],
    };
  });

  const groups = groupForRollup(tripInputs);
  let savedScores = 0;

  for (const group of groups.values()) {
    const score = rollupDaily(group, THRESHOLDS, RULE_VERSION);
    await db`
      insert into scores (
        subject_type, subject_id, period_start, period_end, score, exposure_km, exposure_min, breakdown, rule_version
      )
      values (
        ${score.subjectType}, ${score.subjectId}, ${new Date(score.periodStart * 1000)}, ${new Date(score.periodEnd * 1000)},
        ${score.score}, ${score.exposureKm}, ${score.exposureMin}, ${db.json(score.breakdown as any)}, ${score.ruleVersion}
      )
      on conflict (subject_type, subject_id, period_start, period_end, rule_version) do update set
        score = excluded.score,
        exposure_km = excluded.exposure_km,
        exposure_min = excluded.exposure_min,
        breakdown = excluded.breakdown
    `;
    savedScores++;
  }

  console.log(`[maintenance] Daily scores: ${savedScores} score record(s) persisted`);
  return savedScores;
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  let env;
  try {
    env = loadDbEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(`[maintenance] Environment error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const db = createDb(env, { max: 2, applicationName: 'roadscore-maintenance' });

  try {
    // Acquire advisory lock to ensure single maintenance execution
    await db`select pg_advisory_lock(${ADVISORY_LOCKS.SWEEPER.toString()}::bigint)`;

    if (args.rollup) await refreshRollup(db, args.hours);
    if (args.arbitrate) await reArbitrateDefects(db);
    if (args.scores) await rollupScores(db, args.hours);

    console.log('[maintenance] All tasks finished successfully');
  } catch (err) {
    console.error('[maintenance] Maintenance task failed:', err);
    process.exitCode = 1;
  } finally {
    try {
      await db`select pg_advisory_unlock(${ADVISORY_LOCKS.SWEEPER.toString()}::bigint)`;
    } catch {}
    await closeDb(db);
  }
}

if (process.argv[1] && process.argv[1].endsWith('maintenance.ts')) {
  main().catch((err) => {
    console.error('fatal error:', err);
    process.exit(1);
  });
}
