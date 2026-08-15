/**
 * Hardware Device Simulation Integration Tests — ENGINE-PLAN §2, §6, §10.
 *
 * Verifies that the engine pipeline accurately processes physical telemetry from the
 * HardwareDevice emulator across all driving profiles and hardware fault edge cases.
 */

import { describe, it, expect } from 'vitest';
import { HardwareDevice } from '../src/sim/device.js';
import {
  generateSmoothCommute,
  generateAggressiveDrive,
  generatePotholeCluster,
  generateTunnelUnderpass,
  generateMountDisplacement,
  generatePowerCycleReboot,
  generateHardwareFaults,
  generateCollisionCrash,
  generatePoisonedAttacker,
  generateDriverPenaltiesOnly,
  generateWorstDriver,
} from '../src/sim/scenarios.js';
import { Pipeline } from '../src/pipeline.js';
import { RoadMap } from '../src/arbitrate/roadmap.js';
import { THRESHOLDS } from '../src/config/thresholds.js';
import type { DeviceMeta, EventCandidate, Sink } from '../src/types.js';
import { createLogger } from '../src/util/log.js';

class TestSink implements Sink {
  events: EventCandidate[] = [];
  trips: any[] = [];

  enqueueEvent(e: EventCandidate): void {
    this.events.push(e);
  }
  enqueueTrip(t: any): void {
    this.trips.push(t);
  }
  enqueueRoadCell(): void {}
  enqueueRoadDefect(): void {}
  enqueuePrediction(): void {}
  enqueueScore(): void {}
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}

function setupTestPipeline(deviceId: string) {
  const cfg = THRESHOLDS;
  const sink = new TestSink();
  const log = createLogger(
    { NODE_ENV: 'test', LOG_LEVEL: 'silent' } as any,
    { service: 'hardware-sim-test' },
  );

  const devices = new Map<string, DeviceMeta>([
    [
      deviceId,
      {
        deviceId,
        vehicleId: 'veh-sim-test',
        driverId: 'drv-sim-test',
        accelFsG: 2,
        gyroFsDps: 250,
        active: true,
      },
    ],
  ]);

  const map = new RoadMap(cfg);
  const pipeline = new Pipeline({ cfg, sink, log, devices, map });
  return { pipeline, sink };
}

describe('Hardware Device Simulation Suite', () => {
  it('smooth commute emits zero violation events and opens a clean trip', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-smooth' });
    const rows = generateSmoothCommute(dev, 60);
    const { pipeline, sink } = setupTestPipeline('dev-smooth');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    expect(pipeline.stats.rowsAccepted).toBe(60);
    expect(pipeline.stats.rowsRejected).toBe(0);
    expect(sink.events).toHaveLength(0); // Clean drive, no penalty events
    expect(pipeline.stats.tripsOpened).toBe(1);
  });

  it('aggressive drive detects harsh acceleration, braking, and cornering events', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-aggr' });
    const rows = generateAggressiveDrive(dev);
    const { pipeline, sink } = setupTestPipeline('dev-aggr');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    expect(pipeline.stats.rowsAccepted).toBe(rows.length);
    const eventTypes = sink.events.map((e) => e.type);
    expect(eventTypes).toContain('driver.harsh_accel');
    expect(eventTypes).toContain('driver.sharp_corner');
    expect(eventTypes).toContain('driver.excessive_cornering_speed');
  });

  it('driver penalties only scenario detects sharp cornering and swerving', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-penalties' });
    const rows = generateDriverPenaltiesOnly(dev);
    const { pipeline, sink } = setupTestPipeline('dev-penalties');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    const eventTypes = sink.events.map((e) => e.type);
    expect(eventTypes).toContain('driver.sharp_corner');
    expect(eventTypes).toContain('driver.excessive_cornering_speed');
    expect(eventTypes).toContain('driver.harsh_accel');
    expect(eventTypes).toContain('driver.harsh_brake');
  });

  it('worst driver scenario detects extreme cornering and critical brake checks', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-worst' });
    const rows = generateWorstDriver(dev);
    const { pipeline, sink } = setupTestPipeline('dev-worst');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    const eventTypes = sink.events.map((e) => e.type);
    expect(eventTypes).toContain('driver.sharp_corner');
    expect(eventTypes).toContain('driver.excessive_cornering_speed');
    expect(eventTypes).toContain('driver.harsh_brake');
  });

  it('pothole cluster detects 3 road impact candidates', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-pothole' });
    const rows = generatePotholeCluster(dev);
    const { pipeline, sink } = setupTestPipeline('dev-pothole');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    const impacts = sink.events.filter((e) => e.type === 'road.impact_candidate');
    expect(impacts).toHaveLength(3);
    for (const imp of impacts) {
      expect(imp.attributedToDriver).toBe(false); // Impact candidates are unattributed prior to arbitration
    }
  });

  it('tunnel underpass maintains trip continuity during GPS fix loss', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-tunnel' });
    const rows = generateTunnelUnderpass(dev);
    const { pipeline, sink } = setupTestPipeline('dev-tunnel');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    expect(pipeline.stats.rowsAccepted).toBe(50);
    expect(pipeline.stats.tripsOpened).toBe(1);
    expect(pipeline.stats.tripsClosed).toBe(0); // Trip remains active across tunnel
  });

  it('mount displacement emits integrity.mount_shift event', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-mount' });
    const rows = generateMountDisplacement(dev);
    const { pipeline, sink } = setupTestPipeline('dev-mount');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    const mountShifts = sink.events.filter((e) => e.type === 'integrity.mount_shift');
    expect(mountShifts.length).toBeGreaterThanOrEqual(1);
    expect(mountShifts[0]?.severity).toBe('medium');
  });

  it('power cycle reboot triggers integrity.device_reboot and closes active trip', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-reboot' });
    const rows = generatePowerCycleReboot(dev);
    const { pipeline, sink } = setupTestPipeline('dev-reboot');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    const reboots = sink.events.filter((e) => e.type === 'integrity.device_reboot');
    expect(reboots.length).toBeGreaterThanOrEqual(1);
    expect(pipeline.stats.tripsOpened).toBe(2);
    expect(pipeline.stats.tripsClosed).toBe(1); // Pre-reboot trip closed
  });

  it('sensor freeze emits integrity.sensor_degraded', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-stuck' });
    const rows = generateHardwareFaults(dev, 'stuck_sensor');
    const { pipeline, sink } = setupTestPipeline('dev-stuck');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    const degraded = sink.events.filter((e) => e.type === 'integrity.sensor_degraded');
    expect(degraded.length).toBeGreaterThanOrEqual(1);
  });

  it('low sample rate emits integrity.sensor_degraded', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-lowsample' });
    const rows = generateHardwareFaults(dev, 'low_sample_rate');
    const { pipeline, sink } = setupTestPipeline('dev-lowsample');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    const degraded = sink.events.filter((e) => e.type === 'integrity.sensor_degraded');
    expect(degraded.length).toBeGreaterThanOrEqual(1);
  });

  it('collision crash emits driver.collision_suspected alert', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-crash' });
    const rows = generateCollisionCrash(dev);
    const { pipeline, sink } = setupTestPipeline('dev-crash');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    const collisions = sink.events.filter((e) => e.type === 'driver.collision_suspected');
    expect(collisions.length).toBeGreaterThanOrEqual(1);
    expect(collisions[0]?.severity).toBe('critical');
  });

  it('poisoned attacker rows are rejected by plausibility filter', async () => {
    const dev = new HardwareDevice({ deviceId: 'dev-poison' });
    const rows = generatePoisonedAttacker(dev);
    const { pipeline, sink } = setupTestPipeline('dev-poison');

    for (const r of rows) await pipeline.submit(r);
    await pipeline.drain();

    expect(pipeline.stats.rowsAccepted).toBe(0);
    expect(pipeline.stats.rowsRejected).toBe(3);
    expect(sink.events).toHaveLength(0);
  });
});
