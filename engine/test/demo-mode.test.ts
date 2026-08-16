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
      cornerYaw: 0.20,
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
      absoluteFloor: 2.6,
      baselineMultiplier: 2.5,
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

    const row: RawRow = {
      id: 1,
      device_id: 'ROADSCORE_001',
      seq: 1,
      uptime_ms: 1000,
      window_ms: 1000,
      samples: 50,
      ts: '2026-08-16T10:00:00Z',
      accel_fs_g: 2,
      gyro_fs_dps: 250,
      calibration: { state: 'calibrated', age_ms: 100, gravity_ref: [0, 0, 16384] },
      accel_raw: { x: 0, y: 0, z: 16384 },
      gyro_raw: { x: 0, y: 0, z: 0 },
      accel_cal: { vertical_rms: 10, vertical_peak: 20, horizontal_peak: 20, magnitude_peak: 30 },
      gyro_cal: { yaw_rate_peak: 0, pitch_rate_peak: 0, roll_rate_peak: 0, magnitude_peak: 0 },
      mic: { rms: 50, peak: 80 },
      gps: { fix: false, lat: 0, lon: 0, speed_kmh: 0, heading: 0, altitude: 0, sats: 0, hdop: 99.0 },
      wifi_rssi: -45,
      fw_version: '1.0.0-mcu',
      dropped_posts: 0,
      created_at: '2026-08-16T10:00:00Z',
    };

    await pipeline.submit(row);

    expect(sink.trips.length).toBeGreaterThanOrEqual(1);
    expect(sink.trips[0].status).toBe('open');
    expect(sink.trips[0].deviceId).toBe('ROADSCORE_001');
  });

  it('triggers a pothole impact candidate on desk tap without GPS fix', async () => {
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

    // Tap the desk: vertical peak = 5000 counts = ~2.99 m/s² > 2.6 m/s² threshold
    const row: RawRow = {
      id: 2,
      device_id: 'ROADSCORE_001',
      seq: 2,
      uptime_ms: 2000,
      window_ms: 1000,
      samples: 50,
      ts: '2026-08-16T10:00:01Z',
      accel_fs_g: 2,
      gyro_fs_dps: 250,
      calibration: { state: 'calibrated', age_ms: 100, gravity_ref: [0, 0, 16384] },
      accel_raw: { x: 0, y: 0, z: 16384 },
      gyro_raw: { x: 0, y: 0, z: 0 },
      accel_cal: { vertical_rms: 200, vertical_peak: 5000, horizontal_peak: 100, magnitude_peak: 5000 },
      gyro_cal: { yaw_rate_peak: 0, pitch_rate_peak: 0, roll_rate_peak: 0, magnitude_peak: 0 },
      mic: { rms: 500, peak: 1200 },
      gps: { fix: false, lat: 0, lon: 0, speed_kmh: 0, heading: 0, altitude: 0, sats: 0, hdop: 99.0 },
      wifi_rssi: -45,
      fw_version: '1.0.0-mcu',
      dropped_posts: 0,
      created_at: '2026-08-16T10:00:01Z',
    };

    await pipeline.submit(row);

    const impactEvent = sink.events.find(
      (e) => e.type === 'road.impact_candidate' || e.type === 'driver.avoidable_impact' || e.type === 'road.defect_observation',
    );
    expect(impactEvent).toBeDefined();
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
    const row1: RawRow = {
      id: 10,
      device_id: 'ROADSCORE_001',
      seq: 10,
      uptime_ms: 10000,
      window_ms: 1000,
      samples: 50,
      ts: '2026-08-16T10:00:10Z',
      accel_fs_g: 2,
      gyro_fs_dps: 250,
      calibration: { state: 'calibrated', age_ms: 100, gravity_ref: [0, 0, 16384] },
      accel_raw: { x: 0, y: 0, z: 16384 },
      gyro_raw: { x: 0, y: 0, z: 5900 },
      accel_cal: { vertical_rms: 20, vertical_peak: 50, horizontal_peak: 200, magnitude_peak: 200 },
      gyro_cal: { yaw_rate_peak: 5900, pitch_rate_peak: 0, roll_rate_peak: 0, magnitude_peak: 5900 },
      mic: { rms: 50, peak: 80 },
      gps: { fix: false, lat: 0, lon: 0, speed_kmh: 0, heading: 0, altitude: 0, sats: 0, hdop: 99.0 },
      wifi_rssi: -45,
      fw_version: '1.0.0-mcu',
      dropped_posts: 0,
      created_at: '2026-08-16T10:00:10Z',
    };

    // Step 2: Twist settles
    const row2: RawRow = {
      ...row1,
      id: 11,
      seq: 11,
      uptime_ms: 11000,
      ts: '2026-08-16T10:00:11Z',
      gyro_raw: { x: 0, y: 0, z: 0 },
      gyro_cal: { yaw_rate_peak: 0, pitch_rate_peak: 0, roll_rate_peak: 0, magnitude_peak: 0 },
      created_at: '2026-08-16T10:00:11Z',
    };

    await pipeline.submit(row1);
    await pipeline.submit(row2);

    const cornerEvent = sink.events.find(
      (e) => e.type === 'driver.sharp_corner' || e.type === 'driver.excessive_cornering_speed',
    );
    expect(cornerEvent).toBeDefined();
    expect(cornerEvent?.driverId).toBe('drv-1');
  });
});
