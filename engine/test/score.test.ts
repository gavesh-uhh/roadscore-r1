/**
 * Scoring — ENGINE-PLAN §8, and the §11 Phase 5 done-when:
 *
 *   "a driver's daily score reconciles against its breakdown by hand."
 *
 * The most important tests here are the exclusions. §8's fairness claim is that a
 * driver is never penalised for the state of the road or for a device fault, and
 * that claim is only as good as these assertions.
 */

import { describe, it, expect } from 'vitest';
import { THRESHOLDS, RULE_VERSION } from '../src/config/thresholds.js';
import {
  computeScore,
  exclusionReason,
  isScorable,
  penaltyFor,
  reconcile,
  type ScorableEvent,
} from '../src/score/penalties.js';
import { dayBounds, groupForRollup, rollupDaily, scoreTrip, tripIsLowConfidence } from '../src/score/rollup.js';
import type { Trip } from '../src/types.js';

const cfg = THRESHOLDS;

function ev(over: Partial<ScorableEvent> = {}): ScorableEvent {
  return {
    type: 'driver.harsh_brake',
    category: 'driver',
    severity: 'medium',
    confidence: 1,
    attributedToDriver: true,
    severityCensored: false,
    eventKey: 'k1',
    ...over,
  };
}

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    deviceId: 'dev-a',
    driverId: 'drv-1',
    vehicleId: 'veh-1',
    bootId: 'dev-a:1000',
    startedAt: 1785564000,
    endedAt: 1785567600,
    startLat: 6.9,
    startLon: 79.8,
    endLat: 6.95,
    endLon: 79.85,
    distanceM: 10_000,
    durationS: 3600,
    movingS: 3000,
    idleS: 600,
    maxSpeedKmh: 80,
    speedSumKmh: 0,
    speedSamples: 0,
    avgSpeedKmh: 45,
    telemetryFrom: 1,
    telemetryTo: 3600,
    gpsFixRows: 3550,
    totalRows: 3600,
    gpsCoverage: 0.986,
    status: 'closed',
    ...over,
  };
}

// ===========================================================================
// The fairness gate — the project's central claim
// ===========================================================================

describe('§8 exclusions — the fairness claim', () => {
  it('a ROAD DEFECT never penalises the driver', () => {
    const e = ev({
      type: 'road.defect_observation',
      category: 'road',
      attributedToDriver: false,
    });
    expect(isScorable(e, cfg)).toBe(false);
    expect(exclusionReason(e, cfg)).toContain('not attributed to the driver');
    expect(penaltyFor(e, cfg)).toBeNull();
  });

  it('an UNDECIDED impact never penalises the driver', () => {
    // §7.3: undecided impacts are "excluded from scoring until evidence arrives".
    const e = ev({
      type: 'road.impact_candidate',
      category: 'road',
      attributedToDriver: false,
      confidence: 0.49,
    });
    expect(isScorable(e, cfg)).toBe(false);
  });

  it('EVERY integrity event is excluded, and doubly so', () => {
    const types = [
      'integrity.data_gap',
      'integrity.device_reboot',
      'integrity.mount_shift',
      'integrity.calibration_stale',
      'integrity.sensor_degraded',
      'integrity.gps_degraded',
      'integrity.upload_loss',
    ] as const;
    for (const type of types) {
      expect(isScorable(ev({ type, category: 'integrity', attributedToDriver: false }), cfg)).toBe(false);
      // Defence in depth: even if one were somehow marked attributed, the
      // category check still excludes it.
      expect(isScorable(ev({ type, category: 'integrity', attributedToDriver: true }), cfg)).toBe(false);
    }
  });

  it('a suspected collision is an ALERT, not a penalty (§2.7)', () => {
    // "Detectable, but severity unquantifiable — treat as an alert, not a score
    // input." Enforced by weight 0.
    const e = ev({ type: 'driver.collision_suspected', severity: 'critical', attributedToDriver: true });
    expect(isScorable(e, cfg)).toBe(false);
    expect(exclusionReason(e, cfg)).toContain('weight 0');
  });

  it("'info' severity is context, not misconduct", () => {
    // A corner happening is not a fault; only an excessive one is.
    expect(isScorable(ev({ type: 'driver.sharp_corner', severity: 'info' }), cfg)).toBe(false);
  });

  it('an AVOIDABLE impact — arbitration said driver — DOES count', () => {
    // The other side of §7.3: when the fleet drives the cell cleanly, the impact
    // is the driver's and must score.
    const e = ev({ type: 'driver.avoidable_impact', category: 'driver', attributedToDriver: true });
    expect(isScorable(e, cfg)).toBe(true);
    expect(penaltyFor(e, cfg)!.penalty).toBeGreaterThan(0);
  });

  it('records WHY each event was excluded, for the driver to see', () => {
    const s = computeScore(
      {
        subjectType: 'trip',
        subjectId: 't1',
        periodStart: 0,
        periodEnd: 3600,
        distanceKm: 10,
        events: [
          ev({ eventKey: 'a' }),
          ev({ eventKey: 'b', category: 'road', attributedToDriver: false, type: 'road.defect_observation' }),
          ev({ eventKey: 'c', category: 'integrity', attributedToDriver: false, type: 'integrity.data_gap' }),
        ],
      },
      cfg,
      RULE_VERSION,
    );
    expect(s.breakdown.contributions).toHaveLength(1);
    expect(s.breakdown.excluded).toHaveLength(2);
    for (const x of s.breakdown.excluded) expect(x.reason.length).toBeGreaterThan(10);
  });
});

// ===========================================================================
// The arithmetic
// ===========================================================================

describe('§8 penalty arithmetic', () => {
  it('penalty = weight x severity_multiplier x confidence', () => {
    const c = penaltyFor(ev({ type: 'driver.harsh_brake', severity: 'medium', confidence: 0.8 }), cfg)!;
    const expected = cfg.scoring.weights['driver.harsh_brake']! * cfg.scoring.severityMultipliers['medium']! * 0.8;
    expect(c.penalty).toBeCloseTo(expected, 10);
  });

  it('severity escalates the penalty monotonically', () => {
    const at = (severity: ScorableEvent['severity']): number =>
      penaltyFor(ev({ severity }), cfg)?.penalty ?? 0;
    expect(at('low')).toBeLessThan(at('medium'));
    expect(at('medium')).toBeLessThan(at('high'));
    expect(at('high')).toBeLessThan(at('critical'));
  });

  it('confidence scales the penalty linearly, so uncertainty costs less', () => {
    const full = penaltyFor(ev({ confidence: 1 }), cfg)!.penalty;
    const half = penaltyFor(ev({ confidence: 0.5 }), cfg)!.penalty;
    expect(half).toBeCloseTo(full / 2, 10);
  });

  it('normalises by exposure so a long clean shift is not punished (§8)', () => {
    const events = [ev(), ev({ eventKey: 'k2' })];
    const short = computeScore(
      { subjectType: 'trip', subjectId: 'a', periodStart: 0, periodEnd: 1, distanceKm: 5, events },
      cfg,
      RULE_VERSION,
    );
    const long = computeScore(
      { subjectType: 'trip', subjectId: 'b', periodStart: 0, periodEnd: 1, distanceKm: 200, events },
      cfg,
      RULE_VERSION,
    );
    // The same two events over 200 km is much better driving than over 5 km.
    expect(long.score).toBeGreaterThan(short.score);
  });

  it('applies the 1 km exposure floor rather than dividing by a 50 m trip', () => {
    const s = computeScore(
      { subjectType: 'trip', subjectId: 'a', periodStart: 0, periodEnd: 1, distanceKm: 0.05, events: [ev()] },
      cfg,
      RULE_VERSION,
    );
    // Without the floor this divides by 0.05 km and every short trip is a zero.
    expect(s.exposureKm).toBe(cfg.scoring.minExposureKm);
  });

  it('DOCUMENTS a k-calibration weakness at the exposure floor', () => {
    // With k = 2, one medium brake inside the 1 km floor lands exactly on zero,
    // and one *high* brake reaches -75 before the clamp rescues it. So at very
    // short distances the score saturates and stops discriminating: a driver who
    // brakes hard once looks identical to one who brakes hard ten times.
    //
    // This is a real finding for the §6 "Sprint-5 calibration" pass, not a bug in
    // the arithmetic — the formula is exactly as §8 specifies it. Recording it as
    // a test so that raising k (or lowering the short-trip weights) shows up here
    // as a deliberate, visible change rather than a silent one.
    const oneMedium = computeScore(
      { subjectType: 'trip', subjectId: 'a', periodStart: 0, periodEnd: 1, distanceKm: 1, events: [ev()] },
      cfg,
      RULE_VERSION,
    );
    expect(oneMedium.score).toBe(0);

    const tenMedium = computeScore(
      {
        subjectType: 'trip',
        subjectId: 'b',
        periodStart: 0,
        periodEnd: 1,
        distanceKm: 1,
        events: Array.from({ length: 10 }, (_, i) => ev({ eventKey: `k${i}` })),
      },
      cfg,
      RULE_VERSION,
    );
    // Saturated: ten times the penalty, indistinguishable score.
    expect(tenMedium.score).toBe(oneMedium.score);

    // Over a realistic trip length the model discriminates properly, which is
    // why this is a floor-effect rather than a broken penalty model.
    const overTenKm = computeScore(
      { subjectType: 'trip', subjectId: 'c', periodStart: 0, periodEnd: 1, distanceKm: 10, events: [ev()] },
      cfg,
      RULE_VERSION,
    );
    expect(overTenKm.score).toBeGreaterThan(85);
  });

  it('clamps to 0..100', () => {
    const perfect = computeScore(
      { subjectType: 'trip', subjectId: 'a', periodStart: 0, periodEnd: 1, distanceKm: 10, events: [] },
      cfg,
      RULE_VERSION,
    );
    expect(perfect.score).toBe(100);

    const awful = computeScore(
      {
        subjectType: 'trip',
        subjectId: 'b',
        periodStart: 0,
        periodEnd: 1,
        distanceKm: 1,
        events: Array.from({ length: 200 }, (_, i) => ev({ eventKey: `k${i}`, severity: 'critical' })),
      },
      cfg,
      RULE_VERSION,
    );
    expect(awful.score).toBe(0);
    expect(awful.score).toBeGreaterThanOrEqual(0);
  });
});

// ===========================================================================
// §11 Phase 5 done-when: reconciliation
// ===========================================================================

describe('§11 Phase 5 — the score reconciles against its breakdown', () => {
  it('recomputes exactly from its own recorded contributions', () => {
    const s = computeScore(
      {
        subjectType: 'driver',
        subjectId: 'drv-1',
        periodStart: 0,
        periodEnd: 86400,
        distanceKm: 42.5,
        events: [
          ev({ eventKey: 'a', type: 'driver.harsh_brake', severity: 'high', confidence: 0.9 }),
          ev({ eventKey: 'b', type: 'driver.harsh_accel', severity: 'low', confidence: 0.7 }),
          ev({ eventKey: 'c', type: 'driver.swerving', severity: 'medium', confidence: 0.55 }),
          ev({ eventKey: 'd', type: 'driver.excessive_cornering_speed', severity: 'high', confidence: 0.8 }),
          // Excluded, and therefore must NOT appear in the arithmetic.
          ev({ eventKey: 'e', type: 'road.defect_observation', category: 'road', attributedToDriver: false }),
        ],
      },
      cfg,
      RULE_VERSION,
    );

    const check = reconcile(s, cfg);
    expect(check.ok).toBe(true);
    expect(check.expected).toBe(check.actual);

    // And by hand, independently of `reconcile`:
    const byHand = s.breakdown.contributions.reduce(
      (sum, c) => sum + c.weight * c.severityMultiplier * c.confidence,
      0,
    );
    expect(byHand).toBeCloseTo(s.breakdown.rawPenalty, 6);
    const expected = 100 - (100 * byHand) / (s.breakdown.exposureKm * s.breakdown.k);
    expect(s.score).toBeCloseTo(expected, 2);
  });

  it('every contribution names the event it came from', () => {
    const s = computeScore(
      {
        subjectType: 'trip',
        subjectId: 't1',
        periodStart: 0,
        periodEnd: 1,
        distanceKm: 10,
        events: [ev({ eventKey: 'abc' })],
      },
      cfg,
      RULE_VERSION,
    );
    expect(s.breakdown.contributions[0]!.eventKey).toBe('abc');
    expect(s.breakdown.contributions[0]!.type).toBe('driver.harsh_brake');
  });

  it('stamps the rule version, so a re-score is comparable not destructive (§4)', () => {
    const s = computeScore(
      { subjectType: 'trip', subjectId: 't1', periodStart: 0, periodEnd: 1, distanceKm: 10, events: [] },
      cfg,
      RULE_VERSION,
    );
    expect(s.ruleVersion).toBe(RULE_VERSION);
  });
});

// ===========================================================================
// Rollups
// ===========================================================================

describe('§8 rollups', () => {
  it('marks a low-GPS-coverage trip low-confidence', () => {
    const r = tripIsLowConfidence(trip({ gpsCoverage: 0.3 }), cfg);
    expect(r.low).toBe(true);
    expect(r.reason).toContain('gps_coverage');
  });

  it('marks a heavily calibration-stale trip low-confidence', () => {
    expect(tripIsLowConfidence(trip(), cfg, 5).low).toBe(true);
    expect(tripIsLowConfidence(trip(), cfg, 0).low).toBe(false);
  });

  it('marks an abandoned trip low-confidence', () => {
    expect(tripIsLowConfidence(trip({ status: 'abandoned' }), cfg).low).toBe(true);
  });

  it('EXCLUDES low-confidence trips from the daily rollup entirely (§8)', () => {
    const good = trip({ id: 'good', distanceM: 20_000, gpsCoverage: 0.99 });
    const bad = trip({ id: 'bad', distanceM: 20_000, gpsCoverage: 0.2 });

    const daily = rollupDaily(
      {
        subjectType: 'driver',
        subjectId: 'drv-1',
        dayTSec: 1785564000,
        trips: [
          { trip: good, events: [] },
          // The bad trip is full of events, but must not move the score at all.
          { trip: bad, events: Array.from({ length: 20 }, (_, i) => ev({ eventKey: `x${i}` })) },
        ],
      },
      cfg,
      RULE_VERSION,
    );

    expect(daily.score).toBe(100);
    expect(daily.breakdown.contributions).toHaveLength(0);
    // Its distance is excluded too — the driver is neither punished nor credited.
    expect(daily.exposureKm).toBeCloseTo(20, 3);
    expect(daily.breakdown.excluded.some((x) => x.reason.includes('excluded from daily rollup'))).toBe(true);
  });

  it('sums penalties and distance once, rather than averaging trip scores', () => {
    // Two trips: one clean 100 km, one with an event over 1 km. Averaging the
    // scores would weight them equally; exposure normalisation must not.
    const daily = rollupDaily(
      {
        subjectType: 'driver',
        subjectId: 'drv-1',
        dayTSec: 1785564000,
        trips: [
          { trip: trip({ id: 'a', distanceM: 100_000 }), events: [] },
          { trip: trip({ id: 'b', distanceM: 1_000 }), events: [ev()] },
        ],
      },
      cfg,
      RULE_VERSION,
    );
    expect(daily.exposureKm).toBeCloseTo(101, 3);
    // One medium brake over 101 km is a very good day.
    expect(daily.score).toBeGreaterThan(95);
    expect(reconcile(daily, cfg).ok).toBe(true);
  });

  it('scores a trip and carries the low-confidence note', () => {
    const s = scoreTrip({ trip: trip({ gpsCoverage: 0.2 }), events: [ev()] }, cfg, RULE_VERSION);
    expect(s.subjectType).toBe('trip');
    expect(s.breakdown.lowConfidence).toBe(true);
    expect(s.breakdown.excluded.some((x) => x.reason.includes('low-confidence'))).toBe(true);
  });

  it('groups by driver and UTC day, falling back to device', () => {
    const withDriver = trip({ id: 'a', driverId: 'drv-1' });
    const noDriver = trip({ id: 'b', driverId: null, deviceId: 'dev-z' });
    const groups = groupForRollup([{ trip: withDriver, events: [] }, { trip: noDriver, events: [] }]);
    expect(groups.size).toBe(2);
    const kinds = [...groups.values()].map((g) => `${g.subjectType}:${g.subjectId}`);
    expect(kinds).toContain('driver:drv-1');
    expect(kinds).toContain('device:dev-z');
  });

  it('buckets days on UTC boundaries', () => {
    const { start, end } = dayBounds(1785564000);
    expect(end - start).toBe(86400);
    expect(start % 86400).toBe(0);
    expect(start).toBeLessThanOrEqual(1785564000);
  });
});
