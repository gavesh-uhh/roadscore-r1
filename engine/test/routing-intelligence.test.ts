import { describe, it, expect } from 'vitest';
import { latLngToCell } from 'h3-js';
import {
  extractRouteH3Cells,
  evaluateRoute,
  haversineMeters,
  type RoadCellRecord,
  type DefectRecord,
} from '../../web/src/lib/routing/osrmEngine.js';

describe('RoadScore-R1 — Routing & Road Intelligence Invariants', () => {
  const START: [number, number] = [6.9450, 79.8480];
  const END: [number, number] = [6.9380, 79.8780];

  it('accurately extracts deduplicated H3-12 cells along a route polyline', () => {
    const polyline: [number, number][] = [
      [6.9450, 79.8480],
      [6.9415, 79.8630],
      [6.9380, 79.8780],
    ];

    const cells = extractRouteH3Cells(polyline, 10);
    expect(cells.length).toBeGreaterThan(10);

    // Verify all entries are valid H3 indexes and deduplicated
    const uniqueCells = new Set(cells);
    expect(uniqueCells.size).toBe(cells.length);

    // First and last points should match
    const firstExpected = latLngToCell(polyline[0]![0], polyline[0]![1], 12);
    const lastExpected = latLngToCell(polyline[2]![0], polyline[2]![1], 12);
    expect(cells).toContain(firstExpected);
    expect(cells).toContain(lastExpected);
  });

  it('returns Insufficient Data (null scores) when route has no H3 observations', () => {
    const polyline: [number, number][] = [
      [6.9450, 79.8480],
      [6.9380, 79.8780],
    ];
    const cells = extractRouteH3Cells(polyline, 10);

    // No observations in database
    const roadCells: RoadCellRecord[] = [];
    const roadDefects: DefectRecord[] = [];

    const evalResult = evaluateRoute(polyline, cells, roadCells, roadDefects);

    expect(evalResult.hasSufficientData).toBe(false);
    expect(evalResult.avgRoughness).toBeNull();
    expect(evalResult.smoothnessScore).toBeNull();
    expect(evalResult.coveragePct).toBe(0);
    expect(evalResult.coverageStatus).toBe('unmapped');
  });

  it('calculates metrics strictly from matching H3 cells without hardcoded baselines', () => {
    const polyline: [number, number][] = [
      [6.9450, 79.8480],
      [6.9415, 79.8630],
      [6.9380, 79.8780],
    ];
    const cells = extractRouteH3Cells(polyline, 10);

    // Populate road_cells for the first 10 cells with roughness = 45.0
    const observedCells = cells.slice(0, 10);
    const roadCells: RoadCellRecord[] = observedCells.map((h3) => ({
      h3_12: h3,
      roughness_index: 45.0,
      spike_count: 0,
      defect_confidence: 0.1,
      pass_count: 5,
    }));

    const roadDefects: DefectRecord[] = [];

    const evalResult = evaluateRoute(polyline, cells, roadCells, roadDefects);

    expect(evalResult.hasSufficientData).toBe(true);
    expect(evalResult.avgRoughness).toBe(45.0);
    expect(evalResult.potholesHit).toBe(0);
    // Smoothness score should be strictly derived: 100 - 45 * 0.85 = ~62
    expect(evalResult.smoothnessScore).toBe(Math.round(100 - 45 * 0.85));
    expect(evalResult.matchedCellsCount).toBe(10);
    expect(evalResult.coveragePct).toBe(Math.round((10 / cells.length) * 100));
  });

  it('detects confirmed defects within spatial proximity of the polyline', () => {
    const polyline: [number, number][] = [
      [6.9450, 79.8480],
      [6.9415, 79.8630],
      [6.9380, 79.8780],
    ];
    const cells = extractRouteH3Cells(polyline, 10);

    // Add a defect directly on the polyline waypoint
    const roadDefects: DefectRecord[] = [
      {
        id: 'defect-1',
        lat: 6.9415,
        lon: 79.8630,
        severity: 'high',
        confidence: 0.9,
      },
      {
        id: 'defect-far-away',
        lat: 7.1000,
        lon: 80.0000,
        severity: 'critical',
        confidence: 0.95,
      },
    ];

    const roadCells: RoadCellRecord[] = cells.slice(0, 10).map((h3) => ({
      h3_12: h3,
      roughness_index: 20.0,
      pass_count: 10,
    }));

    const evalResult = evaluateRoute(polyline, cells, roadCells, roadDefects);

    expect(evalResult.hasSufficientData).toBe(true);
    // Only defect-1 should be hit, defect-far-away must not be counted
    expect(evalResult.potholesHit).toBe(1);
    // Score reflects 1 defect penalty: 100 - 20 * 0.85 - 1 * 8 = 75
    expect(evalResult.smoothnessScore).toBe(Math.round(100 - 20 * 0.85 - 8));
  });

  it('computes haversine distance with high precision', () => {
    const d = haversineMeters(6.9450, 79.8480, 6.9380, 79.8780);
    expect(d).toBeGreaterThan(3000);
    expect(d).toBeLessThan(4000);
  });
});
