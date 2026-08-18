import { describe, it, expect } from 'vitest';
import {
  computeCanonicalScore,
  calculateFactorRadarScores,
  calculateCanonicalDeductions,
  getCanonicalExcludedEvents,
  evaluateStreamHealth,
  resolveEventDriverId,
  isScorable,
  exclusionReason,
  type ScorableEvent,
} from '../../web/src/lib/scoring/canonicalEngine.js';

describe('Canonical Scoring Engine Invariants (§8)', () => {
  const NOW = 1700000000000; // Fixed reference timestamp

  it('Invariant 1: Clean driver with no events maintains a perfect 100.0 score', () => {
    const res = computeCanonicalScore({
      distanceKm: 25.0,
      events: [],
    });
    expect(res.score).toBe(100.0);
    expect(res.penalty).toBe(0);
    expect(res.breakdown.contributions).toHaveLength(0);
  });

  it('Invariant 2: Harsh driving event reduces score according to canonical formula: 100 - (100 * penalty) / (exposure * k)', () => {
    const events: ScorableEvent[] = [
      {
        id: 'evt_1',
        type: 'driver.harsh_brake',
        severity: 'high',
        occurredAt: new Date(NOW - 5000).toISOString(),
        attributedToDriver: true,
        confidence: 1.0,
        magnitude: -4.5,
      },
    ];

    // Distance = 10 km, k = 2.0.
    // weight('driver.harsh_brake') = 1.0, severityMultiplier('high') = 3.5, confidence = 1.0 -> penalty = 3.5
    // score = 100 - (100 * 3.5) / (10 * 2.0) = 100 - 17.5 = 82.5
    const res = computeCanonicalScore({
      distanceKm: 10.0,
      events,
    });

    expect(res.score).toBe(82.5);
    expect(res.penalty).toBe(3.5);
    expect(res.breakdown.contributions).toHaveLength(1);
  });

  it('Invariant 3: Higher severity events incur proportionally larger penalties', () => {
    const lowEvent: ScorableEvent = {
      type: 'driver.harsh_accel',
      severity: 'low',
      attributedToDriver: true,
      confidence: 1.0,
    };
    const mediumEvent: ScorableEvent = {
      type: 'driver.harsh_accel',
      severity: 'medium',
      attributedToDriver: true,
      confidence: 1.0,
    };
    const criticalEvent: ScorableEvent = {
      type: 'driver.harsh_accel',
      severity: 'critical',
      attributedToDriver: true,
      confidence: 1.0,
    };

    const scoreLow = computeCanonicalScore({ distanceKm: 20, events: [lowEvent] }).score;
    const scoreMedium = computeCanonicalScore({ distanceKm: 20, events: [mediumEvent] }).score;
    const scoreCritical = computeCanonicalScore({ distanceKm: 20, events: [criticalEvent] }).score;

    expect(scoreCritical).toBeLessThan(scoreMedium);
    expect(scoreMedium).toBeLessThan(scoreLow);
  });

  it('Invariant 4 (§8 Fairness Gate): Road defects and non-driver events MUST NOT reduce driver score', () => {
    const roadDefectEvent: ScorableEvent = {
      id: 'road_pothole_1',
      type: 'road.pothole_impact',
      severity: 'critical',
      confidence: 1.0,
      attributedToDriver: false, // Arbitrated to road surface
      magnitude: 2.8,
    };

    const integrityEvent: ScorableEvent = {
      id: 'sensor_fault_1',
      type: 'integrity.imu_drift_detected',
      category: 'integrity',
      severity: 'high',
      confidence: 1.0,
      attributedToDriver: false,
    };

    const res = computeCanonicalScore({
      distanceKm: 15.0,
      events: [roadDefectEvent, integrityEvent],
    });

    expect(res.score).toBe(100.0);
    expect(res.penalty).toBe(0);

    const deductions = calculateCanonicalDeductions([roadDefectEvent, integrityEvent]);
    expect(deductions.length).toBe(0);

    const excluded = getCanonicalExcludedEvents([roadDefectEvent, integrityEvent]);
    expect(excluded.length).toBe(2);
    expect(excluded[0]?.reason).toContain('§8 excludes');
  });

  it('Invariant 5: Exposure normalisation dilutes penalty over greater distance', () => {
    const event: ScorableEvent = {
      type: 'driver.harsh_brake',
      severity: 'medium',
      attributedToDriver: true,
      confidence: 1.0,
    };

    const shortTripScore = computeCanonicalScore({ distanceKm: 5.0, events: [event] }).score;
    const longTripScore = computeCanonicalScore({ distanceKm: 200.0, events: [event] }).score;

    expect(longTripScore).toBeGreaterThan(shortTripScore);
  });

  it('Invariant 6: Weight 0 events (e.g. driver.collision_suspected) are alerts, not penalties (§2.7)', () => {
    const collisionEvent: ScorableEvent = {
      type: 'driver.collision_suspected',
      severity: 'critical',
      attributedToDriver: true,
      confidence: 1.0,
    };

    expect(isScorable(collisionEvent)).toBe(false);
    expect(exclusionReason(collisionEvent)).toContain('weight 0');

    const res = computeCanonicalScore({
      distanceKm: 10.0,
      events: [collisionEvent],
    });
    expect(res.score).toBe(100.0);
  });

  it('Invariant 7: Multi-entity cascade resolves driver ID across driver_id, device_id, and mappings', () => {
    const driverMap = { 'driver-uuid-1': 'ROADSCORE_001' };
    const deviceMap = { 'ROADSCORE_001': 'driver-uuid-1' };

    // Direct driver_id
    const evt1 = {
      type: 'driver.harsh_brake',
      severity: 'high',
      occurred_at: new Date(NOW).toISOString(),
      driver_id: 'driver-uuid-1',
    };
    expect(resolveEventDriverId(evt1, driverMap, deviceMap)).toBe('driver-uuid-1');

    // Mapped via device_id
    const evt2 = {
      type: 'driver.harsh_brake',
      severity: 'high',
      occurred_at: new Date(NOW).toISOString(),
      device_id: 'ROADSCORE_001',
    };
    expect(resolveEventDriverId(evt2, driverMap, deviceMap)).toBe('driver-uuid-1');

    // Unmapped device
    const evt3 = {
      type: 'driver.harsh_brake',
      severity: 'high',
      occurred_at: new Date(NOW).toISOString(),
      device_id: 'UNKNOWN_DEVICE_999',
    };
    expect(resolveEventDriverId(evt3, driverMap, deviceMap)).toBeNull();
  });

  it('Invariant 8: Stream health state machine correctly evaluates streaming, intermittent, idle, disconnected', () => {
    // 1. High frequency 50Hz (packets every 20ms in last 3 seconds)
    const streamingTimestamps = Array.from({ length: 60 }, (_, i) => NOW - i * 20);
    const healthStreaming = evaluateStreamHealth(streamingTimestamps, NOW);
    expect(healthStreaming.status).toBe('streaming');
    expect(healthStreaming.rateHz).toBeGreaterThanOrEqual(15);

    // 2. Intermittent (packets 4 seconds ago)
    const intermittentTimestamps = [NOW - 4000, NOW - 5000];
    const healthIntermittent = evaluateStreamHealth(intermittentTimestamps, NOW);
    expect(healthIntermittent.status).toBe('intermittent');

    // 3. Idle (packets 15 seconds ago)
    const idleTimestamps = [NOW - 15000];
    const healthIdle = evaluateStreamHealth(idleTimestamps, NOW);
    expect(healthIdle.status).toBe('idle');
    expect(healthIdle.lastSeenSecAgo).toBe(15);

    // 4. Disconnected (no packets for >30 seconds or empty)
    const disconnectedTimestamps = [NOW - 45000];
    const healthDisconnected = evaluateStreamHealth(disconnectedTimestamps, NOW);
    expect(healthDisconnected.status).toBe('disconnected');
    expect(healthDisconnected.lastSeenSecAgo).toBe(45);
  });
});
