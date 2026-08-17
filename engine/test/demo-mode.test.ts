import { describe, it, expect } from 'vitest';
import { THRESHOLDS } from '../src/config/thresholds.js';
import { Pipeline } from '../src/pipeline.js';
import { createSilentLogger } from '../src/util/log.js';
import type { RawRow, PersistableEvent, Trip, Score } from '../src/types.js';

describe('Indoor DEMO_MODE Pipeline & Event Detection', () => {
  const demoCfg = {
    ...THRESHOLDS,
    demoMode: true,
    gps: {
      ...THRESHOLDS.gps,
      minSats: 0,
      maxHdop: 999,
      minSpeedForDynamics: 0,
    },
    longitudinal: {
      ...THRESHOLDS.longitudinal,
      corroborationSlack: 2.5,
      brake: { low: -2.0, medium: -3.5, high: -5.0 },
      accel: { low: 1.8, medium: 2.8, high: 3.8 },
    },
    lateral: {
      ...THRESHOLDS.lateral,
      cornerYaw: 0.2,
      cornerSpeed: 0,
      excessive: { low: 2.0, medium: 3.5, high: 4.8 },
      gpsYawTolerance: 999,
    },
    swerve: {
      ...THRESHOLDS.swerve,
      minSpeed: 0,
      minExcursions: 2,
      minIntegratedYaw: 0.5,
      maxNetHeadingChange: 999,
    },
    impact: {
      ...THRESHOLDS.impact,
      absoluteFloor: 5.8,
      baselineMultiplier: 3.5,
    },
  };

  function createMockSink() {
    const events: PersistableEvent[] = [];
    const trips: Trip[] = [];
    const scores: Score[] = [];
    return {
      events,
      trips,
      scores,
      enqueueEvent: (e: PersistableEvent) => events.push(e),
      enqueueTrip: (t: Trip) => trips.push(t),
      enqueueScore: (s: Score) => scores.push(s),
      enqueueRoadCell: () => {},
      enqueueRoadDefect: () => {},
      enqueuePrediction: () => {},
      flush: async () => {},
      close: async () => {},
    };
  }

  function createTestRow(overrides: Partial<RawRow> = {}): RawRow {
    return {
      id: 1,
      device_id: 'ROADSCORE_001',
      seq: 1,
      uptime_ms: 1000,
      window_ms: 1000,
      samples: 50,
      ts: '2026-08-16T10:00:00Z',
      accel_fs_g: 2,
      gyro_fs_dps: 250,
      calibration: { state: 'calibrated', age_ms: 100, gravity_ref: { x: 0, y: 0, z: 16384 } },
      accel_raw: { x: 0, y: 0, z: 16384 },
      gyro_raw: { x: 0, y: 0, z: 0 },
      accel_cal: { vertical_rms: 10, vertical_peak: 20, horizontal_peak: 20, magnitude_peak: 30 },
      gyro_cal: { yaw_rate_peak: 0, pitch_rate_peak: 0, roll_rate_peak: 0 },
      mic: { rms: 50, peak: 80 },
      gps: { fix: false, lat: 0, lon: 0, speed_kmh: 0, heading: 0, altitude: 0, sats: 0, hdop: 99.0 },
      wifi_rssi: -45,
      fw_version: '1.0.0-mcu',
      dropped_posts: 0,
      server_received_at: '2026-08-16T10:00:00Z',
      ...overrides,
    };
  }

  it('automatically opens a virtual demo trip on first indoor telemetry packet', async () => {
    const sink = createMockSink();
    const log = createSilentLogger();
    const devices = new Map([
      [
        'ROADSCORE_001',
        {
          deviceId: 'ROADSCORE_001',
          vehicleId: 'veh-1',
          driverId: 'drv-1',
          accelFsG: 2,
          gyroFsDps: 250,
          active: true,
        },
      ],
    ]);

    const pipeline = new Pipeline({ cfg: demoCfg, sink: sink as any, log, devices });

    const row = createTestRow({
      id: 1,
      seq: 1,
      uptime_ms: 1000,
      ts: '2026-08-16T10:00:00Z',
    });

    await pipeline.submit(row);

    expect(sink.trips.length).toBeGreaterThanOrEqual(1);
    expect(sink.trips[0]!.status).toBe('open');
    expect(sink.trips[0]!.deviceId).toBe('ROADSCORE_001');
  });

  it('triggers a pothole impact candidate on intentional knuckle tap without GPS fix', async () => {
    const sink = createMockSink();
    const log = createSilentLogger();
    const devices = new Map([
      [
        'ROADSCORE_001',
        {
          deviceId: 'ROADSCORE_001',
          vehicleId: 'veh-1',
          driverId: 'drv-1',
          accelFsG: 2,
          gyroFsDps: 250,
          active: true,
        },
      ],
    ]);

    const pipeline = new Pipeline({ cfg: demoCfg, sink: sink as any, log, devices });

    // Knuckle tap on desk: vertical peak = 11000 counts = ~6.58 m/s² > 5.8 m/s² threshold
    const row = createTestRow({
      id: 2,
      seq: 2,
      uptime_ms: 2000,
      ts: '2026-08-16T10:00:01Z',
      accel_cal: { vertical_rms: 400, vertical_peak: 11000, horizontal_peak: 500, magnitude_peak: 11000 },
      mic: { rms: 500, peak: 1200 },
    });

    await pipeline.submit(row);

    const impactEvent = sink.events.find(
      (e) => e.type === 'road.impact_candidate' || e.type === 'driver.avoidable_impact' || e.type === 'road.defect_observation',
    );
    expect(impactEvent).toBeDefined();
  });

  it('does NOT trigger pothole impact on horizontal table sliding', async () => {
    const sink = createMockSink();
    const log = createSilentLogger();
    const devices = new Map([
      [
        'ROADSCORE_001',
        {
          deviceId: 'ROADSCORE_001',
          vehicleId: 'veh-1',
          driverId: 'drv-1',
          accelFsG: 2,
          gyroFsDps: 250,
          active: true,
        },
      ],
    ]);

    const pipeline = new Pipeline({ cfg: demoCfg, sink: sink as any, log, devices });

    // Slide across desk: horizontal peak = 6000 counts (~3.59 m/s²), vertical table rumble = 4500 counts (~2.69 m/s²)
    const row = createTestRow({
      id: 3,
      seq: 3,
      uptime_ms: 3000,
      ts: '2026-08-16T10:00:02Z',
      accel_raw: { x: 3000, y: 0, z: 16384 },
      accel_cal: { vertical_rms: 150, vertical_peak: 4500, horizontal_peak: 6000, magnitude_peak: 6000 },
      mic: { rms: 100, peak: 200 },
    });

    await pipeline.submit(row);

    const impactEvent = sink.events.find(
      (e) => e.type === 'road.impact_candidate' || e.type === 'driver.avoidable_impact' || e.type === 'road.defect_observation',
    );
    expect(impactEvent).toBeUndefined();
  });

  it('triggers harsh cornering on board rotation in demo mode', async () => {
    const sink = createMockSink();
    const log = createSilentLogger();
    const devices = new Map([
      [
        'ROADSCORE_001',
        {
          deviceId: 'ROADSCORE_001',
          vehicleId: 'veh-1',
          driverId: 'drv-1',
          accelFsG: 2,
          gyroFsDps: 250,
          active: true,
        },
      ],
    ]);

    const pipeline = new Pipeline({ cfg: demoCfg, sink: sink as any, log, devices });

    // Step 1: Rapid twist (yaw rate = 45 deg/sec = ~5900 gyro counts)
    const row1 = createTestRow({
      id: 10,
      seq: 10,
      uptime_ms: 10000,
      ts: '2026-08-16T10:00:10Z',
      gyro_raw: { x: 0, y: 0, z: 5900 },
      accel_cal: { vertical_rms: 20, vertical_peak: 50, horizontal_peak: 200, magnitude_peak: 200 },
      gyro_cal: { yaw_rate_peak: 5900, pitch_rate_peak: 0, roll_rate_peak: 0 },
    });

    // Step 2: Twist settles
    const row2 = createTestRow({
      id: 11,
      seq: 11,
      uptime_ms: 11000,
      ts: '2026-08-16T10:00:11Z',
      gyro_raw: { x: 0, y: 0, z: 0 },
      gyro_cal: { yaw_rate_peak: 0, pitch_rate_peak: 0, roll_rate_peak: 0 },
    });

    await pipeline.submit(row1);
    await pipeline.submit(row2);

    const cornerEvent = sink.events.find(
      (e) => e.type === 'driver.sharp_corner' || e.type === 'driver.excessive_cornering_speed',
    );
    expect(cornerEvent).toBeDefined();
    expect(cornerEvent?.driverId).toBe('drv-1');
  });

  it('triggers harsh acceleration on forward slide in demo mode', async () => {
    const sink = createMockSink();
    const log = createSilentLogger();
    const devices = new Map([
      [
        'ROADSCORE_001',
        {
          deviceId: 'ROADSCORE_001',
          vehicleId: 'veh-1',
          driverId: 'drv-1',
          accelFsG: 2,
          gyroFsDps: 250,
          active: true,
        },
      ],
    ]);

    const pipeline = new Pipeline({ cfg: demoCfg, sink: sink as any, log, devices });

    // Step 1: Forward slide (horizontal peak = 5000 counts = ~2.99 m/s², raw X positive)
    const row1 = createTestRow({
      id: 20,
      seq: 20,
      uptime_ms: 20000,
      ts: '2026-08-16T10:00:20Z',
      accel_raw: { x: 4500, y: 0, z: 16384 },
      accel_cal: { vertical_rms: 20, vertical_peak: 50, horizontal_peak: 5000, magnitude_peak: 5000 },
      gyro_cal: { yaw_rate_peak: 50, pitch_rate_peak: 0, roll_rate_peak: 0 },
    });

    // Step 2: Slide ends (motion stops)
    const row2 = createTestRow({
      id: 21,
      seq: 21,
      uptime_ms: 21000,
      ts: '2026-08-16T10:00:21Z',
      accel_raw: { x: 0, y: 0, z: 16384 },
      accel_cal: { vertical_rms: 10, vertical_peak: 20, horizontal_peak: 50, magnitude_peak: 50 },
    });

    await pipeline.submit(row1);
    await pipeline.submit(row2);

    const accelEvent = sink.events.find((e) => e.type === 'driver.harsh_accel');
    expect(accelEvent).toBeDefined();
    expect(accelEvent?.driverId).toBe('drv-1');
  });

  it('triggers harsh braking on backward pull/tilt in demo mode', async () => {
    const sink = createMockSink();
    const log = createSilentLogger();
    const devices = new Map([
      [
        'ROADSCORE_001',
        {
          deviceId: 'ROADSCORE_001',
          vehicleId: 'veh-1',
          driverId: 'drv-1',
          accelFsG: 2,
          gyroFsDps: 250,
          active: true,
        },
      ],
    ]);

    const pipeline = new Pipeline({ cfg: demoCfg, sink: sink as any, log, devices });

    // Step 1: Backward pull / tilt (horizontal peak = 5000 counts = ~2.99 m/s², raw X negative)
    const row1 = createTestRow({
      id: 30,
      seq: 30,
      uptime_ms: 30000,
      ts: '2026-08-16T10:00:30Z',
      accel_raw: { x: -4500, y: 0, z: 16384 },
      accel_cal: { vertical_rms: 20, vertical_peak: 50, horizontal_peak: 5000, magnitude_peak: 5000 },
      gyro_cal: { yaw_rate_peak: 50, pitch_rate_peak: 0, roll_rate_peak: 0 },
    });

    // Step 2: Settle
    const row2 = createTestRow({
      id: 31,
      seq: 31,
      uptime_ms: 31000,
      ts: '2026-08-16T10:00:31Z',
      accel_raw: { x: 0, y: 0, z: 16384 },
      accel_cal: { vertical_rms: 10, vertical_peak: 20, horizontal_peak: 50, magnitude_peak: 50 },
    });

    await pipeline.submit(row1);
    await pipeline.submit(row2);

    const brakeEvent = sink.events.find((e) => e.type === 'driver.harsh_brake');
    expect(brakeEvent).toBeDefined();
    expect(brakeEvent?.driverId).toBe('drv-1');
  });
});
