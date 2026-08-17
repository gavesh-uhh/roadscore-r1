/**
 * Real OSM Routing Client using OSRM
 */

import type { LatLon, SimulationRoute } from '../types.js';
import { buildRouteFromCoordinates } from './geo.js';
import { getPrebakedRoute, saveRouteToMemoryCache } from './cache.js';

export async function fetchOsrmRoute(
  origin: LatLon,
  destination: LatLon,
  originName = 'Origin',
  destinationName = 'Destination',
  osrmEndpoint = 'https://router.project-osrm.org',
): Promise<SimulationRoute> {
  const routeId = `${originName.replace(/\s+/g, '_')}_to_${destinationName.replace(/\s+/g, '_')}`.toLowerCase();

  // 1. Check pre-baked or in-memory cache first
  const cached = getPrebakedRoute(originName, destinationName);
  if (cached) {
    return cached;
  }

  // 2. Fetch live from OSRM
  const url = `${osrmEndpoint.replace(/\/$/, '')}/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson&steps=false`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'RoadScore-Simulator/1.0' },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`OSRM API responded with status ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error(`OSRM returned no routes (code: ${data.code})`);
    }

    const primaryRoute = data.routes[0];
    const coords: [number, number][] = primaryRoute.geometry.coordinates;

    const simRoute = buildRouteFromCoordinates(
      routeId,
      `${originName} → ${destinationName}`,
      originName,
      destinationName,
      coords,
      primaryRoute.duration,
      false,
    );

    saveRouteToMemoryCache(simRoute);
    return simRoute;
  } catch (err: any) {
    const fallback = getPrebakedRoute(originName, destinationName);
    if (fallback) {
      return fallback;
    }
    throw new Error(
      `OSRM routing failed: ${err.message}. Ensure internet connectivity or use cached preset routes.`,
    );
  }
}
