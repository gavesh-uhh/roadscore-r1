/**
 * End-to-end pipeline — ENGINE-PLAN §3, §5, §9.
 *
 * Everything before this file tests one layer. This one runs real telemetry rows
 * through the whole chain — normalize → trips → detect → arbitrate → predict →
 * score — with an in-memory sink, and asserts the properties the plan claims for
 * the system as a whole rather than for any single module.
 *
 * The centrepiece is the three-device fleet scenario from §11 Phase 3 / §13: the
 * same pothole, hit by three vehicles, must stop penalising any of them.
 */

import { describe, it, expect } from 'vitest';
import { THRESHOLDS, G, RULE_VERSION } from '../src/config/thresholds.js';
import { Pipeline } from '../src/pipeline.js';
import { InMemorySink } from '../src/sink/writer.js';
import { createSilentLogger } from '../src/util/log.js';
import { isScorable, toScorable } from '../src/score/penalties.js';
import { scoreTrip } from '../src/score/rollup.js';
import type { DeviceMeta, RawRow } from '../src/types.js';

const cfg = THRESHOLDS;
const COUNTS_PER_G = 16384;
const COUNTS_PER_DPS = 131.072;
const mps2ToCounts = (a: number): number => Math.round((a / G) * COUNTS_PER_G);
const dpsToCounts = (d: number): number => Math.round(d * COUNTS_PER_DPS);

const T0 = Date.UTC(2026, 7, 1, 6, 0, 0) / 1000;

/** The pothole sits this many rows into every device's drive. */
const POTHOLE_ROW = 45;

function devices(ids: string[]): Map<string, DeviceMeta> {
  return new Map(
    ids.map((deviceId, i) => [
      deviceId,
      {
        deviceId,
        vehicleId: `veh-${i}`,
        driverId: `drv-${i}`,
        accelFsG: 2,
        gyroFsDps: 250,
        active: true,
      },
    ]),
  );
}

interface RowOpts {
  deviceId: string;
  i: number;
  idBase: number;
  speedKmh?: number;
  prevKmh?: number;
  /** Vertical peak in m/s² — the pothole knob. */
  vertPeak?: number;
  vertRms?: number;
  /** Same track for every device, so they share H3 cells. */
  lat?: number;
  lon?: number;
}

function row(o: RowOpts): RawRow {
  const speed = o.speedKmh ?? 45;
  const prev = o.prevKmh ?? speed;
  const aLong = (speed - prev) / 3.6;
  const vertRms = o.vertRms ?? 0.45;
  const vertPeak = o.vertPeak ?? vertRms * 2.4;
  const horizPeak = Math.abs(aLong) + 0.35;
  const magPeak = Math.hypot(horizPeak, vertPeak);

  return {
    id: o.idBase + o.i,
    device_id: o.deviceId,
    ts: new Date((T0 + o.i) * 1000).toISOString(),
    uptime_ms: 60_000 + o.i * 1000,
    seq: o.i + 1,
    samples: 50,
    accel_raw: { x: 10 + (o.i % 7), y: -20 + (o.i % 5), z: 16_300 + (o.i % 11) },
    accel_cal: {
      vertical_peak: mps2ToCounts(vertPeak),
      vertical_rms: mps2ToCounts(vertRms),
      horizontal_peak: mps2ToCounts(horizPeak),
      magnitude_peak: mps2ToCounts(magPeak),
    },
    gyro_raw: { x: 1, y: 2, z: 3 },
    gyro_cal: { yaw_rate_peak: dpsToCounts(0.6), pitch_rate_peak: 100, roll_rate_peak: 90 },
    gps: {
      fix: true,
      // Identical track for every device — that is what makes them comparable.
      lat: o.lat ?? 6.9271 + o.i * 0.00012,
      lon: o.lon ?? 79.8612,
      alt_m: 8,
      speed_kmh: speed,
      heading: 0, // due north, along increasing latitude
      sats: 9,
      hdop: 0.9,
    },
    mic: { rms: 1100 + (o.i % 13) * 7, peak: 1500 + (o.i % 9) * 11 },
    calibration: {
      state: 'calibrated',
      age_ms: 120_000,
      gravity_ref: { x: 120, y: -240, z: 16_290 },
    },
    wifi_rssi: -62,
    server_received_at: new Date((T0 + o.i) * 1000 + 300).toISOString(),
  };
}

function newPipeline(
  ids: string[],
  extraOpts?: Partial<ConstructorParameters<typeof Pipeline>[0]>,
): { pipeline: Pipeline; sink: InMemorySink } {
  const sink = new InMemorySink();
  const pipeline = new Pipeline({
    cfg,
    sink,
    log: createSilentLogger(),
    devices: devices(ids),
    // Fixed clock: the §9 eviction timer is the only consumer, and a real clock
    // would make this test time-dependent.
    now: () => 1_000_000,
    ...extraOpts,
  });
  return { pipeline, sink };
}

/** Drive one device over the shared track, hitting the pothole at POTHOLE_ROW. */
async function driveOver(
  pipeline: Pipeline,
  deviceId: string,
  idBase: number,
  opts: { hitPothole: boolean; rows?: number } = { hitPothole: true },
): Promise<void> {
  const rows = opts.rows ?? 60;
  for (let i = 0; i < rows; i++) {
    const isPothole = opts.hitPothole && i === POTHOLE_ROW;
    await pipeline.submit(
      row({
        deviceId,
        i,
        idBase,
        vertPeak: isPothole ? 6.2 : undefined,
        vertRms: isPothole ? 2.3 : undefined,
      }),
    );
  }
  await pipeline.drain();
}

// ===========================================================================
// §11 Phase 3 / §13 — the three-device fleet demo
// ===========================================================================

describe('end-to-end: fleet consensus stops penalising drivers', () => {
  it('three devices over the same pothole → road defect, nobody penalised', async () => {
    const { pipeline, sink } = newPipeline(['dev-a', 'dev-b', 'dev-c']);

    await driveOver(pipeline, 'dev-a', 10_000);
    await driveOver(pipeline, 'dev-b', 20_000);
    await driveOver(pipeline, 'dev-c', 30_000);

    const impacts = sink.batch.events.filter(
      (e) => e.type === 'road.impact_candidate' || e.type === 'road.defect_observation' || e.type === 'driver.avoidable_impact',
    );
    expect(impacts.length).toBeGreaterThanOrEqual(3);

    // By the third device the cell has 3 distinct witnesses, so at least one
    // impact must have been arbitrated as the ROAD's fault.
    const defectObservations = impacts.filter((e) => e.type === 'road.defect_observation');
    expect(defectObservations.length).toBeGreaterThan(0);

    // The claim, stated as an assertion: no impact on this shared pothole is
    // ever charged to a driver.
    for (const e of impacts) {
      expect(e.attributedToDriver).toBe(false);
      expect(isScorable(toScorable(e), cfg)).toBe(false);
    }

    // And it becomes a maintenance record with real evidence behind it.
    expect(sink.batch.roadDefects.length).toBeGreaterThan(0);
    const defect = sink.batch.roadDefects[0]!;
    expect(defect.distinctDevices).toBeGreaterThanOrEqual(cfg.arbitration.minDistinctDevices);
    expect(defect.spikeRate).toBeGreaterThanOrEqual(cfg.arbitration.roadSpikeRate);
  });

  it('a lone impact where the fleet drives cleanly IS charged to the driver', async () => {
    const { pipeline, sink } = newPipeline(['dev-a', 'dev-b', 'dev-c', 'dev-d']);

    // Three devices establish that the road here is fine.
    await driveOver(pipeline, 'dev-a', 10_000, { hitPothole: false });
    await driveOver(pipeline, 'dev-b', 20_000, { hitPothole: false });
    await driveOver(pipeline, 'dev-c', 30_000, { hitPothole: false });

    // The fourth hits something anyway — a kerb, or inattention.
    await driveOver(pipeline, 'dev-d', 40_000, { hitPothole: true });

    const blamed = sink.batch.events.filter((e) => e.type === 'driver.avoidable_impact');
    expect(blamed.length).toBeGreaterThan(0);
    expect(blamed[0]!.attributedToDriver).toBe(true);
    expect(blamed[0]!.deviceId).toBe('dev-d');
    expect(isScorable(toScorable(blamed[0]!), cfg)).toBe(true);

    // No defect record: the road is not at fault.
    expect(sink.batch.roadDefects).toHaveLength(0);
  });

  it('the FIRST device to find a pothole is not blamed for it', async () => {
    // §13's risk: "Small fleet → no road consensus". The mitigation is that the
    // undecided path must not default to blame.
    const { pipeline, sink } = newPipeline(['dev-a']);
    await driveOver(pipeline, 'dev-a', 10_000);

    const impacts = sink.batch.events.filter((e) => e.category === 'road');
    expect(impacts.length).toBeGreaterThan(0);
    for (const e of impacts) {
      expect(e.attributedToDriver).toBe(false);
      expect(e.confidence).toBeLessThan(cfg.arbitration.undecidedMaxConfidence);
    }
  });
});

// ===========================================================================
// Pipeline mechanics
// ===========================================================================

describe('end-to-end: pipeline mechanics', () => {
  it('rejects unknown devices so the fleet map cannot be poisoned (§3)', async () => {
    const { pipeline, sink } = newPipeline(['dev-a']);
    await pipeline.submit(row({ deviceId: 'attacker', i: 0, idBase: 99_000 }));
    await pipeline.drain();

    expect(pipeline.stats.rowsAccepted).toBe(0);
    expect(pipeline.stats.rowsRejected).toBe(1);
    expect(pipeline.stats.rejections.get('unknown_device')).toBe(1);
    expect(sink.batch.events).toHaveLength(0);
    expect(pipeline.map.size()).toBe(0);
  });

  it('rejects implausible telemetry (§3 plausibility gate)', async () => {
    const { pipeline } = newPipeline(['dev-a']);
    // 900 km/h, and a position on the other side of the world.
    const bad = row({ deviceId: 'dev-a', i: 0, idBase: 1000, speedKmh: 900 });
    await pipeline.submit(bad);
    const offMap = row({ deviceId: 'dev-a', i: 1, idBase: 1000, lat: 51.5, lon: -0.12 });
    await pipeline.submit(offMap);
    await pipeline.drain();

    expect(pipeline.stats.rowsRejected).toBe(2);
    expect(pipeline.stats.rowsAccepted).toBe(0);
  });

  it('stamps every event with an idempotency key and provenance (§4)', async () => {
    const { pipeline, sink } = newPipeline(['dev-a']);
    await driveOver(pipeline, 'dev-a', 10_000);

    expect(sink.batch.events.length).toBeGreaterThan(0);
    const keys = new Set<string>();
    for (const e of sink.batch.events) {
      expect(e.eventKey).toBeTruthy();
      expect(e.ruleVersion).toBe(RULE_VERSION);
      expect(e.engineVersion).toBeTruthy();
      // Auditable: every event cites the exact source rows.
      expect(e.telemetryIds.length).toBeGreaterThan(0);
      keys.add(e.eventKey);
    }
    // No duplicate keys within one run.
    expect(keys.size).toBe(sink.batch.events.length);
  });

  it('is idempotent: the same drive twice yields the same event keys (§9)', async () => {
    const runKeys = async (): Promise<string[]> => {
      const { pipeline, sink } = newPipeline(['dev-a']);
      await driveOver(pipeline, 'dev-a', 10_000);
      return sink.batch.events.map((e) => e.eventKey).sort();
    };
    // Replay, sweeper overlap and duplicate Realtime messages all rely on this.
    expect(await runKeys()).toEqual(await runKeys());
  });

  it('opens a trip, accumulates distance, and closes it on shutdown', async () => {
    const { pipeline, sink } = newPipeline(['dev-a']);
    await driveOver(pipeline, 'dev-a', 10_000, { hitPothole: false });

    expect(pipeline.stats.tripsOpened).toBe(1);
    await pipeline.shutdown();

    const trips = sink.batch.trips;
    expect(trips.length).toBeGreaterThan(0);
    const closed = trips[trips.length - 1]!;
    expect(closed.distanceM).toBeGreaterThan(100);
    expect(closed.gpsCoverage).toBeGreaterThan(0.9);
    expect(closed.maxSpeedKmh).toBeCloseTo(45, 0);
    expect(closed.endedAt).not.toBeNull();
  });

  it('builds the fleet road map as it goes (§7.1)', async () => {
    const { pipeline, sink } = newPipeline(['dev-a', 'dev-b']);
    await driveOver(pipeline, 'dev-a', 10_000, { hitPothole: false });
    await driveOver(pipeline, 'dev-b', 20_000, { hitPothole: false });

    expect(pipeline.map.size()).toBeGreaterThan(10);
    expect(sink.batch.roadCells.length).toBeGreaterThan(0);

    // The shared track means cells accumulate two distinct devices.
    const shared = pipeline.map.all().filter((c) => c.deviceCount >= 2);
    expect(shared.length).toBeGreaterThan(0);
  });

  it('keeps devices independent while processing rows in order per device (§5)', async () => {
    const { pipeline } = newPipeline(['dev-a', 'dev-b']);
    // Interleave submissions from two devices without awaiting each one.
    const work: Promise<void>[] = [];
    for (let i = 0; i < 30; i++) {
      work.push(pipeline.submit(row({ deviceId: 'dev-a', i, idBase: 10_000 })));
      work.push(pipeline.submit(row({ deviceId: 'dev-b', i, idBase: 20_000 })));
    }
    await Promise.all(work);
    await pipeline.drain();

    // Both devices got a complete, correctly-ordered ring: a device whose rows
    // had interleaved would have produced data-gap events from a scrambled seq.
    expect(pipeline.stats.rowsAccepted).toBe(60);
    expect(pipeline.deviceCount()).toBe(2);
    for (const id of ['dev-a', 'dev-b']) {
      const st = pipeline.stateOf(id)!;
      expect(st.ring.size).toBe(30);
      expect(st.ring.seqAt(0)).toBe(30);
    }
  });

  it('a score computed from pipeline output reconciles end to end', async () => {
    const { pipeline, sink } = newPipeline(['dev-a']);
    // A drive with a genuinely harsh brake in it.
    const rows = 60;
    for (let i = 0; i < rows; i++) {
      const braking = i >= 40 && i <= 43;
      const speeds = [45, 30, 15, 2, 0];
      const speedKmh = braking ? speeds[i - 39]! : i > 43 ? 0 : 45;
      const prevKmh = braking ? speeds[i - 40]! : i > 43 ? 0 : 45;
      await pipeline.submit(row({ deviceId: 'dev-a', i, idBase: 10_000, speedKmh, prevKmh }));
    }
    await pipeline.shutdown();

    const brakes = sink.batch.events.filter((e) => e.type === 'driver.harsh_brake');
    expect(brakes.length).toBeGreaterThan(0);

    const trip = sink.batch.trips[sink.batch.trips.length - 1]!;
    const score = scoreTrip(
      { trip, events: sink.batch.events.map(toScorable) },
      cfg,
      RULE_VERSION,
    );

    // The breakdown must explain the score, and only driver events may appear.
    expect(score.breakdown.contributions.length).toBeGreaterThan(0);
    for (const c of score.breakdown.contributions) {
      expect(c.type.startsWith('driver.')).toBe(true);
    }
    const raw = score.breakdown.contributions.reduce((s, c) => s + c.penalty, 0);
    expect(raw).toBeCloseTo(score.breakdown.rawPenalty, 6);
    expect(score.score).toBeLessThan(100);
    expect(score.score).toBeGreaterThanOrEqual(0);
  });

  it('closes open trips and flushes the road map on shutdown', async () => {
    const { pipeline, sink } = newPipeline(['dev-a']);
    await driveOver(pipeline, 'dev-a', 10_000, { hitPothole: false });
    const cellsBefore = sink.batch.roadCells.length;
    await pipeline.shutdown();
    // The final state of every cell is persisted, not just the ones touched last.
    expect(sink.batch.roadCells.length).toBeGreaterThan(cellsBefore);
    expect(sink.batch.trips.some((t) => t.status === 'closed' || t.status === 'abandoned')).toBe(true);
  });

  it('auto-closes trip after 90 seconds of continuous stationary dwell', async () => {
    const { pipeline, sink } = newPipeline(['dev-a']);
    // 10 seconds of driving at 50 km/h to open a trip
    for (let i = 0; i < 10; i++) {
      await pipeline.submit(row({ deviceId: 'dev-a', i, idBase: 10_000, speedKmh: 50 }));
    }
    expect(pipeline.stateOf('dev-a')?.trip).not.toBeNull();

    // 90 seconds of stationary dwell (speed = 0)
    for (let i = 10; i <= 100; i++) {
      await pipeline.submit(row({ deviceId: 'dev-a', i, idBase: 10_000, speedKmh: 0 }));
    }
    await pipeline.drain();

    // Trip must have closed upon hitting 90s stationary threshold
    expect(pipeline.stateOf('dev-a')?.trip).toBeNull();
    const closedTrips = sink.batch.trips.filter((t) => t.deviceId === 'dev-a');
    expect(closedTrips.length).toBeGreaterThan(0);
    expect(closedTrips[closedTrips.length - 1]?.status).toBe('closed');
  });

  it('evictStale automatically closes orphan open trips when telemetry stops for 120s', async () => {
    let fakeTime = 1_000_000;
    const { pipeline } = newPipeline(['dev-a'], { now: () => fakeTime, stateTtlMs: 120_000 });

    // Open a trip with 65 seconds of driving (>60s duration and >200m distance)
    for (let i = 0; i < 65; i++) {
      await pipeline.submit(row({ deviceId: 'dev-a', i, idBase: 10_000, speedKmh: 45 }));
    }
    expect(pipeline.stateOf('dev-a')?.trip).not.toBeNull();

    // Fast-forward wall clock by 130 seconds (vehicle engine turned off, no rows received)
    fakeTime += 130_000;
    const closed = pipeline.evictStale();
    expect(closed.length).toBe(1);
    expect(closed[0]?.deviceId).toBe('dev-a');
    expect(closed[0]?.status).toBe('closed');
    expect(pipeline.deviceCount()).toBe(0);
  });

  it('forceCloseDeviceTrip immediately finalizes and scores an active trip on demand', async () => {
    const { pipeline } = newPipeline(['dev-a']);
    for (let i = 0; i < 65; i++) {
      await pipeline.submit(row({ deviceId: 'dev-a', i, idBase: 10_000, speedKmh: 40 }));
    }
    expect(pipeline.stateOf('dev-a')?.trip).not.toBeNull();

    const closed = pipeline.forceCloseDeviceTrip('dev-a');
    expect(closed).not.toBeNull();
    expect(closed?.deviceId).toBe('dev-a');
    expect(closed?.status).toBe('closed');
    expect(pipeline.stateOf('dev-a')?.trip).toBeNull();
  });
});
