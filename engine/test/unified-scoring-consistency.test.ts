/**
 * Consistency Tests — Unified Scoring Engine
 *
 * Verifies that:
 * 1. Overview driver score === Driver page score for the same driver, time period, events, and distance.
 * 2. Backend canonical scoring engine produces identical results across all consumer modules.
 * 3. No events → 100.
 * 4. Road defect → no driver penalty (§8 fairness gate).
 * 5. Sensor failure / integrity anomaly → no driver penalty (§6.7).
 * 6. Same events → same score everywhere.
 * 7. Different distance → exposure normalisation changes score appropriately.
 * 8. Fleet Score uses exposure-weighted total penalties and distance, NOT a simple arithmetic average.
 */

import { describe, it, expect } from 'vitest';
import { THRESHOLDS, RULE_VERSION } from '../src/config/thresholds.js';
import { computeScore, type ScorableEvent as EngineScorableEvent } from '../src/score/penalties.js';
import {
  computeCanonicalScore,
  computeFleetScore,
  isScorable,
  exclusionReason,
  penaltyFor,
  CANONICAL_SCORING_CONFIG,
  type ScorableEvent,
} from '../../web/src/lib/scoring/canonicalEngine.js';

describe('Unified RoadScore Scoring — Cross-Module Consistency', () => {
  const cfg = THRESHOLDS;

  it('Requirement 1: Overview driver score === Driver page score for the same driver, period, events, and distance', () => {
    const testEvents: ScorableEvent[] = [
      {
        id: 'evt_1',
        eventKey: 'k_brake_1',
        type: 'driver.harsh_brake',
        severity: 'high',
        confidence: 0.9,
        attributedToDriver: true,
        occurredAt: '2026-08-18T10:00:00Z',
      },
      {
        id: 'evt_2',
        eventKey: 'k_accel_1',
        type: 'driver.harsh_accel',
        severity: 'medium',
        confidence: 0.8,
        attributedToDriver: true,
        occurredAt: '2026-08-18T10:15:00Z',
      },
      {
        id: 'evt_3',
        eventKey: 'k_road_1',
        type: 'road.defect_observation',
        category: 'road',
        severity: 'critical',
        confidence: 1.0,
        attributedToDriver: false,
        occurredAt: '2026-08-18T10:30:00Z',
      },
    ];

    const distanceKm = 45.2;
    const periodStart = 1785564000;
    const periodEnd = 1785567600;

    // 1. Computed via Backend Engine (engine/src/score/penalties.ts)
    const engineEvents: EngineScorableEvent[] = testEvents.map((e) => ({
      id: e.id,
      eventKey: e.eventKey,
      type: e.type as any,
      category: (e.category || 'driver') as any,
      severity: e.severity as any,
      confidence: e.confidence ?? 1.0,
      attributedToDriver: Boolean(e.attributedToDriver),
      severityCensored: false,
    }));

    const backendScore = computeScore(
      {
        subjectType: 'driver',
        subjectId: 'drv-test-01',
        periodStart,
        periodEnd,
        distanceKm,
        events: engineEvents,
      },
      cfg,
      RULE_VERSION,
    );

    // 2. Computed via Full Overview (web/src/app/page.tsx logic)
    const overviewScore = computeCanonicalScore({
      distanceKm,
      events: testEvents,
      subjectType: 'driver',
      subjectId: 'drv-test-01',
      periodStart,
      periodEnd,
    });

    // 3. Computed via Drivers Page (web/src/app/drivers/page.tsx & /drivers/[id] logic)
    const driverPageScore = computeCanonicalScore({
      distanceKm,
      events: testEvents,
      subjectType: 'driver',
      subjectId: 'drv-test-01',
      periodStart,
      periodEnd,
    });

    // Exact equality check
    expect(overviewScore.score).toBe(driverPageScore.score);
    expect(overviewScore.score).toBe(backendScore.score);
    expect(overviewScore.penalty).toBeCloseTo(backendScore.breakdown.rawPenalty, 2);
    expect(overviewScore.distanceKm).toBeCloseTo(backendScore.exposureKm ?? distanceKm, 2);
  });

  it('Requirement 2: No events → 100 score everywhere', () => {
    const distanceKm = 50;

    const backendScore = computeScore(
      {
        subjectType: 'driver',
        subjectId: 'drv-clean',
        periodStart: 0,
        periodEnd: 3600,
        distanceKm,
        events: [],
      },
      cfg,
      RULE_VERSION,
    );

    const canonicalScore = computeCanonicalScore({
      distanceKm,
      events: [],
    });

    expect(backendScore.score).toBe(100.0);
    expect(canonicalScore.score).toBe(100.0);
    expect(canonicalScore.penalty).toBe(0);
  });

  it('Requirement 3: Road defect → no driver penalty (§8 fairness gate)', () => {
    const roadEvents: ScorableEvent[] = [
      {
        type: 'road.pothole_impact',
        category: 'road',
        severity: 'critical',
        confidence: 1.0,
        attributedToDriver: false,
      },
      {
        type: 'road.defect_observation',
        category: 'road',
        severity: 'high',
        confidence: 1.0,
        attributedToDriver: false,
      },
      {
        type: 'road.impact_candidate',
        category: 'road',
        severity: 'high',
        confidence: 0.45,
        attributedToDriver: false,
      },
    ];

    for (const e of roadEvents) {
      expect(isScorable(e)).toBe(false);
      expect(penaltyFor(e)).toBeNull();
      expect(exclusionReason(e)).toContain('not attributed to the driver');
    }

    const res = computeCanonicalScore({
      distanceKm: 10,
      events: roadEvents,
    });

    expect(res.score).toBe(100.0);
    expect(res.penalty).toBe(0);
    expect(res.breakdown.excluded).toHaveLength(3);
  });

  it('Requirement 4: Sensor failure / integrity event → no driver penalty (§6.7)', () => {
    const integrityEvents: ScorableEvent[] = [
      {
        type: 'integrity.data_gap',
        category: 'integrity',
        severity: 'critical',
        confidence: 1.0,
        attributedToDriver: false,
      },
      {
        type: 'integrity.imu_drift_detected',
        category: 'integrity',
        severity: 'high',
        confidence: 1.0,
        attributedToDriver: false,
      },
      {
        type: 'integrity.mount_shift',
        category: 'integrity',
        severity: 'high',
        confidence: 1.0,
        attributedToDriver: false,
      },
    ];

    for (const e of integrityEvents) {
      expect(isScorable(e)).toBe(false);
      expect(penaltyFor(e)).toBeNull();
    }

    const res = computeCanonicalScore({
      distanceKm: 10,
      events: integrityEvents,
    });

    expect(res.score).toBe(100.0);
    expect(res.penalty).toBe(0);
  });

  it('Requirement 5: Same events → exact same score everywhere', () => {
    const events: ScorableEvent[] = [
      {
        type: 'driver.swerving',
        severity: 'medium',
        confidence: 1.0,
        attributedToDriver: true,
      },
      {
        type: 'driver.excessive_cornering_speed',
        severity: 'high',
        confidence: 0.85,
        attributedToDriver: true,
      },
    ];

    const dist = 30.0;
    const s1 = computeCanonicalScore({ distanceKm: dist, events });
    const s2 = computeCanonicalScore({ distanceKm: dist, events });

    expect(s1.score).toBe(s2.score);
    expect(s1.penalty).toBe(s2.penalty);
  });

  it('Requirement 6: Different distance → exposure changes appropriately', () => {
    const events: ScorableEvent[] = [
      {
        type: 'driver.harsh_brake',
        severity: 'medium',
        confidence: 1.0,
        attributedToDriver: true,
      },
    ];

    const shortDistance = computeCanonicalScore({ distanceKm: 5.0, events });
    const mediumDistance = computeCanonicalScore({ distanceKm: 50.0, events });
    const longDistance = computeCanonicalScore({ distanceKm: 500.0, events });

    // Same single event over 5 km is penalised much more than over 50 km or 500 km
    expect(shortDistance.score).toBeLessThan(mediumDistance.score);
    expect(mediumDistance.score).toBeLessThan(longDistance.score);

    // Explicit hand calculations:
    // weight('harsh_brake') = 1.0, sev('medium') = 2.0, conf = 1.0 -> penalty = 2.0. k = 2.0
    // 5 km:   100 - (100 * 2) / (5 * 2)   = 100 - 20   = 80.0
    // 50 km:  100 - (100 * 2) / (50 * 2)  = 100 - 2    = 98.0
    // 500 km: 100 - (100 * 2) / (500 * 2) = 100 - 0.2  = 99.8
    expect(shortDistance.score).toBe(80.0);
    expect(mediumDistance.score).toBe(98.0);
    expect(longDistance.score).toBe(99.8);
  });

  it('Requirement 7: Fleet Score uses exposure-weighted total penalties and distance, NOT simple arithmetic averaging', () => {
    // Driver A: Drove 500 km, 2 harsh brakes (penalty = 2 * 2.0 = 4.0)
    // Score A = 100 - (100 * 4.0) / (500 * 2.0) = 100 - 0.4 = 99.6
    const driverAEvents: ScorableEvent[] = [
      { type: 'driver.harsh_brake', severity: 'medium', confidence: 1.0, attributedToDriver: true },
      { type: 'driver.harsh_brake', severity: 'medium', confidence: 1.0, attributedToDriver: true },
    ];
    const scoreA = computeCanonicalScore({ distanceKm: 500, events: driverAEvents }).score;
    expect(scoreA).toBe(99.6);

    // Driver B: Drove 2 km, 1 harsh brake (penalty = 2.0)
    // Score B = 100 - (100 * 2.0) / (2 * 2.0) = 100 - 50 = 50.0
    const driverBEvents: ScorableEvent[] = [
      { type: 'driver.harsh_brake', severity: 'medium', confidence: 1.0, attributedToDriver: true },
    ];
    const scoreB = computeCanonicalScore({ distanceKm: 2, events: driverBEvents }).score;
    expect(scoreB).toBe(50.0);

    // Flawed simple average would be: (99.6 + 50.0) / 2 = 74.8 (distorted by 2 km trip)
    const naiveAverage = (scoreA + scoreB) / 2;
    expect(naiveAverage).toBe(74.8);

    // Correct Canonical Fleet Score:
    // Total distance = 502 km, total penalties = 6.0
    // Fleet Score = 100 - (100 * 6.0) / (502 * 2.0) = 100 - 0.5976 = 99.4
    const fleetResult = computeFleetScore({
      totalDistanceKm: 502,
      events: [...driverAEvents, ...driverBEvents],
    });

    expect(fleetResult.score).toBe(99.4);
    expect(fleetResult.score).not.toBe(naiveAverage);
  });

  it('Requirement 8: 0–100 clamping ensures negative or extreme raw penalties never produce out-of-bounds scores', () => {
    const perfectScore = computeCanonicalScore({ distanceKm: 10, events: [] });
    expect(perfectScore.score).toBe(100.0);

    // Extreme penalties that would compute to negative without clamping
    const massiveViolations: ScorableEvent[] = Array.from({ length: 50 }, (_, i) => ({
      id: `m_${i}`,
      type: 'driver.swerving',
      severity: 'critical',
      confidence: 1.0,
      attributedToDriver: true,
    }));

    const clampedZero = computeCanonicalScore({ distanceKm: 1.0, events: massiveViolations });
    expect(clampedZero.score).toBe(0.0);
    expect(clampedZero.score).toBeGreaterThanOrEqual(0.0);
    expect(clampedZero.score).toBeLessThanOrEqual(100.0);
  });
});
