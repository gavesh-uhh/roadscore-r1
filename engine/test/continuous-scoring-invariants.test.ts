import { describe, it, expect } from 'vitest';
import {
  calculateContinuousScore24h,
  calculateDriverDeductions,
  getExcludedEvents,
  evaluateStreamHealth,
  resolveEventDriverId,
  type TelematicsEvent,
} from '../../web/src/lib/scoring/continuousEngine.js';

describe('Telematics & Continuous Scoring Invariants', () => {
  const NOW = 1700000000000; // Fixed reference timestamp

  it('Invariant 1: Clean driver with no events maintains a perfect 100.0 score', () => {
    const score = calculateContinuousScore24h([], NOW);
    expect(score).toBe(100.0);
  });

  it('Invariant 2: Harsh driving event immediately reduces score reactively', () => {
    const events: TelematicsEvent[] = [
      {
        id: 'evt_1',
        type: 'driver.harsh_brake',
        severity: 'high',
        occurred_at: new Date(NOW - 5000).toISOString(), // 5s ago
        attributed_to_driver: true,
        magnitude: -4.5,
      },
    ];

    const score = calculateContinuousScore24h(events, NOW);
    expect(score).toBeLessThan(100.0);
    expect(score).toBe(80.0); // 100 - (8.0 base * 2.5 high severity * 1.0 driving * ~1.0 decay) = 80.0
  });

  it('Invariant 3: Higher severity events incur proportionally larger penalties', () => {
    const lowEvent: TelematicsEvent = {
      type: 'driver.harsh_accel',
      severity: 'low',
      occurred_at: new Date(NOW - 1000).toISOString(),
      attributed_to_driver: true,
    };
    const criticalEvent: TelematicsEvent = {
      type: 'driver.harsh_accel',
      severity: 'critical',
      occurred_at: new Date(NOW - 1000).toISOString(),
      attributed_to_driver: true,
    };

    const scoreLow = calculateContinuousScore24h([lowEvent], NOW);
    const scoreCritical = calculateContinuousScore24h([criticalEvent], NOW);

    expect(scoreCritical).toBeLessThan(scoreLow);
  });

  it('Invariant 4 (§8 Fairness Gate): Road defects and non-driver events MUST NOT reduce driver score', () => {
    const roadDefectEvent: TelematicsEvent = {
      id: 'road_pothole_1',
      type: 'road.pothole_impact',
      severity: 'critical',
      occurred_at: new Date(NOW - 1000).toISOString(),
      attributed_to_driver: false, // Arbitrated to road surface
      magnitude: 2.8,
    };

    const integrityEvent: TelematicsEvent = {
      id: 'sensor_fault_1',
      type: 'integrity.imu_drift_detected',
      severity: 'high',
      occurred_at: new Date(NOW - 2000).toISOString(),
      attributed_to_driver: false,
    };

    const score = calculateContinuousScore24h([roadDefectEvent, integrityEvent], NOW);
    expect(score).toBe(100.0);

    const deductions = calculateDriverDeductions([roadDefectEvent, integrityEvent], NOW);
    expect(deductions.length).toBe(0);

    const excluded = getExcludedEvents([roadDefectEvent, integrityEvent]);
    expect(excluded.length).toBe(2);
    expect(excluded[0]?.reason).toContain('§8 fairness rule');
  });

  it('Invariant 5: Exponential decay recovers points over 12h half-life and restores to 100 after 24h', () => {
    const recentEvent: TelematicsEvent = {
      type: 'driver.harsh_brake',
      severity: 'high',
      occurred_at: new Date(NOW - 1000).toISOString(), // 1s ago
      attributed_to_driver: true,
    };
    const halfLifeEvent: TelematicsEvent = {
      type: 'driver.harsh_brake',
      severity: 'high',
      occurred_at: new Date(NOW - 12 * 3600 * 1000).toISOString(), // 12h ago
      attributed_to_driver: true,
    };
    const expiredEvent: TelematicsEvent = {
      type: 'driver.harsh_brake',
      severity: 'high',
      occurred_at: new Date(NOW - 25 * 3600 * 1000).toISOString(), // 25h ago
      attributed_to_driver: true,
    };

    const scoreRecent = calculateContinuousScore24h([recentEvent], NOW);
    const scoreHalfLife = calculateContinuousScore24h([halfLifeEvent], NOW);
    const scoreExpired = calculateContinuousScore24h([expiredEvent], NOW);

    // Recent deduction: 20 pts -> score 80
    expect(scoreRecent).toBe(80.0);
    // 12h decay: ~10 pts deduction -> score 90
    expect(scoreHalfLife).toBe(90.0);
    // 25h: expired out of sliding 24h window -> score restored to 100.0
    expect(scoreExpired).toBe(100.0);
  });

  it('Invariant 6: Operational state alters penalty weight (Driving full penalty vs Idle reduced)', () => {
    const drivingEvent: TelematicsEvent = {
      type: 'driver.harsh_accel',
      severity: 'medium',
      occurred_at: new Date(NOW - 1000).toISOString(),
      attributed_to_driver: true,
      op_state: 'DRIVING',
    };
    const idleEvent: TelematicsEvent = {
      type: 'driver.harsh_accel',
      severity: 'medium',
      occurred_at: new Date(NOW - 1000).toISOString(),
      attributed_to_driver: true,
      op_state: 'STATIONARY_IDLE',
    };

    const scoreDriving = calculateContinuousScore24h([drivingEvent], NOW);
    const scoreIdle = calculateContinuousScore24h([idleEvent], NOW);

    expect(scoreDriving).toBeLessThan(scoreIdle);
  });

  it('Invariant 7: Multi-entity cascade resolves driver ID across driver_id, device_id, and mappings', () => {
    const driverMap = { 'driver-uuid-1': 'ROADSCORE_001' };
    const deviceMap = { 'ROADSCORE_001': 'driver-uuid-1' };

    // Direct driver_id
    const evt1: TelematicsEvent = {
      type: 'driver.harsh_brake',
      severity: 'high',
      occurred_at: new Date(NOW).toISOString(),
      driver_id: 'driver-uuid-1',
    };
    expect(resolveEventDriverId(evt1, driverMap, deviceMap)).toBe('driver-uuid-1');

    // Mapped via device_id
    const evt2: TelematicsEvent = {
      type: 'driver.harsh_brake',
      severity: 'high',
      occurred_at: new Date(NOW).toISOString(),
      device_id: 'ROADSCORE_001',
    };
    expect(resolveEventDriverId(evt2, driverMap, deviceMap)).toBe('driver-uuid-1');

    // Unmapped device
    const evt3: TelematicsEvent = {
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
