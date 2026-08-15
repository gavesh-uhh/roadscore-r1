#!/usr/bin/env node

/**
 * RoadScore Monorepo Production Runner
 *
 * Simultaneously runs production builds:
 * 1. Web Dashboard (Next.js 16 production server)
 * 2. Engine Ingestion (compiled node dist/index.js)
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT_DIR, 'web');
const ENGINE_DIR = path.join(ROOT_DIR, 'engine');

const COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

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
    shell: true,
    env: { ...process.env, NODE_ENV: 'production', FORCE_COLOR: '1' },
  });

  children.push({ name, child });

  const prefix = `[${name}]`.padEnd(10);
  prefixStream(child.stdout, prefix, color);
  prefixStream(child.stderr, prefix, `${COLORS.red}${prefix}`);

  return child;
}

console.log(`${COLORS.green}▶ Starting Production Web App on http://localhost:3000 ...${COLORS.reset}`);
startProcess('WEB-PROD', 'npm', ['run', 'start'], WEB_DIR, COLORS.cyan);

console.log(`${COLORS.green}▶ Starting Production Engine on http://localhost:3001 ...${COLORS.reset}`);
startProcess('ENGINE-PROD', 'npm', ['run', 'start'], ENGINE_DIR, COLORS.green);

function shutdown() {
  console.log(`\n${COLORS.yellow}🛑 Shutting down production services...${COLORS.reset}`);
  for (const { child } of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
