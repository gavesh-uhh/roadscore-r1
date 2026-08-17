/**
 * Geographic and Route Geometry Computation Utilities
 */

import type { LatLon, RoutePoint, SimulationRoute } from '../types.js';

export const EARTH_RADIUS_M = 6371000;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function haversineDistanceM(p1: LatLon, p2: LatLon): number {
  const dLat = (p2.lat - p1.lat) * DEG2RAD;
  const dLon = (p2.lon - p1.lon) * DEG2RAD;
  const lat1 = p1.lat * DEG2RAD;
  const lat2 = p2.lat * DEG2RAD;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function calculateBearingDeg(p1: LatLon, p2: LatLon): number {
  const dLon = (p2.lon - p1.lon) * DEG2RAD;
  const lat1 = p1.lat * DEG2RAD;
  const lat2 = p2.lat * DEG2RAD;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  let brng = Math.atan2(y, x) * RAD2DEG;
  if (brng < 0) brng += 360;
  return Math.round(brng);
}

export function buildRouteFromCoordinates(
  id: string,
  name: string,
  originName: string,
  destinationName: string,
  coordinates: [number, number][], // [lon, lat] per GeoJSON
  estimatedDurationS?: number,
  isCached = false,
): SimulationRoute {
  if (coordinates.length < 2) {
    throw new Error(`Route must contain at least 2 coordinate points, received ${coordinates.length}`);
  }

  const points: RoutePoint[] = [];
  let cumDistance = 0;

  for (let i = 0; i < coordinates.length; i++) {
    const [lon, lat] = coordinates[i]!;
    const cur: LatLon = { lat, lon };

    if (i === 0) {
      const nextLonLat = coordinates[1]!;
      const heading = calculateBearingDeg(cur, { lat: nextLonLat[1], lon: nextLonLat[0] });
      points.push({
        lat,
        lon,
        distanceFromStartM: 0,
        segmentHeadingDeg: heading,
      });
    } else {
      const prevLonLat = coordinates[i - 1]!;
      const prev: LatLon = { lat: prevLonLat[1], lon: prevLonLat[0] };
      const segDist = haversineDistanceM(prev, cur);
      cumDistance += segDist;

      const heading = calculateBearingDeg(prev, cur);
      points.push({
        lat,
        lon,
        distanceFromStartM: cumDistance,
        segmentHeadingDeg: heading,
      });
    }
  }

  const originLonLat = coordinates[0]!;
  const destLonLat = coordinates[coordinates.length - 1]!;

  return {
    id,
    name,
    originName,
    destinationName,
    origin: { lat: originLonLat[1], lon: originLonLat[0] },
    destination: { lat: destLonLat[1], lon: destLonLat[0] },
    coordinates,
    points,
    totalDistanceM: cumDistance,
    estimatedDurationS: estimatedDurationS || Math.round(cumDistance / 12.5),
    isCached,
    fetchedAt: Date.now(),
  };
}
