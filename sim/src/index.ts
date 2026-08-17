#!/usr/bin/env node
/**
 * RoadScore Simulator — Standalone Multi-Driver OSM Telemetry Simulator
 *
 * Real OpenStreetMap road geometry through OSRM
 * Multi-driver physics and synthetic telemetry simulation
 * Direct Supabase & H3 pipeline integration
 * High-speed, presentation-ready Keyboard TUI
 */

import { SimulationEngine } from './core/simulation.js';
import { SimulatorTuiApp } from './tui/app.js';

const USAGE = `
RoadScore Simulator — Real OSM Road Geometry & Multi-Driver Telemetry Engine

Usage:
  npx roadscore-sim [options]
  npm run sim [options]

Options:
  -s, --scenario <name>     Start with a predefined scenario:
                            - normal_fleet (default, 3 drivers)
                            - rough_road_discovery
                            - multiple_drivers (10 drivers)
                            - hard_braking_event
                            - roadscore_coverage
  --speed <n>               Simulation speed multiplier: 1, 2, 5, 10 (default: 1)
  --offline                 Run in offline mode (do not transmit to Supabase)
  --headless                Run headless CLI streaming without TUI
  -h, --help                Show this help message

Keyboard Controls (Inside TUI):
  SPACE   Pause / Resume simulation
  A       Add Driver wizard
  D       Drivers list & detail view
  R       Route management & cached routes
  S       Scenario selector
  P       Pause / Resume selected driver
  E       Trigger event (Rough road, Braking, Accel, Impact)
  T       Live Telemetry monitor
  L       Full event logs
  C       Clear logs
  +/-     Adjust simulation speed (1x, 2x, 5x, 10x)
  Q       Quit
`.trim();

interface CliArgs {
  scenario?: string;
  speed?: number;
  offline?: boolean;
  headless?: boolean;
  help?: boolean;
}

function parseCliArgs(args: string[]): CliArgs {
  const result: CliArgs = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    if (a === '--help' || a === '-h') result.help = true;
    else if (a === '--scenario' || a === '-s') result.scenario = args[++i];
    else if (a === '--speed') result.speed = Number(args[++i] || '1');
    else if (a === '--offline') result.offline = true;
    else if (a === '--headless') result.headless = true;
  }
  return result;
}

async function runHeadless(engine: SimulationEngine, scenarioName: string): Promise<void> {
  console.log('Starting RoadScore Simulator in HEADLESS mode...');
  await engine.loadScenario(scenarioName);
  engine.start();

  console.log(`[SIM] Scenario '${scenarioName}' active with ${engine.getAllDrivers().length} drivers.`);
  console.log('[SIM] Streaming telemetry to backend... Press Ctrl+C to terminate.');

  setInterval(() => {
    const stats = engine.getStats();
    const drivers = engine.getAllDriverStates();
    const activeInfo = drivers
      .map((d) => `${d.driverId}: ${Math.round(d.currentSpeedKmh)}km/h (${d.progressPercent}%) [H3:${d.currentH3Cell || '-'}]`)
      .join(' | ');

    console.log(
      `[${new Date().toTimeString().split(' ')[0]}] Points: ${stats.pointsSent} | Active: ${stats.activeVehicles} | H3s: ${stats.h3CellsObserved.size} | ${activeInfo}`,
    );
  }, 2000);
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  if (args.offline) {
    process.env.SIM_OFFLINE = 'true';
  }
  if (args.speed) {
    process.env.SIM_SPEED = String(args.speed);
  }

  const engine = new SimulationEngine();

  if (args.headless || !process.stdin.isTTY) {
    await runHeadless(engine, args.scenario || 'normal_fleet');
    return;
  }

  const app = new SimulatorTuiApp(engine);

  if (args.scenario) {
    await engine.loadScenario(args.scenario);
  }

  process.on('SIGINT', () => app.stop());
  process.on('SIGTERM', () => app.stop());

  await app.start();
}

main().catch((err) => {
  console.error('[SIMULATOR FATAL ERROR]', err);
  process.exit(1);
});
