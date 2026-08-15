/**
 * Road map and arbitration — ENGINE-PLAN §7.1-§7.3.
 *
 * The headline test is §11 Phase 3's own done-when criterion:
 *
 *   "the same pothole hit by >= 3 devices is excluded from scoring and appears in
 *    road_defects; a one-off impact is attributed to the driver."
 *
 * If that test passes, the project's central fairness claim is demonstrated. The
 * rest of this file defends the edges around it — especially the guard that stops
 * a single device establishing consensus for itself.
 */

import { describe, it, expect } from 'vitest';
import { THRESHOLDS, G } from '../src/config/thresholds.js';
import { RoadMap, speedNormalise, percentile, fitBeta, cellStdDev } from '../src/arbitrate/roadmap.js';
import { arbitrateCell, attributeImpact, reArbitrate, defectConfidence } from '../src/arbitrate/attribute.js';
import { Flags } from '../src/types.js';
import type { EventCandidate, RoadCell, Sample } from '../src/types.js';

const cfg = THRESHOLDS;

/** A pothole location and the direction of travel over it. */
const LAT = 6.9271;
const LON = 79.8612;
const HEADING = 90;

let nextId = 1;

/** A usable, calibrated, moving sample at a position. */
function sample(over: Partial<Sample> = {}): Sample {
  const speed = over.speed ?? 12; // 43 km/h — above the 15 km/h roughness floor
  return {
    telemetryId: nextId++,
    deviceId: 'dev-a',
    bootId: 'dev-a:1000',
    seq: nextId,
    uptimeMs: 1000,
    tSec: 1785564000 + nextId,
    timeQuality: 'gps',
    speed,
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
    flags: Flags.CALIBRATED | Flags.GPS_FIX | Flags.GPS_USABLE | Flags.ACCEL_VALID | Flags.GYRO_VALID | Flags.MIC_VALID | Flags.MOVING,
    rawVertPeakCounts: 2000,
    rawMagPeakCounts: 2200,
    accelRaw: { x: 1, y: 2, z: 16300 },
    ...over,
  };
}

/** An unattributed impact candidate, as §6.4's detector would emit it. */
function candidate(over: Partial<EventCandidate> = {}): EventCandidate {
  return {
    type: 'road.impact_candidate',
    category: 'road',
    severity: 'medium',
    confidence: 0.7,
    deviceId: 'dev-a',
    bootId: 'dev-a:1000',
    anchorSeq: 100,
    occurredAt: 1785564100,
    timeQuality: 'gps',
    lat: LAT,
    lon: LON,
    h3_12: null,
    headingSector: 2, // 90° → east
    speedKmh: 43,
    magnitude: 6.0,
    magnitudeUnit: 'm/s2',
    severityCensored: false,
    attributedToDriver: false,
    roadDefectId: null,
    evidence: { awaiting_arbitration: true },
    telemetryIds: [1],
    ...over,
  };
}

/** Drive `devices` vehicles over the cell, `passes` each, spiking a fraction. */
function populate(map: RoadMap, devices: string[], passes: number, spikeFraction: number): void {
  for (const deviceId of devices) {
    for (let p = 0; p < passes; p++) {
      const spiked = p < Math.round(passes * spikeFraction);
      map.observe(
        sample({
          deviceId,
          vertRms: spiked ? 2.2 : 0.5,
          vertPeak: spiked ? 6.0 : 1.2,
        }),
        spiked,
      );
    }
  }
}

// ===========================================================================
// §11 Phase 3 done-when: the headline claim
// ===========================================================================

describe('§7.3 arbitration — the fairness claim', () => {
  it('a pothole hit by >= 3 devices is a ROAD DEFECT, excluded from scoring', () => {
    const map = new RoadMap(cfg);
    // Three devices, 10 passes each, spiking 80 % of the time: a real pothole.
    populate(map, ['dev-a', 'dev-b', 'dev-c'], 10, 0.8);

    const outcome = attributeImpact(candidate(), map, cfg, 1785564200);

    expect(outcome.result.verdict).toBe('road_defect');
    expect(outcome.event.type).toBe('road.defect_observation');
    expect(outcome.event.category).toBe('road');
    // THE point: the driver is not blamed for the state of the road.
    expect(outcome.event.attributedToDriver).toBe(false);

    // …and it becomes a maintenance record.
    expect(outcome.defect).not.toBeNull();
    expect(outcome.defect!.distinctDevices).toBeGreaterThanOrEqual(3);
    expect(outcome.defect!.spikeRate).toBeGreaterThanOrEqual(cfg.arbitration.roadSpikeRate);
    expect(outcome.defect!.confidence).toBeGreaterThan(0.6);
    expect(outcome.defect!.status).toBe('active');
  });

  it('a one-off impact on a cell the fleet drives cleanly is the DRIVER’s', () => {
    const map = new RoadMap(cfg);
    // Three devices, 20 passes each, almost never spiking: the road is fine.
    populate(map, ['dev-a', 'dev-b', 'dev-c'], 20, 0.0);

    const outcome = attributeImpact(candidate(), map, cfg, 1785564200);

    expect(outcome.result.verdict).toBe('driver_event');
    expect(outcome.event.type).toBe('driver.avoidable_impact');
    expect(outcome.event.category).toBe('driver');
    expect(outcome.event.attributedToDriver).toBe(true);
    expect(outcome.defect).toBeNull();
  });

  it('ONE device cannot establish consensus for itself (§7.3 guard)', () => {
    // §7.3's stated confound: "a driver who habitually hits the same pothole on
    // their daily route will, in a small fleet, be the majority of passes and get
    // their own defect excused. Guard with distinct_devices >= 3."
    const map = new RoadMap(cfg);
    populate(map, ['dev-a'], 50, 1.0); // one device, spikes every single time

    const outcome = attributeImpact(candidate(), map, cfg, 1785564200);

    // Must NOT be excused as a road defect on one device's word.
    expect(outcome.result.verdict).toBe('undecided');
    expect(outcome.event.type).not.toBe('road.defect_observation');
    expect(outcome.defect).toBeNull();
  });

  it('UNDECIDED is unattributed, low-confidence and excluded from scoring', () => {
    const map = new RoadMap(cfg);
    // Ambiguous: spike rate lands between the driver (0.25) and road (0.60) bounds.
    populate(map, ['dev-a', 'dev-b', 'dev-c'], 10, 0.4);

    const outcome = attributeImpact(candidate(), map, cfg, 1785564200);

    expect(outcome.result.verdict).toBe('undecided');
    // A new fleet must not default to blaming the driver.
    expect(outcome.event.attributedToDriver).toBe(false);
    expect(outcome.event.confidence).toBeLessThan(cfg.arbitration.undecidedMaxConfidence);
    expect(outcome.event.evidence['eligible_for_rearbitration']).toBe(true);
  });

  it('an empty fleet map decides nothing, and blames nobody', () => {
    const map = new RoadMap(cfg);
    const outcome = attributeImpact(candidate(), map, cfg, 1785564200);
    expect(outcome.result.verdict).toBe('undecided');
    expect(outcome.event.attributedToDriver).toBe(false);
  });

  it('an impact with no position cannot be arbitrated, and is not blamed', () => {
    const map = new RoadMap(cfg);
    populate(map, ['dev-a', 'dev-b', 'dev-c'], 20, 0.0);
    const outcome = attributeImpact(candidate({ lat: null, lon: null }), map, cfg, 1785564200);
    expect(outcome.result.verdict).toBe('undecided');
    expect(outcome.event.attributedToDriver).toBe(false);
  });

  it('is retroactive: an undecided event is promoted once evidence arrives (§7.3)', () => {
    const map = new RoadMap(cfg);
    // Day one: one device, no consensus possible.
    populate(map, ['dev-a'], 5, 1.0);
    const first = attributeImpact(candidate(), map, cfg, 1785564200);
    expect(first.result.verdict).toBe('undecided');

    // Two more vehicles drive the same cell and hit the same thing.
    populate(map, ['dev-b', 'dev-c'], 10, 0.9);

    // The nightly job re-evaluates against the now-richer map.
    const promoted = reArbitrate([first.event], map, cfg, 1785564900);
    expect(promoted).toHaveLength(1);
    expect(promoted[0]!.result.verdict).toBe('road_defect');
    expect(promoted[0]!.event.attributedToDriver).toBe(false);
    expect(promoted[0]!.defect).not.toBeNull();
  });

  it('re-arbitration returns nothing when the verdict is still undecided', () => {
    const map = new RoadMap(cfg);
    populate(map, ['dev-a'], 5, 1.0);
    const c = candidate();
    expect(reArbitrate([c], map, cfg, 1785564900)).toHaveLength(0);
  });
});

// ===========================================================================
// The decision boundaries, directly
// ===========================================================================

describe('§7.3 decision boundaries', () => {
  const cell = (over: Partial<RoadCell>): RoadCell => ({
    h3_12: 'x',
    headingSector: 2,
    centroidLat: LAT,
    centroidLon: LON,
    passCount: 20,
    deviceCount: 4,
    spikeCount: 0,
    roughMean: 1.0,
    roughM2: 0.5,
    roughnessIndex: 20,
    defectConfidence: 0,
    lastPassAt: 1785564000,
    speedP85Kmh: 45,
    ...over,
  });

  it('spike_rate >= 0.60 with >= 3 devices is a road defect', () => {
    const r = arbitrateCell(cell({ spikeCount: 12 }), cfg); // 0.60 exactly
    expect(r.verdict).toBe('road_defect');
  });

  it('spike_rate <= 0.25 with >= 3 devices is a driver event', () => {
    const r = arbitrateCell(cell({ spikeCount: 5 }), cfg); // 0.25 exactly
    expect(r.verdict).toBe('driver_event');
  });

  it('the ambiguous band between them is undecided', () => {
    expect(arbitrateCell(cell({ spikeCount: 8 }), cfg).verdict).toBe('undecided'); // 0.40
    expect(arbitrateCell(cell({ spikeCount: 11 }), cfg).verdict).toBe('undecided'); // 0.55
  });

  it('two devices is never enough, however consistent', () => {
    expect(arbitrateCell(cell({ deviceCount: 2, spikeCount: 20 }), cfg).verdict).toBe('undecided');
  });

  it('defect confidence rises with spike rate and with witnesses', () => {
    const low = defectConfidence(0.6, 3, cfg);
    const higherRate = defectConfidence(0.95, 3, cfg);
    const moreDevices = defectConfidence(0.6, 12, cfg);
    expect(higherRate).toBeGreaterThan(low);
    expect(moreDevices).toBeGreaterThan(low);
    // Never claims certainty.
    expect(defectConfidence(1.0, 100, cfg)).toBeLessThan(1);
  });
});

// ===========================================================================
// §7.1 spatial indexing and §7.2 speed normalisation
// ===========================================================================

describe('§7.1 spatial indexing', () => {
  it('indexes at resolution 12 and separates the two directions of a road', () => {
    const map = new RoadMap(cfg);
    // Same place, opposite directions: different lanes, different defects.
    map.observe(sample({ heading: 90, deviceId: 'dev-a' }), true);
    map.observe(sample({ heading: 270, deviceId: 'dev-a' }), false);

    const east = map.sectorOf(90);
    const west = map.sectorOf(270);
    expect(east).not.toBe(west);

    const h3 = map.indexOf(LAT, LON);
    expect(h3).toHaveLength(15); // res-12 h3 index
    expect(map.get(h3, east)!.spikeCount).toBe(1);
    expect(map.get(h3, west)!.spikeCount).toBe(0);
  });

  it('matches a nearby position through the k-ring (§7.1 GPS error tolerance)', () => {
    const map = new RoadMap(cfg);
    populate(map, ['dev-a', 'dev-b', 'dev-c'], 10, 0.9);

    // ~10 m east — inside the GPS error budget, likely a neighbouring res-12 cell.
    const nearby = map.matchCell(LAT, LON + 0.00009, HEADING);
    expect(nearby).not.toBeNull();
    expect(nearby!.passCount).toBeGreaterThan(0);
  });

  it('returns null far from any observed cell', () => {
    const map = new RoadMap(cfg);
    populate(map, ['dev-a', 'dev-b', 'dev-c'], 10, 0.9);
    expect(map.matchCell(7.5, 80.5, HEADING)).toBeNull();
  });

  it('refuses observations that carry no roughness information', () => {
    const map = new RoadMap(cfg);
    // Below the 15 km/h floor (§7.2).
    expect(map.observe(sample({ speed: 2 }), false)).toBeNull();
    // Uncalibrated: the vertical channel is meaningless (§2.5).
    expect(map.observe(sample({ flags: Flags.GPS_FIX | Flags.GPS_USABLE }), false)).toBeNull();
    // No usable fix.
    expect(map.observe(sample({ flags: Flags.CALIBRATED | Flags.ACCEL_VALID }), false)).toBeNull();
    expect(map.size()).toBe(0);
  });
});

describe('§7.2 speed normalisation', () => {
  it('normalises to the 40 km/h reference', () => {
    const ref = cfg.roadmap.speedRefMps;
    expect(speedNormalise(1.0, ref, cfg)).toBeCloseTo(1.0, 6);
  });

  it('scales a slow pass UP so traffic does not look like fresh tarmac', () => {
    const ref = cfg.roadmap.speedRefMps;
    const slow = speedNormalise(1.0, ref / 2, cfg);
    expect(slow).toBeGreaterThan(1.0);
    // At beta = 1 the relationship is exactly inverse-linear.
    expect(slow).toBeCloseTo(2.0, 6);
  });

  it('clamps at the speed floor so a crawl cannot explode the estimate', () => {
    const atFloor = speedNormalise(1.0, cfg.roadmap.speedFloorMps, cfg);
    const belowFloor = speedNormalise(1.0, 0.1, cfg);
    expect(belowFloor).toBe(atFloor);
  });

  it('fits beta from passes over one cell at differing speeds (§7.2)', () => {
    // Synthesise a true beta of 1.0: rms = C / v.
    const obs = [4, 6, 8, 10, 12, 14].map((v) => ({ speedMps: v, rms: 12 / v }));
    const fit = fitBeta(obs);
    expect(fit).not.toBeNull();
    expect(fit!.beta).toBeCloseTo(1.0, 3);
    expect(fit!.r2).toBeGreaterThan(0.99);
  });

  it('refuses to fit beta when the speed spread is too narrow', () => {
    // All passes at nearly the same speed: the slope is noise, so decline.
    const obs = [10, 10.1, 10.2, 10.05].map((v) => ({ speedMps: v, rms: 1.2 }));
    expect(fitBeta(obs)).toBeNull();
    expect(fitBeta([{ speedMps: 10, rms: 1 }])).toBeNull();
  });
});

describe('cell statistics', () => {
  it('accumulates Welford mean and variance, and exposes a p85 speed', () => {
    const map = new RoadMap(cfg);
    for (const v of [8, 10, 12, 14, 16]) {
      map.observe(sample({ deviceId: 'dev-a', speed: v, vertRms: 0.6 }), false);
    }
    const h3 = map.indexOf(LAT, LON);
    const c = map.get(h3, map.sectorOf(HEADING))!;
    expect(c.passCount).toBe(5);
    expect(c.roughMean).toBeGreaterThan(0);
    expect(cellStdDev(c)).not.toBeNull();
    expect(c.speedP85Kmh).toBeGreaterThan(0);
    expect(c.roughnessIndex).toBeGreaterThanOrEqual(0);
    expect(c.roughnessIndex).toBeLessThanOrEqual(100);
  });

  it('a single pass has no standard deviation to report', () => {
    const map = new RoadMap(cfg);
    map.observe(sample(), false);
    const c = map.get(map.indexOf(LAT, LON), map.sectorOf(HEADING))!;
    expect(cellStdDev(c)).toBeNull();
  });

  it('percentile interpolates and handles degenerate input', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([5], 0.85)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.5)).toBe(5);
  });

  it('serves the §6.5 CellStatsLookup contract', () => {
    const map = new RoadMap(cfg);
    populate(map, ['dev-a', 'dev-b', 'dev-c'], 10, 0.5);
    const h3 = map.indexOf(LAT, LON);
    const sec = map.sectorOf(HEADING);
    expect(map.passCount(h3, sec)).toBe(30);
    expect(map.deviceCount(h3, sec)).toBe(3);
    expect(map.p85SpeedKmh(h3, sec)).not.toBeNull();
    expect(map.roughnessIndex(h3, sec)).not.toBeNull();
    expect(map.fleetMedianRoughness()).not.toBeNull();
    // Unknown cells report no evidence rather than zero-as-a-value.
    expect(map.p85SpeedKmh('nope', 0)).toBeNull();
    expect(map.passCount('nope', 0)).toBe(0);
  });

  it('round-trips through load() so a restart does not lose the map', () => {
    const map = new RoadMap(cfg);
    populate(map, ['dev-a', 'dev-b', 'dev-c'], 10, 0.7);
    const h3 = map.indexOf(LAT, LON);
    const sec = map.sectorOf(HEADING);
    const persisted = map.all().map((c) => ({ ...c, deviceIds: map.deviceIdsOf(c.h3_12, c.headingSector) }));

    const restored = new RoadMap(cfg);
    restored.load(persisted);
    expect(restored.deviceCount(h3, sec)).toBe(3);
    expect(restored.passCount(h3, sec)).toBe(30);
    // And the restored map still arbitrates the same way.
    expect(arbitrateCell(restored.get(h3, sec), cfg).verdict).toBe('road_defect');
  });
});
