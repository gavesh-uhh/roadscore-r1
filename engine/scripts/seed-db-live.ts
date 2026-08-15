/**
 * Populate Supabase DB with live simulated drives and pipeline events.
 *
 * Runs simulated scenarios for registered devices (dev-esp32-001, ROADSCORE_001)
 * and writes raw telemetry + derived pipeline events/trips/scores/road_cells to Supabase!
 */

import { loadEnv } from '../src/config/env.js';
import { THRESHOLDS } from '../src/config/thresholds.js';
import { createDb, closeDb } from '../src/db/client.js';
import { createLogger } from '../src/util/log.js';
import { PgSink } from '../src/sink/writer.js';
import { Pipeline } from '../src/pipeline.js';
import { RoadMap } from '../src/arbitrate/roadmap.js';
import { HardwareDevice } from '../src/sim/device.js';
import {
  generateSmoothCommute,
  generateAggressiveDrive,
  generatePotholeCluster,
  generateCollisionCrash,
  generateMountDisplacement,
} from '../src/sim/scenarios.js';
import type { DeviceMeta, RawRow } from '../src/types.js';

async function main() {
  console.log('[seed-db-live] Loading environment and connecting to database...');
  const env = loadEnv();
  const log = createLogger(env, { service: 'seed-db-live' });
  const db = createDb(env);
  const cfg = THRESHOLDS;

  // 1. Fetch registered devices
  const deviceRows = await db<
    {
      device_id: string;
      vehicle_id: string | null;
      driver_id: string | null;
      accel_fs_g: string | number;
      gyro_fs_dps: string | number;
      active: boolean;
    }[]
  >`select device_id, vehicle_id, driver_id, accel_fs_g, gyro_fs_dps, active from devices`;

  const devicesMap = new Map<string, DeviceMeta>();
  for (const r of deviceRows) {
    devicesMap.set(r.device_id, {
      deviceId: r.device_id,
      vehicleId: r.vehicle_id,
      driverId: r.driver_id,
      accelFsG: Number(r.accel_fs_g),
      gyroFsDps: Number(r.gyro_fs_dps),
      active: r.active,
    });
  }

  const targetDevices = ['ROADSCORE_001'];
  const allRows: RawRow[] = [];

  for (const targetDeviceId of targetDevices) {
    console.log(`[seed-db-live] Generating scenario rows for registered device '${targetDeviceId}'...`);
    const dev = new HardwareDevice({ deviceId: targetDeviceId, fwVersion: '1.0.0-mcu' });

    const smoothRows = generateSmoothCommute(dev);
    const aggressiveRows = generateAggressiveDrive(dev);
    const potholeRows = generatePotholeCluster(dev);
    const crashRows = generateCollisionCrash(dev);
    const mountRows = generateMountDisplacement(dev);

    allRows.push(...smoothRows, ...aggressiveRows, ...potholeRows, ...crashRows, ...mountRows);
  }

  allRows.sort((a, b) => new Date(a.ts!).getTime() - new Date(b.ts!).getTime());
  console.log(`[seed-db-live] Generated ${allRows.length} total telemetry rows chronologically across ${targetDevices.length} devices.`);

  // 2. Insert raw telemetry into public.telemetry
  console.log(`[seed-db-live] Inserting ${allRows.length} rows into public.telemetry table...`);
  
  // Batch insert into telemetry table
  for (let i = 0; i < allRows.length; i += 100) {
    const chunk = allRows.slice(i, i + 100);
    await db`
      insert into public.telemetry ${db(
        chunk.map((r) => ({
          device_id: r.device_id,
          ts: r.ts,
          uptime_ms: r.uptime_ms,
          window_ms: (r as any).window_ms ?? 1000,
          seq: r.seq,
          samples: r.samples,
          accel_raw: db.json(r.accel_raw as any),
          accel_cal: db.json(r.accel_cal as any),
          gyro_raw: db.json(r.gyro_raw as any),
          gyro_cal: db.json(r.gyro_cal as any),
          gps: db.json(r.gps as any),
          mic: db.json(r.mic as any),
          calibration: db.json(r.calibration as any),
          wifi_rssi: r.wifi_rssi,
          accel_fs_g: r.accel_fs_g,
          gyro_fs_dps: r.gyro_fs_dps,
          fw_version: r.fw_version,
          dropped_posts: r.dropped_posts,
          server_received_at: r.server_received_at ?? new Date().toISOString(),
        })),
      )}
    `;
  }
  console.log('[seed-db-live] Raw telemetry rows inserted into public.telemetry successfully.');

  // 3. Process rows through engine Pipeline and write derived tables via PgSink
  console.log('[seed-db-live] Processing telemetry rows through engine pipeline to populate trips, events, road_cells, predictions, and scores...');
  const sink = new PgSink(db, log, { flushMs: 100, maxRows: 500 });
  const map = new RoadMap(cfg);
  const pipeline = new Pipeline({ cfg, sink, log, devices: devicesMap, map });

  for (const r of allRows) {
    await pipeline.submit(r);
  }

  await pipeline.shutdown();
  await sink.flush();
  await sink.close();

  console.log('\n--- Pipeline Execution Summary ---');
  console.log(`Rows Accepted : ${pipeline.stats.rowsAccepted}`);
  console.log(`Rows Rejected : ${pipeline.stats.rowsRejected}`);
  console.log(`Events Emitted: ${pipeline.stats.eventsEmitted}`);
  console.log(`Trips Opened  : ${pipeline.stats.tripsOpened}`);
  console.log(`Trips Closed  : ${pipeline.stats.tripsClosed}`);
  console.log('----------------------------------\n');

  // Verify DB table counts after seeding
  console.log('[seed-db-live] Verifying DB table counts...');
  const tables = ['telemetry', 'trips', 'driving_events', 'road_cells', 'predictions', 'scores', 'engine_checkpoints'];
  for (const t of tables) {
    const rows = await db.unsafe(`select count(*)::int from public.${t}`);
    const count = (rows as any)?.[0]?.count ?? 0;
    console.log(`  - ${t}: ${count} rows`);
  }

  await closeDb(db);
  console.log('[seed-db-live] Seeding complete!');
}

main().catch((err) => {
  console.error('[seed-db-live] Error seeding DB:', err);
  process.exit(1);
});
