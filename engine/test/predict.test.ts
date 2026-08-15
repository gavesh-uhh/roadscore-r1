/**
 * Prediction and evaluation — ENGINE-PLAN §7.4.
 *
 * The §11 Phase 4 done-when criterion is the headline test:
 *
 *   "driving toward a known defect emits a road.hazard_ahead prediction with a
 *    sane ETA, and the outcome is closed out as hit."
 *
 * The evaluation tests matter just as much as the prediction ones: a predictor
 * that cannot be scored is not a predictor. In particular `not_traversed` must be
 * excluded from precision, or the figure measures route choice instead of skill.
 */

import { describe, it, expect } from 'vitest';
import { latLngToCell } from 'h3-js';
import { THRESHOLDS } from '../src/config/thresholds.js';
import { RoadMap, cellKey } from '../src/arbitrate/roadmap.js';
import { coneCells, project, predictAhead, PREDICTION_LIMITATION } from '../src/predict/ahead.js';
import { PredictionEvaluator, accuracyReport } from '../src/predict/evaluate.js';
import { newDeviceState } from '../src/domain/state.js';
import type { DeviceState } from '../src/domain/state.js';
import { Flags } from '../src/types.js';
import type { DeviceMeta, EventCandidate, Prediction, RoadDefect, Sample } from '../src/types.js';

const cfg = THRESHOLDS;

const LAT = 6.9271;
const LON = 79.8612;
/** Due east, so projecting forward increases longitude only. */
const HEADING = 90;

const META: DeviceMeta = {
  deviceId: 'dev-a',
  vehicleId: 'veh-1',
  driverId: 'drv-1',
  accelFsG: 2,
  gyroFsDps: 250,
  active: true,
};

let nextId = 1;

function state(): DeviceState {
  const st = newDeviceState({ ...META }, 0);
  st.bootId = 'dev-a:1000';
  return st;
}

function sample(over: Partial<Sample> = {}): Sample {
  return {
    telemetryId: nextId++,
    deviceId: 'dev-a',
    bootId: 'dev-a:1000',
    seq: nextId,
    uptimeMs: 1000,
    tSec: 1785564000 + nextId,
    timeQuality: 'gps',
    speed: 14, // ~50 km/h
    aLong: 0,
    yawRate: 0.01,
    vertRms: 0.5,
    vertPeak: 1.2,
    horizPeak: 0.4,
    magPeak: 1.3,
    heading: HEADING,
    lat: LAT,
    lon: LON,
    sats: 9,
    hdop: 0.9,
    micRms: 1100,
    micPeak: 1500,
    calibrationState: 'calibrated',
    calibrationAgeMs: 120000,
    gravityRef: { x: 0, y: 0, z: 16384 },
    samples: 50,
    wifiRssi: -62,
    droppedPosts: null,
    flags:
      Flags.CALIBRATED | Flags.GPS_FIX | Flags.GPS_USABLE | Flags.ACCEL_VALID |
      Flags.GYRO_VALID | Flags.MIC_VALID | Flags.MOVING,
    rawVertPeakCounts: 2000,
    rawMagPeakCounts: 2200,
    accelRaw: { x: 1, y: 2, z: 16300 },
    ...over,
  };
}

/** Build a fleet map with a confirmed defect `aheadM` metres due east. */
function setupDefect(aheadM: number): {
  map: RoadMap;
  defects: Map<string, RoadDefect>;
  targetH3: string;
  target: { lat: number; lon: number };
} {
  const map = new RoadMap(cfg);
  const target = project(LAT, LON, HEADING, aheadM);
  const sector = map.sectorOf(HEADING);

  // Three devices consistently spike there, so it is a genuine defect (§7.3).
  for (const deviceId of ['dev-a', 'dev-b', 'dev-c']) {
    for (let p = 0; p < 10; p++) {
      map.observe(
        sample({ deviceId, lat: target.lat, lon: target.lon, vertRms: 2.2, vertPeak: 6.0 }),
        true,
      );
    }
  }

  const targetH3 = map.indexOf(target.lat, target.lon);
  const defect: RoadDefect = {
    id: 'defect-1',
    h3_12: targetH3,
    headingSector: sector,
    lat: target.lat,
    lon: target.lon,
    confidence: 0.85,
    severity: 'high',
    distinctDevices: 3,
    spikeRate: 0.9,
    firstSeen: 1785560000,
    lastSeen: 1785564000,
    status: 'active',
  };

  return {
    map,
    defects: new Map([[cellKey(targetH3, sector), defect]]),
    targetH3,
    target,
  };
}

// ===========================================================================
// Geometry
// ===========================================================================

describe('§7.4 path projection', () => {
  it('projects a known distance and bearing accurately', () => {
    // 100 m due east should move longitude only, by ~0.0009° at this latitude.
    const p = project(LAT, LON, 90, 100);
    expect(p.lat).toBeCloseTo(LAT, 4);
    expect(p.lon).toBeGreaterThan(LON);
    // Round trip: project back west and land where we started.
    const back = project(p.lat, p.lon, 270, 100);
    expect(back.lat).toBeCloseTo(LAT, 6);
    expect(back.lon).toBeCloseTo(LON, 6);
  });

  it('scales the horizon with speed, clamped to the plan bounds', () => {
    // 15 s of look-ahead: at 5 m/s that is 75 m; at 40 m/s it clamps to 400 m.
    const slow = coneCells(LAT, LON, HEADING, 5, cfg);
    const fast = coneCells(LAT, LON, HEADING, 40, cfg);
    const maxOf = (cs: { distanceM: number }[]): number =>
      cs.reduce((m, c) => Math.max(m, c.distanceM), 0);

    expect(maxOf(slow)).toBeLessThanOrEqual(cfg.predict.maxHorizonM);
    expect(maxOf(fast)).toBeLessThanOrEqual(cfg.predict.maxHorizonM);
    expect(maxOf(fast)).toBeGreaterThan(maxOf(slow));
    // Even stationary-slow keeps the minimum horizon.
    expect(maxOf(coneCells(LAT, LON, HEADING, 1, cfg))).toBeGreaterThanOrEqual(
      cfg.predict.minHorizonM - cfg.predict.stepM,
    );
  });

  it('covers the cell straight ahead, and widens with distance', () => {
    const cells = coneCells(LAT, LON, HEADING, 14, cfg);
    const ahead = project(LAT, LON, HEADING, 50);
    const aheadH3 = latLngToCell(ahead.lat, ahead.lon, cfg.roadmap.h3Resolution);
    expect(cells.some((c) => c.h3 === aheadH3)).toBe(true);

    // The cone must be WIDER at range than near the vehicle. At 14 m/s the
    // horizon is 15 s x 14 m/s = 210 m, so compare bands inside that — asserting
    // cells beyond 300 m would be testing a horizon this speed never reaches.
    const horizon = 14 * cfg.predict.horizonS;
    expect(cells.reduce((m, c) => Math.max(m, c.distanceM), 0)).toBeLessThanOrEqual(horizon);

    const nearWidth = new Set(cells.filter((c) => c.distanceM <= 50).map((c) => c.h3)).size;
    const farWidth = new Set(
      cells.filter((c) => c.distanceM > horizon - 60 && c.distanceM <= horizon).map((c) => c.h3),
    ).size;
    expect(nearWidth).toBeGreaterThan(0);
    expect(farWidth).toBeGreaterThan(nearWidth);
  });

  it('returns cells nearest-first so the closest hazard is found first', () => {
    const cells = coneCells(LAT, LON, HEADING, 14, cfg);
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]!.distanceM).toBeGreaterThanOrEqual(cells[i - 1]!.distanceM);
    }
  });
});

// ===========================================================================
// §11 Phase 4 done-when
// ===========================================================================

describe('§7.4 hazard prediction', () => {
  it('warns about a known defect ahead with a sane ETA', () => {
    const { map, defects, targetH3 } = setupDefect(150);
    const st = state();
    const s = sample({ speed: 14 });

    const preds = predictAhead({ sample: s, state: st, map, defects, cfg });
    const hazard = preds.find((p) => p.type === 'road.hazard_ahead');

    expect(hazard).toBeDefined();
    expect(hazard!.targetH3_12).toBe(targetH3);
    expect(hazard!.targetDefectId).toBe('defect-1');
    // 150 m at 14 m/s is ~11 s. Allow for the cone's along-track sampling step.
    expect(hazard!.distanceM).toBeGreaterThan(100);
    expect(hazard!.distanceM).toBeLessThan(200);
    expect(hazard!.etaS).toBeGreaterThan(6);
    expect(hazard!.etaS).toBeLessThan(16);
    expect(hazard!.confidence).toBeCloseTo(0.85, 2);
    expect(hazard!.outcome).toBe('pending');
  });

  it('does not re-issue the same warning within a trip (§7.4 step 6)', () => {
    const { map, defects } = setupDefect(150);
    const st = state();

    let total = 0;
    // Ten consecutive seconds approaching the same defect.
    for (let k = 0; k < 10; k++) {
      const s = sample({ tSec: 1785564000 + k * 1 + 1, speed: 14 });
      total += predictAhead({ sample: s, state: st, map, defects, cfg }).length;
    }
    // The defect is warned about exactly once, not once per second.
    const hazards = [...st.predictedCells].length;
    expect(hazards).toBeGreaterThan(0);
    expect(total).toBe(hazards);
  });

  it('ignores a defect below the confidence floor', () => {
    const { map, defects, targetH3 } = setupDefect(150);
    const sector = map.sectorOf(HEADING);
    const d = defects.get(cellKey(targetH3, sector))!;
    // §7.4 step 4 joins only defects with confidence >= 0.6.
    defects.set(cellKey(targetH3, sector), { ...d, confidence: 0.4 });

    const preds = predictAhead({ sample: sample(), state: state(), map, defects, cfg });
    expect(preds.some((p) => p.type === 'road.hazard_ahead')).toBe(false);
  });

  it('ignores a repaired defect', () => {
    const { map, defects, targetH3 } = setupDefect(150);
    const sector = map.sectorOf(HEADING);
    const d = defects.get(cellKey(targetH3, sector))!;
    defects.set(cellKey(targetH3, sector), { ...d, status: 'repaired' });

    const preds = predictAhead({ sample: sample(), state: state(), map, defects, cfg });
    expect(preds.some((p) => p.type === 'road.hazard_ahead')).toBe(false);
  });

  it('predicts nothing without a usable fix, or while stationary', () => {
    const { map, defects } = setupDefect(150);
    expect(predictAhead({ sample: sample({ lat: null, lon: null }), state: state(), map, defects, cfg })).toHaveLength(0);
    expect(predictAhead({ sample: sample({ flags: Flags.CALIBRATED }), state: state(), map, defects, cfg })).toHaveLength(0);
    expect(predictAhead({ sample: sample({ speed: 0.5 }), state: state(), map, defects, cfg })).toHaveLength(0);
  });

  it('states its own limitation for the report (§7.4)', () => {
    expect(PREDICTION_LIMITATION).toContain('bends');
    expect(PREDICTION_LIMITATION).toContain('OSM');
  });
});

// ===========================================================================
// Closing the loop — what makes it a real predictor
// ===========================================================================

describe('§7.4 outcome evaluation', () => {
  function pred(over: Partial<Prediction> = {}): Prediction {
    return {
      id: 'p1',
      deviceId: 'dev-a',
      tripId: 't1',
      issuedAt: 1785564000,
      type: 'road.hazard_ahead',
      targetDefectId: 'defect-1',
      targetH3_12: 'x',
      distanceM: 150,
      etaS: 11,
      confidence: 0.85,
      outcome: 'pending',
      outcomeEventId: null,
      outcomeCheckedAt: null,
      ...over,
    };
  }

  function impactAt(lat: number, lon: number, h3: string | null): EventCandidate {
    return {
      type: 'road.impact_candidate',
      category: 'road',
      severity: 'medium',
      confidence: 0.7,
      deviceId: 'dev-a',
      bootId: 'dev-a:1000',
      anchorSeq: 1,
      occurredAt: 1785564011,
      timeQuality: 'gps',
      lat,
      lon,
      h3_12: h3,
      headingSector: 2,
      speedKmh: 50,
      magnitude: 6,
      magnitudeUnit: 'm/s2',
      severityCensored: false,
      attributedToDriver: false,
      roadDefectId: null,
      evidence: {},
      telemetryIds: [1],
    };
  }

  it('resolves to HIT when the vehicle reaches the cell and an impact fires', () => {
    const { map, targetH3, target } = setupDefect(150);
    const ev = new PredictionEvaluator(cfg);
    ev.track(pred({ targetH3_12: targetH3 }));
    expect(ev.openCount()).toBe(1);

    // The vehicle arrives at the target and hits something.
    const arrival = sample({ lat: target.lat, lon: target.lon, tSec: 1785564011 });
    const resolved = ev.observe(arrival, [impactAt(target.lat, target.lon, targetH3)], map);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.outcome).toBe('hit');
    expect(resolved[0]!.outcomeCheckedAt).toBe(1785564011);
    expect(ev.openCount()).toBe(0);
  });

  it('resolves to MISS when the vehicle reaches the cell and nothing happens', () => {
    const { map, targetH3, target } = setupDefect(150);
    const ev = new PredictionEvaluator(cfg);
    ev.track(pred({ targetH3_12: targetH3 }));

    const arrival = sample({ lat: target.lat, lon: target.lon, tSec: 1785564011 });
    const resolved = ev.observe(arrival, [], map);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.outcome).toBe('miss');
  });

  it('resolves to NOT_TRAVERSED when the driver goes somewhere else', () => {
    const { map, targetH3 } = setupDefect(150);
    const ev = new PredictionEvaluator(cfg);
    ev.track(pred({ targetH3_12: targetH3 }));

    // Far away, and long after the prediction's timeout.
    const elsewhere = sample({
      lat: 7.5,
      lon: 80.5,
      tSec: 1785564000 + cfg.predict.evaluationTimeoutS + 10,
    });
    const resolved = ev.observe(elsewhere, [], map);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.outcome).toBe('not_traversed');
  });

  it('keeps a prediction open while the vehicle is still en route', () => {
    const { map, targetH3 } = setupDefect(150);
    const ev = new PredictionEvaluator(cfg);
    ev.track(pred({ targetH3_12: targetH3 }));

    // Two seconds in, nowhere near the target yet.
    const enRoute = sample({ tSec: 1785564002 });
    expect(ev.observe(enRoute, [], map)).toHaveLength(0);
    expect(ev.openCount()).toBe(1);
  });

  it('closes out open predictions at trip end', () => {
    const ev = new PredictionEvaluator(cfg);
    ev.track(pred({ targetH3_12: 'a' }));
    ev.track(pred({ id: 'p2', targetH3_12: 'b' }));
    const closed = ev.closeDevice('dev-a', 1785564500);
    expect(closed).toHaveLength(2);
    expect(closed.every((p) => p.outcome === 'not_traversed')).toBe(true);
    expect(ev.openCount()).toBe(0);
  });
});

// ===========================================================================
// The accuracy figure the report needs
// ===========================================================================

describe('§7.4 accuracy report', () => {
  const p = (outcome: Prediction['outcome']): Prediction => ({
    id: Math.random().toString(36).slice(2),
    deviceId: 'dev-a',
    tripId: 't1',
    issuedAt: 1,
    type: 'road.hazard_ahead',
    targetDefectId: null,
    targetH3_12: 'x',
    distanceM: 100,
    etaS: 8,
    confidence: 0.8,
    outcome,
    outcomeEventId: null,
    outcomeCheckedAt: 2,
  });

  it('computes precision over judgeable predictions only', () => {
    // 8 hits, 2 misses → precision 0.8.
    const preds = [...Array(8).fill(null).map(() => p('hit')), p('miss'), p('miss')];
    const r = accuracyReport(preds);
    expect(r.precision).toBeCloseTo(0.8, 6);
    expect(r.evaluable).toBe(10);
  });

  it('EXCLUDES not_traversed from precision (§7.4)', () => {
    // The driver turning off the route must not count as a prediction error,
    // otherwise precision measures route choice rather than predictor quality.
    const withTurnOffs = [
      ...Array(8).fill(null).map(() => p('hit')),
      p('miss'),
      p('miss'),
      ...Array(50).fill(null).map(() => p('not_traversed')),
    ];
    const r = accuracyReport(withTurnOffs);
    expect(r.precision).toBeCloseTo(0.8, 6); // unchanged by the 50 turn-offs
    expect(r.notTraversed).toBe(50);
    expect(r.evaluable).toBe(10);
    expect(r.note).toContain('excluded from precision');
  });

  it('refuses to report recall without the false-negative count', () => {
    // A recall of 1.0 reported because nobody counted the misses would be worse
    // than no figure at all.
    const r = accuracyReport([p('hit'), p('hit')]);
    expect(r.recall).toBeNull();
    expect(r.f1).toBeNull();
  });

  it('computes recall and f1 when the unwarned impacts are known', () => {
    // 6 warned hazards hit, 4 hazards hit with no warning → recall 0.6.
    const r = accuracyReport([...Array(6).fill(null).map(() => p('hit')), p('miss')], 4);
    expect(r.recall).toBeCloseTo(0.6, 6);
    expect(r.precision).toBeCloseTo(6 / 7, 6);
    expect(r.f1).not.toBeNull();
    // f1 sits between precision and recall.
    expect(r.f1!).toBeGreaterThan(Math.min(r.precision!, r.recall!) - 1e-9);
    expect(r.f1!).toBeLessThan(Math.max(r.precision!, r.recall!) + 1e-9);
  });

  it('reports nothing rather than 0/0 on an empty set', () => {
    const r = accuracyReport([]);
    expect(r.precision).toBeNull();
    expect(r.hits).toBe(0);
    expect(r.pending).toBe(0);
  });

  it('counts pending separately from resolved', () => {
    const r = accuracyReport([p('hit'), p('pending'), p('pending')]);
    expect(r.pending).toBe(2);
    expect(r.evaluable).toBe(1);
  });
});
