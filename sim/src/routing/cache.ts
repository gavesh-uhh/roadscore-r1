/**
 * Route Cache Manager
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SimulationRoute } from '../types.js';
import { buildRouteFromCoordinates } from './geo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const memoryCache = new Map<string, SimulationRoute>();

// Load pre-baked routes from JSON
let prebakedRoutesList: any[] = [];
try {
  const jsonPath = path.resolve(__dirname, 'cached-routes.json');
  if (fs.existsSync(jsonPath)) {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    prebakedRoutesList = JSON.parse(raw);
  }
} catch {
  // fallback
}

export function initRouteCache(): void {
  for (const raw of prebakedRoutesList) {
    const route = buildRouteFromCoordinates(
      raw.id,
      raw.name,
      raw.originName,
      raw.destinationName,
      raw.coordinates,
      raw.estimatedDurationS,
      true,
    );
    memoryCache.set(raw.id.toLowerCase(), route);
    const key = `${raw.originName.toLowerCase()}__${raw.destinationName.toLowerCase()}`;
    memoryCache.set(key, route);
  }
}

// Initialise cache on module load
initRouteCache();

export function saveRouteToMemoryCache(route: SimulationRoute): void {
  route.isCached = true;
  memoryCache.set(route.id.toLowerCase(), route);
  const key = `${route.originName.toLowerCase()}__${route.destinationName.toLowerCase()}`;
  memoryCache.set(key, route);
}

export function getPrebakedRoute(originName: string, destinationName: string): SimulationRoute | null {
  const normO = originName.trim().toLowerCase();
  const normD = destinationName.trim().toLowerCase();

  const directKey = `${normO}__${normD}`;
  if (memoryCache.has(directKey)) {
    return memoryCache.get(directKey)!;
  }

  // Fuzzy match
  for (const [k, r] of memoryCache.entries()) {
    const oMatch = r.originName.toLowerCase().includes(normO) || normO.includes(r.originName.toLowerCase());
    const dMatch = r.destinationName.toLowerCase().includes(normD) || normD.includes(r.destinationName.toLowerCase());
    if (oMatch && dMatch) {
      return r;
    }
  }

  return null;
}

export function getAllCachedRoutes(): SimulationRoute[] {
  const seen = new Set<string>();
  const list: SimulationRoute[] = [];
  for (const route of memoryCache.values()) {
    if (!seen.has(route.id)) {
      seen.add(route.id);
      list.push(route);
    }
  }
  return list;
}
