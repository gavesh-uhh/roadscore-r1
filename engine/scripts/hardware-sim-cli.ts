#!/usr/bin/env node
/**
 * Hardware Device Simulator CLI — ENGINE-PLAN §2, §3, §10.
 *
 *   npx tsx scripts/hardware-sim-cli.ts --scenario smooth --out drive-smooth.jsonl
 *   npx tsx scripts/hardware-sim-cli.ts --scenario aggressive --pipeline
 *   npx tsx scripts/hardware-sim-cli.ts --scenario pothole --server http://localhost:3000
 *   npx tsx scripts/hardware-sim-cli.ts --scenario all --pipeline
 *
 * Simulates real ESP32 micro-controller hardware running MPU6050 + NEO-6M GPS + Mic,
 * testing server thresholds, edge cases, and detector responses.
 */

import { writeFileSync } from 'node:fs';
import { HardwareDevice } from '../src/sim/device.js';
import {
  generateSmoothCommute,
  generateAggressiveDrive,
  generatePotholeCluster,
  generateTunnelUnderpass,
  generateMountDisplacement,
  generatePowerCycleReboot,
  generateHardwareFaults,
  generateCollisionCrash,
  generatePoisonedAttacker,
} from '../src/sim/scenarios.js';
import { Pipeline } from '../src/pipeline.js';
import { RoadMap } from '../src/arbitrate/roadmap.js';
import { THRESHOLDS } from '../src/config/thresholds.js';
import type { DeviceMeta, RawRow, Sink } from '../src/types.js';
import { createLogger } from '../src/util/log.js';

interface CLIArgs {
  scenario: string;
  device: string;
  out?: string;
  serverUrl?: string;
  runPipeline: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    scenario: 'smooth',
    device: 'esp32-sim-a1',
    runPipeline: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;

    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--scenario' || a === '-s') args.scenario = argv[++i] ?? 'smooth';
    else if (a === '--device' || a === '-d') args.device = argv[++i] ?? 'esp32-sim-a1';
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a === '--server') args.serverUrl = argv[++i];
    else if (a === '--pipeline') args.runPipeline = true;
  }

  return args;
}

const USAGE = `
Usage: npx tsx scripts/hardware-sim-cli.ts [options]

Scenarios:
  smooth       2-minute clean Colombo commute
  aggressive   harsh brakes, harsh accels, sharp corners, swerving
  pothole      rough road segment with vertical impact spikes
  tunnel       GPS fix loss mid-drive & re-acquisition
  mount        device mount displacement (25 deg shift)
  reboot       ESP32 brownout power cycle reboot mid-trip
  stuck        MPU6050 sensor freeze / stuck raw values
  lowsample    low sampling rate (18 Hz instead of 50 Hz)
  crash        severe collision impact + speed collapse
  poisoned     attacker rows (speed > 250, ocean lat/lon)
  all          run every scenario sequentially

Options:
  -s, --scenario <name>   scenario profile to simulate (default: smooth)
  -d, --device <id>       device ID (default: esp32-sim-a1)
  -o, --out <file>        output JSONL capture file
  --pipeline              run through internal Pipeline and report events
  --server <url>          POST rows to PostgREST or HTTP server endpoint
  -h, --help              show this help message
`.trim();

class MemorySink implements Sink {
  events: any[] = [];
  trips: any[] = [];

  enqueueEvent(e: any): void {
    this.events.push(e);
  }
  enqueueTrip(t: any): void {
    this.trips.push(t);
  }
  enqueueRoadCell(): void {}
  enqueueRoadDefect(): void {}
  enqueuePrediction(): void {}
  enqueueScore(): void {}
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}

export async function runScenario(scenarioName: string, deviceId: string, runPipeline: boolean, outFile?: string, serverUrl?: string): Promise<RawRow[]> {
  const device = new HardwareDevice({ deviceId, fwVersion: '1.0.0-mcu' });
  let rows: RawRow[] = [];

  switch (scenarioName) {
    case 'smooth':
      rows = generateSmoothCommute(device);
      break;
    case 'aggressive':
      rows = generateAggressiveDrive(device);
      break;
    case 'pothole':
      rows = generatePotholeCluster(device);
      break;
    case 'tunnel':
      rows = generateTunnelUnderpass(device);
      break;
    case 'mount':
      rows = generateMountDisplacement(device);
      break;
    case 'reboot':
      rows = generatePowerCycleReboot(device);
      break;
    case 'stuck':
      rows = generateHardwareFaults(device, 'stuck_sensor');
      break;
    case 'lowsample':
      rows = generateHardwareFaults(device, 'low_sample_rate');
      break;
    case 'crash':
      rows = generateCollisionCrash(device);
      break;
    case 'poisoned':
      rows = generatePoisonedAttacker(device);
      break;
    default:
      throw new Error(`Unknown scenario: ${scenarioName}`);
  }

  console.log(`[hardware-sim] Scenario '${scenarioName}': generated ${rows.length} rows for device '${deviceId}'`);

  if (outFile) {
    const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(outFile, jsonl, 'utf8');
    console.log(`[hardware-sim] Wrote JSONL capture to ${outFile}`);
  }

  if (serverUrl) {
    console.log(`[hardware-sim] POSTing ${rows.length} rows to ${serverUrl}...`);
    let posted = 0;
    for (const r of rows) {
      try {
        const res = await fetch(serverUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(r),
        });
        if (res.ok) posted++;
      } catch (err) {
        console.error(`POST failed for row seq ${r.seq}:`, err);
      }
    }
    console.log(`[hardware-sim] Successfully posted ${posted}/${rows.length} rows to ${serverUrl}`);
  }

  if (runPipeline) {
    const cfg = THRESHOLDS;
    const sink = new MemorySink();
    const log = createLogger(
      { NODE_ENV: 'test', LOG_LEVEL: 'silent' } as any,
      { service: 'hardware-sim' },
    );

    const devices = new Map<string, DeviceMeta>([
      [
        deviceId,
        {
          deviceId,
          vehicleId: 'veh-sim-1',
          driverId: 'drv-sim-1',
          accelFsG: 2,
          gyroFsDps: 250,
          active: true,
        },
      ],
    ]);

    const map = new RoadMap(cfg);
    const pipeline = new Pipeline({ cfg, sink, log, devices, map });

    for (const row of rows) {
      await pipeline.submit(row);
    }
    await pipeline.drain();

    console.log(`\n--- Pipeline Evaluation for '${scenarioName}' ---`);
    console.log(`Rows accepted  : ${pipeline.stats.rowsAccepted}`);
    console.log(`Rows rejected  : ${pipeline.stats.rowsRejected}`);
    console.log(`Events emitted : ${sink.events.length}`);
    for (const e of sink.events) {
      console.log(`  - [${e.type}] severity: ${e.severity}, conf: ${e.confidence.toFixed(2)}, msg: ${e.magnitude} ${e.magnitudeUnit ?? ''}`);
    }
    console.log(`Trips opened/closed: ${pipeline.stats.tripsOpened} / ${pipeline.stats.tripsClosed}`);
    console.log('--------------------------------------------\n');
  }

  return rows;
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  if (args.scenario === 'all') {
    const scenarios = ['smooth', 'aggressive', 'pothole', 'tunnel', 'mount', 'reboot', 'stuck', 'lowsample', 'crash', 'poisoned'];
    for (const s of scenarios) {
      await runScenario(s, args.device, args.runPipeline, undefined, args.serverUrl);
    }
  } else {
    await runScenario(args.scenario, args.device, args.runPipeline, args.out, args.serverUrl);
  }
}

if (process.argv[1] && process.argv[1].endsWith('hardware-sim-cli.ts')) {
  main().catch((err) => {
    console.error('[hardware-sim] Error:', err);
    process.exit(1);
  });
}
