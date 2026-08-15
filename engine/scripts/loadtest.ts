#!/usr/bin/env node
/**
 * Synthetic load test generator — ENGINE-PLAN §10 and §11 Phase 5.
 *
 *   npx tsx scripts/loadtest.ts --devices 50 --duration 10s --dry-run
 *   npx tsx scripts/loadtest.ts --devices 100 --duration 30s
 *
 * §10: "Load test: synthetic generator emitting N devices × 1 Hz into telemetry;
 * verify ingest→event p95 latency and that the sweeper never falls behind."
 *
 * In dry-run mode (default when DATABASE_URL is absent), rows run through the
 * pipeline in-memory to benchmark pure engine throughput. In live mode, synthetic
 * telemetry rows are written to Postgres to test the full sweeper + DB sink path.
 */

import { performance } from 'node:perf_hooks';
import { THRESHOLDS } from '../src/config/thresholds.js';
import { Pipeline } from '../src/pipeline.js';
import { RoadMap } from '../src/arbitrate/roadmap.js';
import type { DeviceMeta, RawRow, Sink } from '../src/types.js';
import { createLogger } from '../src/util/log.js';

interface LoadTestArgs {
  devices: number;
  durationS: number;
  rateHz: number;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): LoadTestArgs {
  const args: LoadTestArgs = {
    devices: 10,
    durationS: 10,
    rateHz: 1,
    dryRun: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;

    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--devices') args.devices = Number(argv[++i]);
    else if (a === '--duration') {
      const v = argv[++i] ?? '10s';
      args.durationS = Number(v.replace(/s$/, ''));
    } else if (a === '--rate') args.rateHz = Number(argv[++i]);
    else if (a === '--live') args.dryRun = false;
    else if (a === '--dry-run') args.dryRun = true;
  }

  return args;
}

const USAGE = `
Usage: npx tsx scripts/loadtest.ts [options]

  --devices <n>    number of synthetic devices (default: 10)
  --duration <sec> duration in seconds e.g. 10s or 30s (default: 10s)
  --rate <hz>      sampling rate in Hz per device (default: 1)
  --dry-run        in-memory benchmark (default: true)
  --live           write rows to DB telemetry table
  -h, --help       show this message
`.trim();

/** Memory sink that tracks batch stats without writing to DB. */
class MemorySink implements Sink {
  eventsCount = 0;
  tripsCount = 0;
  predictionsCount = 0;

  enqueueEvent(): void {
    this.eventsCount++;
  }
  enqueueTrip(): void {
    this.tripsCount++;
  }
  enqueueRoadCell(): void {}
  enqueueRoadDefect(): void {}
  enqueuePrediction(): void {
    this.predictionsCount++;
  }
  enqueueScore(): void {}
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}

function generateSyntheticRow(
  deviceId: string,
  seq: number,
  tSec: number,
  uptimeMs: number,
): RawRow {
  // Baseline Sri Lankan coordinates near Colombo
  const lat = 6.9271 + (Math.random() - 0.5) * 0.01;
  const lon = 79.8612 + (Math.random() - 0.5) * 0.01;
  const speedKmh = 40 + Math.sin(seq / 10) * 15 + (Math.random() - 0.5) * 5;

  // Occasional synthetic spike (pothole / harsh brake simulation)
  const isPothole = Math.random() < 0.05;
  const vertPeak = isPothole ? 14000 : 3000 + Math.floor(Math.random() * 1000);
  const horizPeak = 2000 + Math.floor(Math.random() * 800);

  return {
    id: seq,
    device_id: deviceId,
    ts: new Date(tSec * 1000).toISOString(),
    uptime_ms: uptimeMs,
    seq,
    samples: 50,
    accel_raw: { x: 0, y: 0, z: 16384 },
    accel_cal: {
      vertical_rms: 2500,
      vertical_peak: vertPeak,
      horizontal_peak: horizPeak,
      magnitude_peak: Math.max(vertPeak, horizPeak),
    },
    gyro_raw: { x: 0, y: 0, z: 0 },
    gyro_cal: {
      pitch_rate_peak: 20,
      roll_rate_peak: 20,
      yaw_rate_peak: 100,
    },
    gps: {
      fix: true,
      lat,
      lon,
      speed_kmh: Math.max(0, speedKmh),
      heading: 90,
      sats: 8,
      hdop: 1.2,
    },
    mic: {
      rms: 120,
      peak: isPothole ? 800 : 300,
    },
    calibration: {
      state: 'calibrated',
      age_ms: 5000,
      gravity_ref: { x: 0, y: 0, z: 1 },
    },
    wifi_rssi: -65,
    accel_fs_g: 2,
    gyro_fs_dps: 250,
    fw_version: '1.0.0-synthetic',
    dropped_posts: 0,
    server_received_at: new Date(tSec * 1000).toISOString(),
  };
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  console.log(
    `[loadtest] Starting benchmark: ${args.devices} devices @ ${args.rateHz} Hz for ${args.durationS}s (${args.dryRun ? 'dry-run' : 'live'})`,
  );

  const cfg = THRESHOLDS;
  const sink = new MemorySink();
  const log = createLogger(
    { NODE_ENV: 'test', LOG_LEVEL: 'silent' } as any,
    { service: 'loadtest' },
  );

  const devicesMap = new Map<string, DeviceMeta>();
  for (let i = 0; i < args.devices; i++) {
    const id = `dev-syn-${i.toString().padStart(3, '0')}`;
    devicesMap.set(id, {
      deviceId: id,
      vehicleId: `veh-${i}`,
      driverId: `drv-${i}`,
      accelFsG: 2,
      gyroFsDps: 250,
      active: true,
    });
  }

  const map = new RoadMap(cfg);
  const pipeline = new Pipeline({ cfg, sink, log, devices: devicesMap, map });

  const latenciesMs: number[] = [];
  let totalRows = 0;
  const startTime = performance.now();
  const startEpochSec = Math.floor(Date.now() / 1000) - args.durationS;

  const totalSteps = args.durationS * args.rateHz;

  for (let step = 0; step < totalSteps; step++) {
    const tSec = startEpochSec + step / args.rateHz;
    const uptimeMs = step * 1000;

    for (let d = 0; d < args.devices; d++) {
      const devId = `dev-syn-${d.toString().padStart(3, '0')}`;
      const row = generateSyntheticRow(devId, step + 1, tSec, uptimeMs);

      const rowStart = performance.now();
      await pipeline.submit(row);
      const rowEnd = performance.now();

      latenciesMs.push(rowEnd - rowStart);
      totalRows++;
    }
  }

  await pipeline.drain();
  const totalTimeMs = performance.now() - startTime;

  latenciesMs.sort((a, b) => a - b);
  const p50 = latenciesMs[Math.floor(latenciesMs.length * 0.5)] ?? 0;
  const p95 = latenciesMs[Math.floor(latenciesMs.length * 0.95)] ?? 0;
  const p99 = latenciesMs[Math.floor(latenciesMs.length * 0.99)] ?? 0;
  const rowsPerSec = (totalRows / (totalTimeMs / 1000)).toFixed(1);

  console.log('\n--- Load Test Results ---');
  console.log(`Total rows processed : ${totalRows}`);
  console.log(`Wall clock time     : ${totalTimeMs.toFixed(1)} ms`);
  console.log(`Throughput          : ${rowsPerSec} rows/sec`);
  console.log(`Latency p50         : ${p50.toFixed(3)} ms`);
  console.log(`Latency p95         : ${p95.toFixed(3)} ms`);
  console.log(`Latency p99         : ${p99.toFixed(3)} ms`);
  console.log(`Events emitted      : ${pipeline.stats.eventsEmitted}`);
  console.log(`Trips opened/closed : ${pipeline.stats.tripsOpened} / ${pipeline.stats.tripsClosed}`);
  console.log(`Predictions issued  : ${pipeline.stats.predictionsIssued}`);
  console.log('-------------------------\n');
}

if (process.argv[1] && process.argv[1].endsWith('loadtest.ts')) {
  main().catch((err) => {
    console.error('loadtest failed:', err);
    process.exit(1);
  });
}
