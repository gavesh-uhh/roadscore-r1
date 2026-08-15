#!/usr/bin/env node

/**
 * RoadScore Monorepo Development Runner
 *
 * Simultaneously orchestrates:
 * 1. Web Dashboard (Next.js 16 on port 3000)
 * 2. Engine Pipeline & API (Fastify / Ingestion on port 3001)
 * 3. Optional Telemetry Simulator (Live or Scenario based)
 *
 * Handles graceful process cleanup on SIGINT / SIGTERM.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT_DIR, 'web');
const ENGINE_DIR = path.join(ROOT_DIR, 'engine');

// ANSI Color Codes
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  magenta: '\x1b[35m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

const args = process.argv.slice(2);
const withSim = args.includes('--sim');
const withSimWorst = args.includes('--sim-worst') || args.includes('--worst');
const withSimPenalties = args.includes('--sim-penalties') || args.includes('--penalties');

// Environment sanity checks
const webEnv = path.join(WEB_DIR, '.env.local');
const engineEnv = path.join(ENGINE_DIR, '.env');

if (!fs.existsSync(webEnv) && !fs.existsSync(path.join(WEB_DIR, '.env'))) {
  console.log(`${COLORS.yellow}Warning: web/.env.local not found. Copying web/.env.example if available...${COLORS.reset}`);
}
if (!fs.existsSync(engineEnv)) {
  console.log(`${COLORS.yellow}Warning: engine/.env not found. Ensure SUPABASE credentials are set in engine/.env${COLORS.reset}`);
}

const children = [];

function prefixStream(stream, prefix, color) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim().length > 0) {
        console.log(`${color}${prefix}${COLORS.reset} ${line}`);
      }
    }
  });
}

function startProcess(name, command, args, cwd, color) {
  const child = spawn(command, args, {
    cwd,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  children.push({ name, child });

  const prefix = `[${name}]`.padEnd(10);
  prefixStream(child.stdout, prefix, color);
  prefixStream(child.stderr, prefix, `${COLORS.red}${prefix}`);

  child.on('exit', (code, signal) => {
    if (signal !== 'SIGINT' && signal !== 'SIGTERM' && code !== 0 && code !== null) {
      console.log(`${COLORS.red}[${name}] exited with code ${code}${COLORS.reset}`);
    }
  });

  return child;
}

// 1. Start Web App (Next.js)
console.log(`${COLORS.green}▶ Starting Web App on http://localhost:3000 ...${COLORS.reset}`);
startProcess('WEB', 'npm', ['run', 'dev'], WEB_DIR, COLORS.cyan);

// 2. Start Telematics Engine
console.log(`${COLORS.green}▶ Starting Engine Ingestion on http://localhost:3001 ...${COLORS.reset}`);
startProcess('ENGINE', 'npm', ['run', 'dev'], ENGINE_DIR, COLORS.green);

// 3. Optional: Start Simulator
if (withSimWorst) {
  console.log(`${COLORS.magenta}▶ Starting Live Simulator [Worst Driver Preset] ...${COLORS.reset}`);
  setTimeout(() => {
    startProcess('SIM-WORST', 'npm', ['run', 'sim:live:worst'], ENGINE_DIR, COLORS.magenta);
  }, 2000);
} else if (withSimPenalties) {
  console.log(`${COLORS.magenta}▶ Starting Live Simulator [Driver Penalties Preset] ...${COLORS.reset}`);
  setTimeout(() => {
    startProcess('SIM-PEN', 'npm', ['run', 'sim:live:penalties'], ENGINE_DIR, COLORS.magenta);
  }, 2000);
} else if (withSim) {
  console.log(`${COLORS.magenta}▶ Starting Live Simulator [Mixed Fleet Preset] ...${COLORS.reset}`);
  setTimeout(() => {
    startProcess('SIM-LIVE', 'npm', ['run', 'sim:live'], ENGINE_DIR, COLORS.magenta);
  }, 2000);
}

console.log(`\n${COLORS.gray}Press Ctrl+C to stop all services simultaneously.${COLORS.reset}\n`);

// Graceful cleanup handler
function shutdown() {
  console.log(`\n${COLORS.yellow}[!] Shutting down all RoadScore services...${COLORS.reset}`);
  for (const { name, child } of children) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', child.pid, '/f', '/t']);
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      // ignore
    }
  }
  setTimeout(() => {
    process.exit(0);
  }, 600);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
