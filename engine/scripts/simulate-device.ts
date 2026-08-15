#!/usr/bin/env node
/**
 * Real-Time ESP32 Telematics Hardware Simulator — RoadScore-R1.
 *
 * Emulates the physical ESP32 micro-controller board (MPU6050 6-DOF IMU,
 * NEO-6M GPS, ADC Microphone) streaming 1Hz aggregated telemetry windows
 * directly to the Supabase REST endpoint (or PostgreSQL database).
 *
 * Usage:
 *   npx tsx scripts/simulate-device.ts --live
 *   npx tsx scripts/simulate-device.ts --scenario aggressive --delay 1000
 *   npx tsx scripts/simulate-device.ts --scenario pothole --device ROADSCORE_001
 *   npx tsx scripts/simulate-device.ts --scenario all --delay 100
 */

import { loadEnv } from '../src/config/env.js';
import { HardwareDevice, type PhysicalState } from '../src/sim/device.js';
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
  generateDriverPenaltiesOnly,
  generateWorstDriver,
} from '../src/sim/scenarios.js';
import type { RawRow } from '../src/types.js';

interface SimulatorOptions {
  mode: 'live' | 'scenario';
  scenario: string;
  preset?: string;
  driverOnly: boolean;
  isWorstDriver: boolean;
  deviceId: string;
  delayMs: number;
  durationSec: number;
  useDb: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): SimulatorOptions {
  const opts: SimulatorOptions = {
    mode: 'live',
    scenario: 'smooth',
    driverOnly: false,
    isWorstDriver: false,
    deviceId: 'ROADSCORE_001',
    delayMs: 1000,
    durationSec: 0, // 0 = infinite
    useDb: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;

    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--live' || a === '-l') opts.mode = 'live';
    else if (a === '--scenario' || a === '-s') {
      opts.mode = 'scenario';
      opts.scenario = argv[++i] ?? 'smooth';
      if (opts.scenario === 'worst-driver' || opts.scenario === 'reckless' || opts.scenario === 'worst') {
        opts.isWorstDriver = true;
      }
    } else if (a === '--preset' || a === '-p') {
      opts.preset = argv[++i] ?? 'driver-penalties';
      if (opts.preset === 'worst-driver' || opts.preset === 'reckless' || opts.preset === 'worst') {
        opts.isWorstDriver = true;
        opts.driverOnly = true;
      } else if (opts.preset === 'driver-penalties' || opts.preset === 'penalties' || opts.preset === 'driver_infractions') {
        opts.driverOnly = true;
      }
    } else if (a === '--driver-only' || a === '--penalties-only') {
      opts.driverOnly = true;
    } else if (a === '--worst-driver' || a === '--reckless') {
      opts.isWorstDriver = true;
      opts.driverOnly = true;
    } else if (a === '--device' || a === '-d') opts.deviceId = argv[++i] ?? 'ROADSCORE_001';
    else if (a === '--delay') opts.delayMs = Number(argv[++i] ?? 1000);
    else if (a === '--duration') opts.durationSec = Number(argv[++i] ?? 0);
    else if (a === '--db') opts.useDb = true;
  }

  return opts;
}

const USAGE = `
RoadScore-R1 Hardware Device Simulator

Usage:
  npx tsx scripts/simulate-device.ts [options]

Modes:
  --live, -l                     Run continuous realistic live driving loop (default)
  --scenario, -s <name>          Run a specific scenario (worst-driver, driver-penalties, aggressive, smooth, pothole, tunnel, mount, reboot, stuck, crash, all)

Presets & Filters:
  --preset worst-driver          Extreme reckless driver (High speed 100+ km/h, violent sharp turns, slalom swerves, tailgating brake slams)
  --preset driver-penalties      Live mode preset emitting standard scorable driver infractions (Harsh Brake, Accel, Sharp Corner, Swerve)
  --driver-only                  Suppress all road defect potholes and integrity faults

Options:
  -d, --device <id>              Device ID to simulate (default: ROADSCORE_001)
  --delay <ms>                   Delay between posted telemetry windows in ms (default: 1000ms = 1Hz)
  --duration <sec>               Total run duration in seconds (default: 0 = continuous until stopped)
  -h, --help                     Show this help message

Examples:
  # 1. Run the 80s 'Worst Driver' extreme reckless scenario:
  npx tsx scripts/simulate-device.ts --scenario worst-driver --delay 1000

  # 2. Run continuous live stream as the 'Worst Driver' (fast driving, high lateral Gs, no gap, sharp turns):
  npx tsx scripts/simulate-device.ts --live --preset worst-driver

  # 3. Run the standard 65s Driver Penalties scenario:
  npx tsx scripts/simulate-device.ts --scenario driver-penalties --delay 1000
`.trim();

// Waypoints along Colombo coastal and arterial roads (Galle Road / Marine Drive)
const COLOMBO_ROUTE = [
  { lat: 6.9344, lon: 79.8428, name: 'Fort Railway Station' },
  { lat: 6.9271, lon: 79.8453, name: 'Galle Face Green' },
  { lat: 6.9150, lon: 79.8520, name: 'Kollupitiya Junction' },
  { lat: 6.8980, lon: 79.8550, name: 'Bambalapitiya' },
  { lat: 6.8780, lon: 79.8590, name: 'Wellawatte' },
  { lat: 6.8580, lon: 79.8650, name: 'Dehiwala Flyover' },
  { lat: 6.8350, lon: 79.8730, name: 'Mount Lavinia Hotel Junction' },
];

async function postTelemetryRow(
  row: RawRow,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<{ status: number; ok: boolean; durationMs: number }> {
  const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/telemetry`;
  const t0 = Date.now();

  const { id, server_received_at, ...cleanPayload } = row as any;
  cleanPayload.window_ms = cleanPayload.window_ms ?? 1000;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(cleanPayload),
  });

  const durationMs = Date.now() - t0;
  if (!res.ok) {
    const errText = await res.text();
    console.error(`\n[POST FAIL ${res.status}] Body:`, errText);
  }
  return { status: res.status, ok: res.ok, durationMs };
}

async function runLiveSimulation(opts: SimulatorOptions, supabaseUrl: string, supabaseKey: string) {
  console.log(`\n======================================================`);
  console.log(`🚀 RoadScore-R1 Telematics Simulator: LIVE STREAMING`);
  console.log(`   Device ID   : ${opts.deviceId}`);
  console.log(`   Target URL  : ${supabaseUrl}/rest/v1/telemetry`);
  console.log(`   Sample Rate : 1 Hz (${opts.delayMs}ms interval)`);
  console.log(`   Press Ctrl+C to terminate simulation`);
  console.log(`======================================================\n`);

  const device = new HardwareDevice({
    deviceId: opts.deviceId,
    fwVersion: '1.0.0-mcu',
    accelFsG: 2,
    gyroFsDps: 250,
  });

  let wayIdx = 0;
  let subStep = 0;
  const subStepsPerLeg = 25; // 25 seconds per leg
  let currentSpeed = 0;
  let targetSpeed = 45;
  let tick = 0;

  const startTime = Date.now();

  while (true) {
    if (opts.durationSec > 0 && (Date.now() - startTime) / 1000 >= opts.durationSec) {
      console.log(`\n[SIMULATOR] Reached configured duration of ${opts.durationSec}s. Stopping.`);
      break;
    }

    tick++;
    const now = new Date();

    // Interpolate waypoint position
    const currentWP = COLOMBO_ROUTE[wayIdx]!;
    const nextWP = COLOMBO_ROUTE[(wayIdx + 1) % COLOMBO_ROUTE.length]!;

    const progress = subStep / subStepsPerLeg;
    const currentLat = currentWP.lat + (nextWP.lat - currentWP.lat) * progress;
    const currentLon = currentWP.lon + (nextWP.lon - currentWP.lon) * progress;

    // Calculate heading towards next waypoint
    const dLat = nextWP.lat - currentWP.lat;
    const dLon = nextWP.lon - currentWP.lon;
    let heading = Math.round((Math.atan2(dLon, dLat) * 180) / Math.PI);
    if (heading < 0) heading += 360;

    // Realistic speed profile: acceleration, cruise, deceleration at intersections
    if (subStep < 5) {
      // Accelerating from stop/turn
      targetSpeed = 45 + (tick % 15);
      currentSpeed = Math.min(targetSpeed, currentSpeed + 8.5);
    } else if (subStep > subStepsPerLeg - 4) {
      // Slowing down for turn/light
      targetSpeed = 5;
      currentSpeed = Math.max(0, currentSpeed - 12.0);
    } else {
      // Cruising with natural variations
      currentSpeed = targetSpeed + Math.sin(tick / 3) * 3;
    }

    // Physical acceleration modeling
    let vertAccel = 0.8 + (Math.random() - 0.5) * 0.3; // Baseline road noise
    let horizPeak = (Math.abs(currentSpeed - targetSpeed) / 3.6) * 0.8;
    let yawRate = 0.01 * (Math.random() - 0.5);
    let micRms = 120 + currentSpeed * 4 + Math.random() * 40;

    let eventTag = '';

    if (opts.isWorstDriver) {
      // EXTREME WORST DRIVER / RECKLESS PRESET: High speed (90-115 km/h), no gap, rapid violent maneuvers
      vertAccel = 0.7;
      micRms = 220;

      // 1. Extreme Tailgate Panic Brake Slam (tick % 12 === 0)
      if (tick % 12 === 0 && currentSpeed > 40) {
        currentSpeed = Math.max(10, currentSpeed - 45);
        horizPeak = 7.8; // >6.0 m/s² critical brake slam
        yawRate = 0.05;
        eventTag = ' 🛑 [CRITICAL HARSH BRAKE - TAILGATING]';
      }
      // 2. High-Speed Hairpin Cornering (tick % 18 === 0 || tick % 18 === 1)
      else if ((tick % 18 === 0 || tick % 18 === 1) && currentSpeed > 35) {
        currentSpeed = Math.max(65, currentSpeed);
        yawRate = 0.42; // ~24 deg/s sharp turn
        heading = (heading + 24) % 360;
        horizPeak = (currentSpeed / 3.6) * 0.42; // 7.6+ m/s² lateral Gs
        eventTag = ' ↩️  [EXTREME SHARP CORNER (24 deg/s)]';
      }
      // 3. Dangerous Slalom Swerving without Gap (tick % 26 >= 0 && tick % 26 <= 3)
      else if (tick % 26 >= 0 && tick % 26 <= 3 && currentSpeed > 40) {
        const phase = (tick % 26) % 2 === 0 ? 1 : -1;
        yawRate = 0.36;
        heading = (heading + phase * 14 + 360) % 360;
        horizPeak = (currentSpeed / 3.6) * 0.36; // 6.5+ m/s²
        eventTag = ' 〰️  [AGGRESSIVE SWERVING / SLALOM]';
      }
      // 4. Violent Jackrabbit Throttle Launch (tick % 33 === 0)
      else if (tick % 33 === 0) {
        currentSpeed = Math.min(115, currentSpeed + 35);
        horizPeak = 6.8; // >5.0 m/s² violent accel
        eventTag = ' 🚀 [VIOLENT JACKRABBIT ACCEL]';
      }
      // 5. Excessive High Speeding
      else if (currentSpeed > 90) {
        eventTag = ' ⚡ [HIGH-SPEED CRUISE (100+ km/h)]';
      }
    } else if (opts.driverOnly) {
      // PURE DRIVER PENALTIES PRESET: Clean road & hardware, only driver infractions
      vertAccel = 0.6; // Clean road surface (0 road defect impacts)
      micRms = 140;

      // 1. Harsh Braking (tick % 20 === 0)
      if (tick % 20 === 0 && currentSpeed > 30) {
        currentSpeed = Math.max(8, currentSpeed - 24);
        horizPeak = 5.6; // >3.6 m/s² braking event
        eventTag = ' 🛑 [HARSH BRAKE (-8.0 pts)]';
      }
      // 2. Harsh Acceleration (tick % 35 === 0)
      else if (tick % 35 === 0) {
        currentSpeed = Math.min(80, currentSpeed + 26);
        horizPeak = 5.2; // >3.0 m/s² accel event
        eventTag = ' 🚀 [HARSH ACCEL (-5.0 pts)]';
      }
      // 3. Excessive Cornering Speed (tick % 48 === 0 || tick % 48 === 1)
      else if ((tick % 48 === 0 || tick % 48 === 1) && currentSpeed > 35) {
        yawRate = 0.40; // ~23 deg/s cornering event
        heading = (heading + 23) % 360;
        horizPeak = (currentSpeed / 3.6) * 0.40;
        eventTag = ' ↩️  [SHARP CORNER (-7.0 pts)]';
      }
      // 4. Dangerous Swerving (tick % 64 >= 0 && tick % 64 <= 3)
      else if (tick % 64 >= 0 && tick % 64 <= 3 && currentSpeed > 35) {
        const phase = (tick % 64) % 2 === 0 ? 1 : -1;
        yawRate = 0.36;
        heading = (heading + phase * 12 + 360) % 360;
        horizPeak = (currentSpeed / 3.6) * 0.36;
        eventTag = ' 〰️  [SWERVING (-10.0 pts)]';
      }
    } else {
      // DEFAULT MIXED LIVE MODE:
      // Pothole bump at tick % 40 == 0
      if (tick % 40 === 0 && currentSpeed > 25) {
        vertAccel = 3.8 + Math.random() * 1.5; // ~3.8 m/s² vertical impact spike
        micRms = 950;
        eventTag = ' 💥 [POTHOLE IMPACT]';
      }
      // Harsh Braking at tick % 65 == 0
      else if (tick % 65 === 0 && currentSpeed > 35) {
        currentSpeed = Math.max(5, currentSpeed - 22);
        horizPeak = 4.8; // >3.6 m/s² braking event
        eventTag = ' 🛑 [HARSH BRAKE]';
      }
      // Sharp Corner at turn
      else if (subStep === subStepsPerLeg - 1) {
        yawRate = 0.38; // >0.30 rad/s (~22 deg/s) cornering event
        heading = (heading + 22) % 360;
        horizPeak = (currentSpeed / 3.6) * 0.38;
        eventTag = ' ↩️  [SHARP TURN]';
      }
    }

    const state: PhysicalState = {
      lat: Number(currentLat.toFixed(6)),
      lon: Number(currentLon.toFixed(6)),
      speedKmh: Number(currentSpeed.toFixed(1)),
      heading,
      gpsFix: true,
      sats: 10,
      hdop: 0.9,
      verticalAccelMps2: vertAccel,
      horizontalPeakMps2: Math.max(0.2, horizPeak),
      magnitudePeakMps2: 9.81 + vertAccel * 0.5,
      yawRateRadps: yawRate,
      pitchRateRadps: 0.02 * (Math.random() - 0.5),
      rollRateRadps: 0.02 * (Math.random() - 0.5),
      micRms,
      micPeak: micRms * 2.2,
      samplesCount: 50,
      wifiRssi: -58 - Math.floor(Math.random() * 12),
    };

    const row = device.step(state, now);

    // Advance step
    subStep++;
    if (subStep >= subStepsPerLeg) {
      subStep = 0;
      wayIdx = (wayIdx + 1) % COLOMBO_ROUTE.length;
    }

    // Transmit telemetry
    try {
      const res = await postTelemetryRow(row, supabaseUrl, supabaseKey);
      const statusStr = res.ok ? `\x1b[32m${res.status} OK\x1b[0m` : `\x1b[31m${res.status} ERR\x1b[0m`;
      const timeStr = now.toTimeString().split(' ')[0];

      console.log(
        `[${timeStr}] #${String(row.seq).padStart(4, '0')} | ` +
          `Speed: ${String((state.speedKmh ?? 0).toFixed(0)).padStart(2)} km/h | ` +
          `GPS: ${state.lat}, ${state.lon} | ` +
          `Vert RMS: ${state.verticalAccelMps2.toFixed(2)} m/s² | ` +
          `RSSI: ${state.wifiRssi} dBm | ` +
          `POST: ${statusStr} (${res.durationMs}ms)${eventTag}`,
      );
    } catch (err: any) {
      console.error(`[SIMULATOR] Failed to post telemetry window #${row.seq}:`, err.message);
    }

    if (opts.delayMs > 0) {
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }
  }
}

async function runScenarioSimulation(opts: SimulatorOptions, supabaseUrl: string, supabaseKey: string) {
  const device = new HardwareDevice({
    deviceId: opts.deviceId,
    fwVersion: '1.0.0-mcu',
  });

  const scenarioNames =
    opts.scenario === 'all'
      ? ['driver-penalties', 'smooth', 'aggressive', 'pothole', 'tunnel', 'mount', 'reboot', 'stuck', 'crash']
      : [opts.scenario];

  for (const s of scenarioNames) {
    console.log(`\n--- Running Scenario: '${s.toUpperCase()}' for Device '${opts.deviceId}' ---`);
    let rows: RawRow[] = [];

    const now = Date.now();
    const scenarioDurationSec = s === 'smooth' ? 60 : s === 'aggressive' ? 70 : s === 'worst-driver' || s === 'worst' || s === 'reckless' ? 80 : s === 'driver-penalties' || s === 'penalties' || s === 'driver_penalties' ? 65 : 40;
    const startTime = new Date(now - scenarioDurationSec * 1000);

    switch (s) {
      case 'worst-driver':
      case 'worst_driver':
      case 'worst':
      case 'reckless':
        rows = generateWorstDriver(device, startTime);
        break;
      case 'driver-penalties':
      case 'driver_penalties':
      case 'penalties':
      case 'infractions':
        rows = generateDriverPenaltiesOnly(device, startTime);
        break;
      case 'smooth':
        rows = generateSmoothCommute(device, 60, startTime);
        break;
      case 'aggressive':
        rows = generateAggressiveDrive(device, startTime);
        break;
      case 'pothole':
        rows = generatePotholeCluster(device, startTime);
        break;
      case 'tunnel':
        rows = generateTunnelUnderpass(device, startTime);
        break;
      case 'mount':
        rows = generateMountDisplacement(device, startTime);
        break;
      case 'reboot':
        rows = generatePowerCycleReboot(device, startTime);
        break;
      case 'stuck':
        rows = generateHardwareFaults(device, 'stuck_sensor', startTime);
        break;
      case 'crash':
        rows = generateCollisionCrash(device, startTime);
        break;
      case 'poisoned':
        rows = generatePoisonedAttacker(device, startTime);
        break;
      default:
        console.error(`Unknown scenario: ${s}`);
        continue;
    }

    console.log(`Streaming ${rows.length} telemetry records with ${opts.delayMs}ms pacing...`);

    let posted = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      // Update timestamp to current time for live streaming
      r.ts = new Date(Date.now() - (rows.length - i) * 1000).toISOString();

      try {
        const res = await postTelemetryRow(r, supabaseUrl, supabaseKey);
        if (res.ok) posted++;
        process.stdout.write(
          `\rProgress: [${posted}/${rows.length}] rows posted (${((posted / rows.length) * 100).toFixed(0)}%) - Last POST: ${res.status} (${res.durationMs}ms)`,
        );
      } catch (err: any) {
        console.error(`\nError posting row #${r.seq}:`, err.message);
      }

      if (opts.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      }
    }
    console.log(`\nScenario '${s}' complete: ${posted}/${rows.length} rows delivered.`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from environment.');
    process.exit(1);
  }

  if (opts.mode === 'live') {
    await runLiveSimulation(opts, supabaseUrl, supabaseKey);
  } else {
    await runScenarioSimulation(opts, supabaseUrl, supabaseKey);
  }
}

main().catch((err) => {
  console.error('[SIMULATOR] Fatal error:', err);
  process.exit(1);
});
