import { latLngToCell, gridDisk } from 'h3-js';

export type PresetType = 'safe' | 'fast' | 'balanced';

export interface LocationItem {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface RoutePreset {
  id: PresetType;
  title: string;
  subtitle: string;
  badge: string;
  isRecommended: boolean;
  distanceKm: number;
  durationMins: number;
  potholesHit: number | null;
  smoothnessScore: number | null; // 0 - 100 or null if insufficient telemetry
  avgRoughness: number | null;
  coveragePct: number; // 0 - 100% of route with actual fleet H3 passes
  coverageStatus: 'verified' | 'partial' | 'sparse' | 'unmapped';
  hasSufficientData: boolean;
  color: string;
  dashArray?: string;
  polyline: [number, number][]; // [lat, lon] array
  traversedH3Cells: string[];
}

export interface DefectRecord {
  id: string;
  type?: string;
  severity?: string;
  lat?: number | null;
  lon?: number | null;
  confidence?: number;
}

export interface RoadCellRecord {
  h3_12?: string;
  roughness_index?: number;
  spike_count?: number;
  defect_confidence?: number;
  pass_count?: number;
  speed_p85_kmh?: number;
}

// Popular logistics depot presets
export const PRESET_LOCATIONS: LocationItem[] = [
  {
    id: 'colombo-port',
    name: 'Colombo Port Container Terminal (JCT)',
    lat: 6.9450,
    lon: 79.8480,
  },
  {
    id: 'orugodawatta-icd',
    name: 'Orugodawatta Inland Container Depot',
    lat: 6.9380,
    lon: 79.8780,
  },
  {
    id: 'colombo-central',
    name: 'Colombo Central Logistics Hub (Fort)',
    lat: 6.9310,
    lon: 79.8620,
  },
  {
    id: 'biyagama-ftz',
    name: 'Biyagama Export Processing Zone (EPZ)',
    lat: 6.9400,
    lon: 79.9920,
  },
  {
    id: 'mt-lavinia-depot',
    name: 'Mount Lavinia Cold-Chain Terminal',
    lat: 6.8380,
    lon: 79.8640,
  },
  {
    id: 'kaduwela-hub',
    name: 'Kaduwela Express Interchange Depot',
    lat: 6.9320,
    lon: 79.9800,
  },
  {
    id: 'katunayake-airport',
    name: 'Katunayake Air Cargo Terminal (BIA)',
    lat: 7.1750,
    lon: 79.8850,
  },
];

// Haversine distance in meters
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export interface OsrmRouteResult {
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
}

/**
 * Fetch genuine street-level route alternatives from OSRM driving service.
 * Never generates synthetic or mathematical bezier geometry.
 */
export async function fetchOsrmRoutes(
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number,
  waypoint?: [number, number]
): Promise<OsrmRouteResult[]> {
  try {
    let url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};`;
    if (waypoint) {
      url += `${waypoint[1]},${waypoint[0]};`;
    }
    url += `${endLon},${endLat}?overview=full&geometries=geojson&alternatives=true`;

    const res = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.routes || !Array.isArray(data.routes) || data.routes.length === 0) {
      return [];
    }

    return data.routes.map((r: any) => {
      const coords: [number, number][] = (r.geometry?.coordinates || []).map(
        (c: [number, number]) => [c[1], c[0]] // GeoJSON [lon, lat] -> Leaflet [lat, lon]
      );
      return {
        coordinates: coords,
        distanceM: Number(r.distance || 0),
        durationS: Number(r.duration || 0),
      };
    }).filter((r: OsrmRouteResult) => r.coordinates.length > 1 && r.distanceM > 0);
  } catch (err) {
    console.warn('OSRM route fetch failed:', err);
    return [];
  }
}

/**
 * Accurately sample deduplicated H3-12 cells (~9.4m resolution) along actual OSRM road geometry.
 */
export function extractRouteH3Cells(polyline: [number, number][], stepMeters: number = 8): string[] {
  if (polyline.length === 0) return [];

  const cellSet = new Set<string>();

  for (let i = 0; i < polyline.length - 1; i++) {
    const p1 = polyline[i];
    const p2 = polyline[i + 1];
    const segmentDist = haversineMeters(p1[0], p1[1], p2[0], p2[1]);
    const steps = Math.max(1, Math.ceil(segmentDist / stepMeters));

    for (let s = 0; s <= steps; s++) {
      const frac = s / steps;
      const lat = p1[0] + frac * (p2[0] - p1[0]);
      const lon = p1[1] + frac * (p2[1] - p1[1]);
      try {
        const cell = latLngToCell(lat, lon, 12);
        if (cell) cellSet.add(cell);
      } catch {
        // ignore invalid coordinates
      }
    }
  }

  // Ensure final point is indexed
  const last = polyline[polyline.length - 1];
  try {
    const lastCell = latLngToCell(last[0], last[1], 12);
    if (lastCell) cellSet.add(lastCell);
  } catch {
    // ignore
  }

  return Array.from(cellSet);
}

/**
 * Evaluates route polyline strictly against real Supabase H3 spatial cells and confirmed defects.
 * No hardcoded baselines, no forced zeros, no fabricated precision.
 */
export function evaluateRoute(
  polyline: [number, number][],
  traversedH3Cells: string[],
  roadCells: RoadCellRecord[],
  roadDefects: DefectRecord[]
): {
  potholesHit: number | null;
  smoothnessScore: number | null;
  avgRoughness: number | null;
  matchedCellsCount: number;
  totalRouteCellsCount: number;
  coveragePct: number;
  coverageStatus: 'verified' | 'partial' | 'sparse' | 'unmapped';
  hasSufficientData: boolean;
} {
  const totalRouteCellsCount = traversedH3Cells.length;

  if (totalRouteCellsCount === 0 || polyline.length === 0) {
    return {
      potholesHit: null,
      smoothnessScore: null,
      avgRoughness: null,
      matchedCellsCount: 0,
      totalRouteCellsCount: 0,
      coveragePct: 0,
      coverageStatus: 'unmapped',
      hasSufficientData: false,
    };
  }

  // Fast cell map lookup
  const cellMap = new Map<string, RoadCellRecord>();
  roadCells.forEach((c) => {
    if (c.h3_12) cellMap.set(c.h3_12, c);
  });

  const validDefects = roadDefects.filter(
    (d) => d.lat && d.lon && (d.confidence ?? 1) >= 0.5
  );

  let defectHits = 0;

  // 1. Defect proximity check along route polyline (within 25 meters)
  const hitDefectIds = new Set<string>();
  for (const d of validDefects) {
    for (const p of polyline) {
      if (haversineMeters(p[0], p[1], d.lat!, d.lon!) <= 25) {
        hitDefectIds.add(d.id);
        break;
      }
    }
  }
  defectHits = hitDefectIds.size;

  // 2. Traversed H3-12 cells evaluation
  // Track matched route cells and unique observation records to avoid duplicate accumulation
  const matchedRouteCells = new Set<string>();
  const matchedObservationRecords = new Map<string, RoadCellRecord>();

  traversedH3Cells.forEach((h3Index) => {
    let matched = cellMap.get(h3Index);

    // If exact cell unobserved, check 1-ring neighborhood (~10m)
    if (!matched) {
      try {
        const neighbors = gridDisk(h3Index, 1);
        for (const n of neighbors) {
          const found = cellMap.get(n);
          if (found) {
            matched = found;
            break;
          }
        }
      } catch {
        // ignore gridDisk error
      }
    }

    if (matched && matched.roughness_index !== undefined && matched.roughness_index !== null) {
      matchedRouteCells.add(h3Index);
      const recordKey = matched.h3_12 || h3Index;
      if (!matchedObservationRecords.has(recordKey)) {
        matchedObservationRecords.set(recordKey, matched);
      }
    }
  });

  // Calculate actual coverage based on unique route H3 cells
  const matchedCellsCount = matchedObservationRecords.size;
  const coveragePct = Math.min(
    100,
    Math.round((matchedRouteCells.size / Math.max(1, totalRouteCellsCount)) * 100)
  );

  const hasSufficientData = matchedCellsCount >= 3 && (coveragePct >= 10 || matchedCellsCount >= 5);

  // If insufficient data: do not fabricate roughness or smoothness
  if (!hasSufficientData) {
    return {
      potholesHit: defectHits > 0 ? defectHits : null,
      smoothnessScore: null,
      avgRoughness: null,
      matchedCellsCount,
      totalRouteCellsCount,
      coveragePct,
      coverageStatus: coveragePct > 0 ? 'sparse' : 'unmapped',
      hasSufficientData: false,
    };
  }

  // Compute metrics strictly from observed telemetry
  let totalRoughness = 0;
  let spikeHits = 0;
  matchedObservationRecords.forEach((rec) => {
    totalRoughness += Number(rec.roughness_index || 0);
    if ((rec.spike_count ?? 0) > 0 || (rec.defect_confidence ?? 0) >= 0.6) {
      spikeHits++;
    }
  });

  const avgRoughness = Number(
    (totalRoughness / Math.max(1, matchedObservationRecords.size)).toFixed(1)
  );
  const totalDefects = defectHits + spikeHits;

  // Smoothness score strictly derived from observed roughness and verified defects
  const smoothnessScore = Math.max(
    0,
    Math.min(100, Math.round(100 - avgRoughness * 0.85 - totalDefects * 8))
  );

  const coverageStatus: 'verified' | 'partial' | 'sparse' =
    coveragePct >= 65 ? 'verified' : coveragePct >= 20 ? 'partial' : 'sparse';

  return {
    potholesHit: totalDefects,
    smoothnessScore,
    avgRoughness,
    matchedCellsCount,
    totalRouteCellsCount,
    coveragePct,
    coverageStatus,
    hasSufficientData: true,
  };
}

/**
 * Calculates genuine route alternatives using real OSRM road network geometry
 * and evaluates each route strictly against H3 road telemetry.
 * Returns empty array if routing service is unreachable (never creates synthetic geometry).
 */
export async function calculateThreePresets(
  origin: LocationItem,
  destination: LocationItem,
  roadCells: RoadCellRecord[] = [],
  roadDefects: DefectRecord[] = []
): Promise<RoutePreset[]> {
  const start: [number, number] = [origin.lat, origin.lon];
  const end: [number, number] = [destination.lat, destination.lon];

  // 1. Fetch direct OSRM routes (with alternatives=true)
  const primaryRoutes = await fetchOsrmRoutes(start[0], start[1], end[0], end[1]);

  if (primaryRoutes.length === 0) {
    // Graceful routing unavailable state - zero fabricated geometry
    return [];
  }

  // Collect candidate genuine road routes
  const candidateRoutes: OsrmRouteResult[] = [...primaryRoutes];

  // If OSRM only returned 1 direct route, fetch real road detour alternatives via intermediate street waypoints
  if (candidateRoutes.length < 2) {
    const midLat = (start[0] + end[0]) / 2;
    const midLon = (start[1] + end[1]) / 2;
    const dLat = end[0] - start[0];
    const dLon = end[1] - start[1];
    const len = Math.sqrt(dLat * dLat + dLon * dLon) || 1;

    // Alternative street corridor waypoint 1
    const wp1: [number, number] = [midLat - (dLon / len) * 0.008, midLon + (dLat / len) * 0.008];
    const altRoutes1 = await fetchOsrmRoutes(start[0], start[1], end[0], end[1], wp1);
    if (altRoutes1.length > 0) {
      candidateRoutes.push(altRoutes1[0]);
    }

    // Alternative street corridor waypoint 2
    if (candidateRoutes.length < 3) {
      const wp2: [number, number] = [midLat + (dLon / len) * 0.006, midLon - (dLat / len) * 0.006];
      const altRoutes2 = await fetchOsrmRoutes(start[0], start[1], end[0], end[1], wp2);
      if (altRoutes2.length > 0) {
        candidateRoutes.push(altRoutes2[0]);
      }
    }
  }

  // Deduplicate candidate routes by geometry signature
  const uniqueRoutes: OsrmRouteResult[] = [];
  const seenDistances = new Set<number>();
  for (const cr of candidateRoutes) {
    const distKey = Math.round(cr.distanceM / 10);
    if (!seenDistances.has(distKey)) {
      seenDistances.add(distKey);
      uniqueRoutes.push(cr);
    }
    if (uniqueRoutes.length >= 3) break;
  }

  // If only 1 unique route found, use it as primary
  const evaluatedCandidates = uniqueRoutes.map((routeResult) => {
    const traversedH3Cells = extractRouteH3Cells(routeResult.coordinates);
    const evaluation = evaluateRoute(
      routeResult.coordinates,
      traversedH3Cells,
      roadCells,
      roadDefects
    );
    const distanceKm = Number((routeResult.distanceM / 1000).toFixed(1));
    const durationMins = Math.max(1, Math.round(routeResult.durationS / 60));

    return {
      routeResult,
      traversedH3Cells,
      evaluation,
      distanceKm,
      durationMins,
    };
  });

  // Rank routes based on genuine evidence:
  // - Fast Route: Shortest transit duration from OSRM
  // - Safe Route: Highest verified smoothness / lowest roughness & potholes
  // - Balanced Route: Moderate trade-off
  const sortedByTime = [...evaluatedCandidates].sort((a, b) => a.durationMins - b.durationMins);
  const fastCandidate = sortedByTime[0];

  const sortedBySafety = [...evaluatedCandidates].sort((a, b) => {
    const scoreA = a.evaluation.smoothnessScore ?? -1;
    const scoreB = b.evaluation.smoothnessScore ?? -1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return (a.evaluation.potholesHit ?? 999) - (b.evaluation.potholesHit ?? 999);
  });

  const safeCandidate = sortedBySafety[0] || fastCandidate;
  const remainingCandidates = evaluatedCandidates.filter(
    (c) => c !== fastCandidate && c !== safeCandidate
  );
  const balancedCandidate = remainingCandidates[0] || evaluatedCandidates[1] || fastCandidate;

  // Build RoutePreset objects with 100% genuine data
  const fastPreset: RoutePreset = {
    id: 'fast',
    title: 'Fast Route',
    subtitle: fastCandidate.evaluation.hasSufficientData
      ? `Shortest transit time via arterial road network (${fastCandidate.durationMins} mins).`
      : `Shortest road network transit time (${fastCandidate.durationMins} mins). Telemetry unmapped.`,
    badge: 'Fastest',
    isRecommended: !safeCandidate.evaluation.hasSufficientData || fastCandidate === safeCandidate,
    distanceKm: fastCandidate.distanceKm,
    durationMins: fastCandidate.durationMins,
    potholesHit: fastCandidate.evaluation.potholesHit,
    smoothnessScore: fastCandidate.evaluation.smoothnessScore,
    avgRoughness: fastCandidate.evaluation.avgRoughness,
    coveragePct: fastCandidate.evaluation.coveragePct,
    coverageStatus: fastCandidate.evaluation.coverageStatus,
    hasSufficientData: fastCandidate.evaluation.hasSufficientData,
    color: '#ef4444', // Red
    dashArray: '6, 6',
    polyline: fastCandidate.routeResult.coordinates,
    traversedH3Cells: fastCandidate.traversedH3Cells,
  };

  const safePreset: RoutePreset = {
    id: 'safe',
    title: 'Safe Route',
    subtitle: safeCandidate.evaluation.hasSufficientData
      ? `Surface-optimized road route based on ${safeCandidate.evaluation.coveragePct}% verified fleet H3 telemetry.`
      : 'Alternative road corridor. Insufficient fleet observations to verify surface quality.',
    badge: safeCandidate.evaluation.hasSufficientData ? 'Recommended' : 'Alternative',
    isRecommended: safeCandidate.evaluation.hasSufficientData && safeCandidate !== fastCandidate,
    distanceKm: safeCandidate.distanceKm,
    durationMins: safeCandidate.durationMins,
    potholesHit: safeCandidate.evaluation.potholesHit,
    smoothnessScore: safeCandidate.evaluation.smoothnessScore,
    avgRoughness: safeCandidate.evaluation.avgRoughness,
    coveragePct: safeCandidate.evaluation.coveragePct,
    coverageStatus: safeCandidate.evaluation.coverageStatus,
    hasSufficientData: safeCandidate.evaluation.hasSufficientData,
    color: '#10b981', // Emerald Green
    polyline: safeCandidate.routeResult.coordinates,
    traversedH3Cells: safeCandidate.traversedH3Cells,
  };

  const presets: RoutePreset[] = [safePreset, fastPreset];

  if (uniqueRoutes.length >= 2 && balancedCandidate !== fastCandidate && balancedCandidate !== safeCandidate) {
    const balancedPreset: RoutePreset = {
      id: 'balanced',
      title: 'Balanced Route',
      subtitle: balancedCandidate.evaluation.hasSufficientData
        ? `Intermediate corridor balancing transit time and observed surface roughness.`
        : 'Alternative road network corridor. Unmapped surface telemetry.',
      badge: 'Balanced',
      isRecommended: false,
      distanceKm: balancedCandidate.distanceKm,
      durationMins: balancedCandidate.durationMins,
      potholesHit: balancedCandidate.evaluation.potholesHit,
      smoothnessScore: balancedCandidate.evaluation.smoothnessScore,
      avgRoughness: balancedCandidate.evaluation.avgRoughness,
      coveragePct: balancedCandidate.evaluation.coveragePct,
      coverageStatus: balancedCandidate.evaluation.coverageStatus,
      hasSufficientData: balancedCandidate.evaluation.hasSufficientData,
      color: '#f59e0b', // Amber
      polyline: balancedCandidate.routeResult.coordinates,
      traversedH3Cells: balancedCandidate.traversedH3Cells,
    };
    presets.push(balancedPreset);
  }

  return presets;
}
