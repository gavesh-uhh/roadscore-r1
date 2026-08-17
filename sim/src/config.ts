/**
 * RoadScore Simulator Configuration & Environment Loader
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SimConfig {
  supabaseUrl: string;
  supabaseKey: string;
  databaseUrl?: string;
  osrmEndpoint: string;
  h3Resolution: number;
  tickRateMs: number;
  defaultSimSpeed: number;
  sourceTag: string;
  offlineMode: boolean;
  maxLogEntries: number;
}

/** Look for .env files in root, engine, and web folders */
export function loadAllEnvFiles(): void {
  const possiblePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'engine/.env'),
    path.resolve(process.cwd(), 'web/.env.local'),
    path.resolve(process.cwd(), 'web/.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../engine/.env'),
    path.resolve(__dirname, '../../web/.env.local'),
  ];

  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {
        // ignore read errors
      }
    }
  }
}

export function getSimConfig(): SimConfig {
  loadAllEnvFiles();

  return {
    supabaseUrl: process.env.SUPABASE_URL || 'https://wjsvuyqgpmlgpzpiuhsd.supabase.co',
    supabaseKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      '',
    databaseUrl: process.env.DATABASE_URL,
    osrmEndpoint:
      process.env.OSRM_ENDPOINT ||
      process.env.ROUTING_URL ||
      'https://router.project-osrm.org',
    h3Resolution: Number(process.env.H3_RESOLUTION || '12'),
    tickRateMs: Number(process.env.SIM_TICK_RATE_MS || '1000'),
    defaultSimSpeed: Number(process.env.SIM_SPEED || '1'),
    sourceTag: 'roadscore-sim',
    offlineMode: process.env.SIM_OFFLINE === 'true',
    maxLogEntries: 500,
  };
}
