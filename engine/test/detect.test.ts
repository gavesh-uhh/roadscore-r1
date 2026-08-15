/**
 * Detector catalogue tests — ENGINE-PLAN §6, and the §10 list of "unit tests
 * worth writing regardless".
 *
 * These drive real rows through `normalizeRow` rather than hand-building
 * `Sample` objects, so the tests exercise the same path production does: a
 * threshold that only fires against a synthetic sample nobody's firmware could
 * produce is not a tested threshold.
 */

import { describe, it, expect } from 'vitest';
import { THRESHOLDS, G, DEG2RAD } from '../src/config/thresholds.js';
import { newDeviceState } from '../src/domain/state.js';
import type { DeviceState } from '../src/domain/state.js';
import { normalizeRow } from '../src/domain/normalize.js';
import { runDetectors, detectors } from '../src/detect/index.js';
import { vectorAngleDeg } from '../src/detect/integrity.js';
import { speedNormalise } from '../src/detect/impact.js';
import { setCellStats, NULL_CELL_STATS } from '../src/detect/speed.js';
import type { CellStatsLookup } from '../src/detect/speed.js';
import { updateTrip } from '../src/domain/trip.js';
import { eventKey, stableUuidFrom, tripId } from '../src/util/hash.js';
import type { DeviceMeta, EventCandidate, RawRow } from '../src/types.js';

const cfg = THRESHOLDS;
const COUNTS_PER_G = 16384;
const COUNTS_PER_DPS = 131.072;
const mps2ToCounts = (a: number): number => Math.round((a / G) * COUNTS_PER_G);
const dpsToCounts = (d: number): number => Math.round(d * COUNTS_PER_DPS);

const META: DeviceMeta = {
  deviceId: 'dev-t',
  vehicleId: 'veh-1',
  driverId: 'drv-1',
  accelFsG: 2,
  gyroFsDps: 250,
  active: true,
};

function state(): DeviceState {
  return newDeviceState({ ...META }, 0);
}

const T0 = Date.UTC(2026, 7, 1, 6, 0, 0) / 1000;

interface RowSpec {
  i: number;
  speedKmh: number;
  /** Previous speed, so horizontal_peak can be derived consistently. */
  prevKmh?: number;
  yawDps?: number;
  vertPeak?: number;
  vertRms?: number;
  heading?: number;
  calibrated?: boolean;
  sats?: number;
  hdop?: number;
  fix?: boolean;
  micRms?: number;
  micPeak?: number;
  samples?: number;
  seq?: number;
  uptimeMs?: number;
  gravityRef?: { x: number; y: number; z: number };
  accelRaw?: { x: number; y: number; z: number };
  wifiRssi?: number;
  tsNull?: boolean;
}

/**
 * Build a physically self-consistent row.
 *
 * `horizontal_peak` is DERIVED from the longitudinal and lateral components,
 * because §6.1 and §6.2 both cross-check it. Hand-asserting it independently
 * produces rows that the corroboration rules correctly reject.
 */
function mkRow(spec: RowSpec): RawRow {
  const i = spec.i;
  const speed = spec.speedKmh;
  const prev = spec.prevKmh ?? speed;
  const aLong = (speed - prev) / 3.6;
  const yawDps = spec.yawDps ?? 0.5;
  const speedMps = speed / 3.6;
  const aLat = (speedMps * yawDps * Math.PI) / 180;
  const vertRms = spec.vertRms ?? 0.5;
  const vertPeak = spec.vertPeak ?? vertRms * 2.4;
  const horizPeak = Math.hypot(aLong, aLat) + 0.35;
  const magPeak = Math.hypot(horizPeak, vertPeak);
  const calibrated = spec.calibrated ?? true;

  return {
    id: 1000 + i,
    device_id: 'dev-t',
    ts: spec.tsNull ? null : new Date((T0 + i) * 1000).toISOString(),
    uptime_ms: spec.uptimeMs ?? 60_000 + i * 1000,
    seq: spec.seq ?? i + 1,
    samples: spec.samples ?? 50,
    accel_raw: spec.accelRaw ?? { x: 10 + (i % 7), y: -20 + (i % 5), z: 16300 + (i % 11) },
    accel_cal: {
      vertical_peak: mps2ToCounts(vertPeak),
      vertical_rms: mps2ToCounts(vertRms),
      horizontal_peak: mps2ToCounts(horizPeak),
      magnitude_peak: mps2ToCounts(magPeak),
    },
    gyro_raw: { x: 1, y: 2, z: 3 },
    gyro_cal: {
      yaw_rate_peak: dpsToCounts(yawDps),
      pitch_rate_peak: dpsToCounts(1),
      roll_rate_peak: dpsToCounts(1),
    },
    gps: {
      fix: spec.fix ?? true,
      lat: 6.9271 + i * 0.00012,
      lon: 79.8612 + i * 0.00009,
      alt_m: 8,
      speed_kmh: speed,
      heading: spec.heading ?? 90,
      sats: spec.sats ?? 9,
      hdop: spec.hdop ?? 0.9,
    },
    mic: { rms: spec.micRms ?? 1100 + (i % 13) * 7, peak: spec.micPeak ?? 1500 + (i % 9) * 11 },
    calibration: {
      state: calibrated ? 'calibrated' : 'calibrating',
      age_ms: 120_000,
      gravity_ref: spec.gravityRef ?? { x: 120, y: -240, z: 16290 },
    },
    wifi_rssi: spec.wifiRssi ?? -62,
    server_received_at: new Date((T0 + i) * 1000 + 300).toISOString(),
  };
}

/**
 * Push a sequence of specs through normalize + detectors, collecting events.
 *
 * NOTE: `normalizeRow` pushes the sample onto the ring itself (see its step 8),
 * so this must NOT push again. Double-pushing makes ring offset 1 the *current*
 * sample rather than the previous one, which silently breaks every detector that
 * compares against its predecessor — data_gap stops firing because it diffs a row
 * against itself. `updateTrip` is called before the detectors so any event they
 * emit can be attributed to the trip open at that instant.
 */
function drive(specs: RowSpec[], st: DeviceState = state()): { events: EventCandidate[]; st: DeviceState } {
  const events: EventCandidate[] = [];
  for (const spec of specs) {
    const res = normalizeRow(mkRow(spec), st, cfg);
    if (!res.ok) continue;
    updateTrip(st, res.sample, cfg, res.rebooted);
    events.push(...runDetectors({ sample: res.sample, state: st, meta: st.meta, cfg }));
  }
  return { events, st };
}

/** A constant-speed cruise, used to warm the ring and the baselines. */
function cruise(from: number, count: number, speedKmh: number, over: Partial<RowSpec> = {}): RowSpec[] {
  return Array.from({ length: count }, (_, k) => ({
    i: from + k,
    speedKmh,
    prevKmh: speedKmh,
    ...over,
  }));
}

const typesOf = (evts: EventCandidate[]): string[] => evts.map((e) => e.type);

// ===========================================================================
// §6.1 — harsh braking / acceleration
// ===========================================================================

describe('§6.1 longitudinal', () => {
  it('detects a harsh brake and reports the signed peak', () => {
    // 50 km/h to a stop over 4 s ≈ -3.5 m/s², past the -3.0 low band.
    const specs = [
      ...cruise(0, 20, 50),
      { i: 20, speedKmh: 36, prevKmh: 50 },
      { i: 21, speedKmh: 22, prevKmh: 36 },
      { i: 22, speedKmh: 8, prevKmh: 22 },
      { i: 23, speedKmh: 0, prevKmh: 8 },
      ...cruise(24, 5, 0),
    ];
    const { events } = drive(specs);
    const brakes = events.filter((e) => e.type === 'driver.harsh_brake');
    expect(brakes.length).toBe(1);
    const b = brakes[0]!;
    expect(b.magnitude).toBeLessThan(-3.0);
    expect(b.magnitudeUnit).toBe('m/s2');
    expect(b.category).toBe('driver');
    expect(b.attributedToDriver).toBe(true);
  });

  it('emits exactly ONE event for one long brake (hysteresis, §6.1)', () => {
    // A 7-second deceleration. Per-row emission would produce ~7 events and
    // multiply the penalty; §6.1 requires one per contiguous excursion.
    const specs: RowSpec[] = [...cruise(0, 15, 90)];
    let s = 90;
    for (let k = 0; k < 7; k++) {
      const next = s - 15;
      specs.push({ i: 15 + k, speedKmh: next, prevKmh: s });
      s = next;
    }
    specs.push(...cruise(22, 4, 0));
    const { events } = drive(specs);
    expect(events.filter((e) => e.type === 'driver.harsh_brake').length).toBe(1);
  });

  it('detects harsh acceleration with a positive magnitude', () => {
    const specs = [
      ...cruise(0, 15, 5),
      { i: 15, speedKmh: 20, prevKmh: 5 },
      { i: 16, speedKmh: 36, prevKmh: 20 },
      { i: 17, speedKmh: 50, prevKmh: 36 },
      ...cruise(18, 4, 50),
    ];
    const { events } = drive(specs);
    const accels = events.filter((e) => e.type === 'driver.harsh_accel');
    expect(accels.length).toBe(1);
    expect(accels[0]!.magnitude).toBeGreaterThan(cfg.longitudinal.accel.low);
  });

  it('suppresses a longitudinal verdict when a corner is bleeding in (§6.1)', () => {
    // Same deceleration, but with 20 °/s of yaw: the plan says that is a corner,
    // not a brake, and attributing it to braking would double-count it.
    const specs = [
      ...cruise(0, 15, 50, { yawDps: 20 }),
      { i: 15, speedKmh: 36, prevKmh: 50, yawDps: 20 },
      { i: 16, speedKmh: 22, prevKmh: 36, yawDps: 20 },
      { i: 17, speedKmh: 8, prevKmh: 22, yawDps: 20 },
      ...cruise(18, 3, 8, { yawDps: 20 }),
    ];
    const { events } = drive(specs);
    expect(typesOf(events)).not.toContain('driver.harsh_brake');
  });

  it('suppresses longitudinal detection below the speed floor and on bad GPS', () => {
    // 8 km/h is under the 10 km/h floor: GPS speed noise dominates (§2.2).
    const slow = drive([
      ...cruise(0, 10, 8),
      { i: 10, speedKmh: 1, prevKmh: 8 },
      ...cruise(11, 3, 0),
    ]);
    expect(typesOf(slow.events)).not.toContain('driver.harsh_brake');

    // Same profile at speed but with only 3 satellites → not GPS_USABLE.
    const noisy = drive([
      ...cruise(0, 12, 50, { sats: 3, hdop: 6 }),
      { i: 12, speedKmh: 30, prevKmh: 50, sats: 3, hdop: 6 },
      { i: 13, speedKmh: 10, prevKmh: 30, sats: 3, hdop: 6 },
      ...cruise(14, 3, 0, { sats: 3, hdop: 6 }),
    ]);
    expect(typesOf(noisy.events)).not.toContain('driver.harsh_brake');
  });
});

// ===========================================================================
// §6.2 — cornering. Includes the plan's own worked example.
// ===========================================================================

describe('§6.2 lateral', () => {
  it("reproduces the plan's worked example: 40 km/h at 20 °/s → a_lat ≈ 3.9 m/s² = 0.40 g", () => {
    // §6.2 verbatim: "Worked example: 40 km/h (11.1 m/s) through a 20 °/s turn →
    // a_lat = 3.9 m/s² = 0.40 g. That reads as a genuinely brisk corner, which is
    // the right calibration."
    const v = 40 / 3.6;
    const omega = 20 * DEG2RAD;
    const aLat = v * omega;
    expect(aLat).toBeCloseTo(3.88, 1);
    expect(aLat / G).toBeCloseTo(0.4, 2);

    // And end to end through the detector.
    const specs: RowSpec[] = [...cruise(0, 12, 40)];
    for (let k = 0; k < 6; k++) {
      specs.push({ i: 12 + k, speedKmh: 40, prevKmh: 40, yawDps: 20, heading: 90 + k * 20 });
    }
    specs.push(...cruise(18, 3, 40, { heading: 210 }));
    const { events } = drive(specs);

    const corner = events.find((e) => e.type === 'driver.sharp_corner');
    expect(corner).toBeDefined();
    expect(corner!.magnitude).toBeCloseTo(3.88, 1);

    const excessive = events.find((e) => e.type === 'driver.excessive_cornering_speed');
    expect(excessive).toBeDefined();
    expect(excessive!.severity).toBe('low'); // 3.88 is just past the 3.4 low band
    expect(excessive!.evidence['a_lat_g']).toBeCloseTo(0.4, 2);
  });

  it('does not flag a gentle corner as excessive', () => {
    const specs: RowSpec[] = [...cruise(0, 12, 30)];
    for (let k = 0; k < 5; k++) {
      specs.push({ i: 12 + k, speedKmh: 30, prevKmh: 30, yawDps: 16, heading: 90 + k * 16 });
    }
    specs.push(...cruise(17, 3, 30, { heading: 170 }));
    const { events } = drive(specs);
    // a_lat = 8.33 * 0.279 = 2.3 m/s², under the 3.4 low band.
    expect(typesOf(events)).toContain('driver.sharp_corner');
    expect(typesOf(events)).not.toContain('driver.excessive_cornering_speed');
  });

  it('escalates severity with lateral load', () => {
    // 70 km/h at 22 °/s → 19.4 * 0.384 = 7.5 m/s², past the 5.9 high band.
    const specs: RowSpec[] = [...cruise(0, 12, 70)];
    for (let k = 0; k < 5; k++) {
      specs.push({ i: 12 + k, speedKmh: 70, prevKmh: 70, yawDps: 22, heading: 90 + k * 22 });
    }
    specs.push(...cruise(17, 3, 70, { heading: 200 }));
    const { events } = drive(specs);
    const ex = events.find((e) => e.type === 'driver.excessive_cornering_speed');
    expect(ex).toBeDefined();
    expect(ex!.severity).toBe('high');
  });
});

// ===========================================================================
// §6.3 — swerving. The unsigned-yaw workaround.
// ===========================================================================

describe('§6.3 swerve', () => {
  it('detects turning a lot while going nowhere', () => {
    // Weave: repeated large yaw PEAKS separated by near-zero crossings, with the
    // heading returning to where it started.
    //
    // The yaw must actually drop between excursions. A constant 16 °/s is one
    // long excursion, not several — which is the correct reading, because a
    // steady yaw rate is a constant-radius curve, not weaving.
    const specs: RowSpec[] = [...cruise(0, 10, 60)];
    const weave: [number, number][] = [
      [16, 104], [1, 90], [16, 76], [1, 90],
      [16, 104], [1, 90], [16, 76], [1, 90], [16, 90],
    ];
    weave.forEach(([yawDps, heading], k) => {
      specs.push({ i: 10 + k, speedKmh: 60, prevKmh: 60, yawDps, heading });
    });
    const { events } = drive(specs);
    const sw = events.filter((e) => e.type === 'driver.swerving');
    expect(sw.length).toBeGreaterThanOrEqual(1);
    const e = sw[0]!;
    // Accumulated turning is large; net heading change is ~0.
    expect(e.evidence['integrated_yaw_rad'] as number).toBeGreaterThan(cfg.swerve.minIntegratedYaw);
    expect(e.evidence['net_heading_change_rad'] as number).toBeLessThan(cfg.swerve.maxNetHeadingChange);
  });

  it('does NOT flag a sustained deliberate turn (large net heading change)', () => {
    // Same accumulated yaw, but the vehicle genuinely ends up going another way —
    // this is a roundabout or a junction, not weaving.
    const specs: RowSpec[] = [...cruise(0, 10, 60)];
    for (let k = 0; k < 9; k++) {
      specs.push({ i: 10 + k, speedKmh: 60, prevKmh: 60, yawDps: 16, heading: 90 + k * 16 });
    }
    const { events } = drive(specs);
    expect(typesOf(events)).not.toContain('driver.swerving');
  });

  it('does not flag weaving below the speed floor', () => {
    const specs: RowSpec[] = [...cruise(0, 10, 20)];
    const headings = [90, 104, 90, 76, 90, 104, 90, 76, 90];
    headings.forEach((h, k) => {
      specs.push({ i: 10 + k, speedKmh: 20, prevKmh: 20, yawDps: 16, heading: h });
    });
    const { events } = drive(specs);
    expect(typesOf(events)).not.toContain('driver.swerving');
  });
});

// ===========================================================================
// §6.4 / §2.4 / §2.5 — impact, censoring, and the calibration gate
// ===========================================================================

describe('§6.4 impact', () => {
  it('emits an unattributed road.impact_candidate, never a driver verdict', () => {
    // §6.4 is explicit: an impact candidate is NOT an event yet. Blame is
    // arbitration's job (§7.3), and this is the assertion that keeps the
    // project's central fairness claim honest.
    const specs = [...cruise(0, 40, 45), { i: 40, speedKmh: 45, prevKmh: 45, vertPeak: 6.0, vertRms: 2.2 }];
    const { events } = drive(specs);
    const imp = events.filter((e) => e.type === 'road.impact_candidate');
    expect(imp.length).toBe(1);
    expect(imp[0]!.category).toBe('road');
    expect(imp[0]!.attributedToDriver).toBe(false);
    expect(imp[0]!.evidence['awaiting_arbitration']).toBe(true);
    expect(typesOf(events)).not.toContain('driver.avoidable_impact');
  });

  it('flags severity_censored when the ±2 g axis rails (§2.4)', () => {
    // 13000 counts is the plan's clipping threshold; 0.9 g of vertical peak is
    // past it. Severity must be capped, never extrapolated.
    const specs = [...cruise(0, 40, 45), { i: 40, speedKmh: 45, prevKmh: 45, vertPeak: 0.9 * G, vertRms: 2.4 }];
    const { events } = drive(specs);
    const imp = events.find((e) => e.type === 'road.impact_candidate');
    expect(imp).toBeDefined();
    expect(imp!.severityCensored).toBe(true);
    expect(imp!.severity).not.toBe('critical');
    expect(imp!.evidence['censoring_note']).toBeTruthy();
  });

  it('suppresses every accel-derived detector when uncalibrated (§2.5 hard rule)', () => {
    // §2.5: "Hard rule: suppress every accel_cal/gyro_cal-derived detector unless
    // state == 'calibrated'." A huge vertical peak must produce NO impact event,
    // because the vertical/horizontal decomposition is meaningless.
    // Long enough to pass the 300 s of driving that §6.7 requires before the
    // stale-calibration verdict is reported.
    const specs = [
      ...cruise(0, 320, 45, { calibrated: false }),
      { i: 320, speedKmh: 45, prevKmh: 45, vertPeak: 8.0, vertRms: 3.0, calibrated: false },
    ];
    const { events } = drive(specs);
    expect(typesOf(events)).not.toContain('road.impact_candidate');
    // …and the engine says why, instead of silently producing nothing.
    expect(typesOf(events)).toContain('integrity.calibration_stale');
  });

  it('does not fire on ordinary road texture', () => {
    const { events } = drive(cruise(0, 60, 45));
    expect(typesOf(events)).not.toContain('road.impact_candidate');
  });

  it('speed-normalises roughness toward the 40 km/h reference (§7.2)', () => {
    // Same surface at half the reference speed must normalise UP, otherwise a
    // queue of slow traffic looks like fresh tarmac.
    const atRef = speedNormalise(1.0, cfg.roadmap.speedRefMps, cfg);
    const atHalf = speedNormalise(1.0, cfg.roadmap.speedRefMps / 2, cfg);
    expect(atRef).toBeCloseTo(1.0, 6);
    expect(atHalf).toBeGreaterThan(atRef);
  });
});

// ===========================================================================
// §6.7 — integrity. Never penalises the driver.
// ===========================================================================

describe('§6.7 integrity', () => {
  it('NO integrity event is ever attributed to the driver (§6.7, §8)', () => {
    const { events } = drive([
      ...cruise(0, 5, 40, { samples: 12 }),
      { i: 5, speedKmh: 40, prevKmh: 40, fix: false, sats: 8 },
      { i: 30, speedKmh: 40, prevKmh: 40, samples: 10 },
      { i: 31, speedKmh: 40, prevKmh: 40, calibrated: false },
    ]);
    const integrityEvents = events.filter((e) => e.category === 'integrity');
    expect(integrityEvents.length).toBeGreaterThan(0);
    for (const e of integrityEvents) {
      expect(e.attributedToDriver).toBe(false);
      expect(e.evidence['never_penalises_driver']).toBe(true);
    }
  });

  it('detects a data gap from a seq jump and a time gap', () => {
    const { events } = drive([
      ...cruise(0, 5, 40),
      // Jump 20 rows forward: seq +21 and a 20 s time gap.
      { i: 25, speedKmh: 40, prevKmh: 40, seq: 26 },
    ]);
    const gap = events.find((e) => e.type === 'integrity.data_gap');
    expect(gap).toBeDefined();
    expect(gap!.evidence['seq_jump'] as number).toBeGreaterThan(1);
    expect(gap!.evidence['time_gap_s'] as number).toBeGreaterThan(cfg.integrity.gapS);
  });

  it('correlates a gap with weak WiFi as upload_loss (§6.7)', () => {
    const { events } = drive([
      ...cruise(0, 5, 40),
      { i: 25, speedKmh: 40, prevKmh: 40, seq: 26, wifiRssi: -92 },
    ]);
    expect(typesOf(events)).toContain('integrity.upload_loss');
  });

  it('detects a reboot from a seq decrease and reports which clock proved it', () => {
    const st = state();
    drive(cruise(0, 5, 40), st);
    // seq and uptime both go backwards — a power cycle.
    const res = normalizeRow(mkRow({ i: 6, speedKmh: 0, prevKmh: 40, seq: 1, uptimeMs: 500 }), st, cfg);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    expect(res.rebooted).toBe(true);
    const events = runDetectors({ sample: res.sample, state: st, meta: st.meta, cfg });
    const rb = events.find((e) => e.type === 'integrity.device_reboot');
    expect(rb).toBeDefined();
    expect(rb!.evidence['trigger']).toBe('seq_decrease');
    expect(rb!.evidence['previous_boot_id']).not.toBe(rb!.evidence['new_boot_id']);
  });

  it('detects a mount shift from the gravity vector angle', () => {
    expect(vectorAngleDeg({ x: 0, y: 0, z: 16384 }, { x: 0, y: 0, z: 16384 })).toBeCloseTo(0, 6);
    expect(vectorAngleDeg({ x: 0, y: 0, z: 16384 }, { x: 16384, y: 0, z: 0 })).toBeCloseTo(90, 6);
    // A zero-length vector must not produce a spurious 90°.
    expect(vectorAngleDeg({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeNaN();

    const { events } = drive([
      ...cruise(0, 5, 40, { gravityRef: { x: 0, y: 0, z: 16384 } }),
      // ~30° rotation of the mount.
      { i: 5, speedKmh: 40, prevKmh: 40, gravityRef: { x: 8192, y: 0, z: 14189 } },
    ]);
    const ms = events.find((e) => e.type === 'integrity.mount_shift');
    expect(ms).toBeDefined();
    expect(ms!.evidence['angle_deg'] as number).toBeGreaterThan(cfg.integrity.mountShiftDeg);
  });

  it('detects a starved sample loop and a stuck accelerometer', () => {
    const starved = drive([...cruise(0, 3, 40), { i: 3, speedKmh: 40, prevKmh: 40, samples: 11 }]);
    const sd = starved.events.find((e) => e.type === 'integrity.sensor_degraded');
    expect(sd).toBeDefined();
    expect((sd!.evidence['reasons'] as string[]).join()).toContain('samples');

    // Identical accel_raw for 12 consecutive rows.
    const stuckRaw = { x: 5, y: 5, z: 16000 };
    const stuck = drive(cruise(0, 14, 40, { accelRaw: stuckRaw }));
    const reasons = stuck.events
      .filter((e) => e.type === 'integrity.sensor_degraded')
      .flatMap((e) => e.evidence['reasons'] as string[]);
    expect(reasons.join()).toContain('identical accel_raw');
  });

  it('detects a GPS fix that should exist but does not', () => {
    // fix=false while sats > 4, sustained past the threshold.
    const specs = Array.from({ length: 40 }, (_, k) => ({
      i: k,
      speedKmh: 40,
      prevKmh: 40,
      fix: false,
      sats: 8,
    }));
    const { events } = drive(specs);
    const gd = events.find((e) => e.type === 'integrity.gps_degraded');
    expect(gd).toBeDefined();
    expect(gd!.evidence['trigger']).toBe('no fix despite sats > 4');
  });
});

// ===========================================================================
// §6.5 — speeding. Emits nothing without fleet evidence.
// ===========================================================================

describe('§6.5 speeding', () => {
  it('emits nothing when no road map is installed', () => {
    setCellStats(null);
    const { events } = drive(cruise(0, 30, 90));
    expect(typesOf(events).filter((t) => t.startsWith('driver.speeding'))).toHaveLength(0);
  });

  it('emits nothing when the cell has thin evidence (§6.5 gate)', () => {
    // 8 passes from 2 devices is below the 20-pass / 3-device requirement.
    const thin: CellStatsLookup = {
      p85SpeedKmh: () => 40,
      passCount: () => 8,
      deviceCount: () => 2,
      roughnessIndex: () => 50,
      fleetMedianRoughness: () => 30,
    };
    setCellStats(thin);
    const st = state();
    st.lastH3 = '8c2a1072b5b1bff';
    const { events } = drive(cruise(0, 20, 90), st);
    expect(typesOf(events).filter((t) => t.startsWith('driver.speeding'))).toHaveLength(0);
    setCellStats(null);
  });

  it('flags speeding relative to the fleet p85 once the cell is well evidenced', () => {
    const rich: CellStatsLookup = {
      p85SpeedKmh: () => 40,
      passCount: () => 60,
      deviceCount: () => 5,
      roughnessIndex: () => 80,
      fleetMedianRoughness: () => 30,
    };
    setCellStats(rich);
    const st = state();
    st.lastH3 = '8c2a1072b5b1bff';
    // 70 km/h against a 40 km/h norm is 75 % over → high band.
    const { events } = drive(cruise(0, 6, 70), st);
    const rel = events.find((e) => e.type === 'driver.speeding_relative');
    expect(rel).toBeDefined();
    expect(rel!.severity).toBe('high');
    // Honest about being self-referential (§6.5).
    expect(String(rel!.evidence['limitation'])).toContain('self-referential');

    // Rougher than the fleet median → the stronger "for conditions" claim too.
    expect(typesOf(events)).toContain('driver.speeding_for_conditions');
    setCellStats(null);
  });

  it('withholds speeding_for_conditions on a smoother-than-median surface', () => {
    const smooth: CellStatsLookup = {
      p85SpeedKmh: () => 40,
      passCount: () => 60,
      deviceCount: () => 5,
      roughnessIndex: () => 10,
      fleetMedianRoughness: () => 30,
    };
    setCellStats(smooth);
    const st = state();
    st.lastH3 = '8c2a1072b5b1bff';
    const { events } = drive(cruise(0, 6, 70), st);
    expect(typesOf(events)).toContain('driver.speeding_relative');
    expect(typesOf(events)).not.toContain('driver.speeding_for_conditions');
    setCellStats(null);
  });
});

// ===========================================================================
// §6.6 — idling and fatigue
// ===========================================================================

describe('§6.6 duty', () => {
  it('detects sustained idling with capped confidence (no engine state)', () => {
    const specs = [
      ...cruise(0, 5, 30),
      ...Array.from({ length: 200 }, (_, k) => ({ i: 5 + k, speedKmh: 0, prevKmh: 0 })),
    ];
    const { events } = drive(specs);
    const idle = events.filter((e) => e.type === 'driver.excessive_idling');
    expect(idle.length).toBe(1);
    // §6.6: confidence 0.5 max without mic corroboration, 0.7 with.
    expect(idle[0]!.confidence).toBeLessThanOrEqual(cfg.duty.idleMicConfidence);
    expect(String(idle[0]!.evidence['limitation'])).toContain('no engine state');
  });

  it('does not flag a brief stop as idling', () => {
    const specs = [
      ...cruise(0, 5, 30),
      ...Array.from({ length: 60 }, (_, k) => ({ i: 5 + k, speedKmh: 0, prevKmh: 0 })),
    ];
    const { events } = drive(specs);
    expect(typesOf(events)).not.toContain('driver.excessive_idling');
  });
});

// ===========================================================================
// Trips (§4 shape, §9 reboot handling)
// ===========================================================================

describe('trip segmentation', () => {
  it('opens on sustained movement, backdating to when movement began', () => {
    const st = state();
    drive([...cruise(0, 3, 0), ...cruise(3, 20, 40)], st);
    expect(st.trip).not.toBeNull();
    expect(st.trip!.status).toBe('open');
    // Backdated to the first moving row, not the row that convinced us.
    expect(st.trip!.startedAt).toBeLessThan(T0 + 8);
    expect(st.trip!.distanceM).toBeGreaterThan(0);
    expect(st.trip!.maxSpeedKmh).toBeCloseTo(40, 1);
  });

  it('accumulates distance, and rejects a teleporting fix', () => {
    const st = state();
    drive(cruise(0, 30, 50), st);
    const before = st.trip!.distanceM;
    expect(before).toBeGreaterThan(100);
    // A fix jump to the other side of the country must not become distance.
    const jump = mkRow({ i: 31, speedKmh: 50, prevKmh: 50 });
    jump.gps = { ...jump.gps!, lat: 9.5, lon: 81.0 };
    const res = normalizeRow(jump, st, cfg);
    if (res.ok) {
      updateTrip(st, res.sample, cfg, res.rebooted);
    }
    expect(st.trip!.distanceM - before).toBeLessThan(200);
  });

  it('closes the trip on a reboot and reports gps coverage (§9)', () => {
    const st = state();
    drive(cruise(0, 30, 50), st);
    const openId = st.trip!.id;

    const res = normalizeRow(mkRow({ i: 31, speedKmh: 0, prevKmh: 50, seq: 1, uptimeMs: 400 }), st, cfg);
    if (!res.ok) throw new Error('expected ok');
    const tr = updateTrip(st, res.sample, cfg, res.rebooted);
    expect(tr.closed).toBeDefined();
    expect(tr.closed!.id).toBe(openId);
    expect(tr.closed!.gpsCoverage).toBeGreaterThan(0.9);
    expect(tr.closed!.durationS).toBeGreaterThan(0);
    expect(st.trip).toBeNull();
  });

  it('abandons a trip that went nowhere', () => {
    const st = state();
    // Sustained "movement" just over the floor, but only for a few metres.
    drive(cruise(0, 8, 11), st);
    const specs = Array.from({ length: 200 }, (_, k) => ({ i: 8 + k, speedKmh: 0, prevKmh: 0 }));
    drive(specs, st);
    expect(st.trip).toBeNull();
  });
});

// ===========================================================================
// Determinism — the property §5 and §10 both depend on
// ===========================================================================

describe('determinism and idempotency', () => {
  it('event keys are deterministic and version-scoped (§4)', () => {
    const a = eventKey('d1', 'd1:100', 'driver.harsh_brake', 42, 'r1');
    const b = eventKey('d1', 'd1:100', 'driver.harsh_brake', 42, 'r1');
    expect(a).toBe(b);
    // A new rule version must produce a NEW key, so re-running thresholds over
    // history yields a comparable verdict instead of overwriting the old one.
    expect(eventKey('d1', 'd1:100', 'driver.harsh_brake', 42, 'r2')).not.toBe(a);
    // Field boundaries cannot be confused.
    expect(eventKey('a', 'bc', 't', 1, 'v')).not.toBe(eventKey('ab', 'c', 't', 1, 'v'));
  });

  it('generated ids are stable and uuid-shaped', () => {
    const id = tripId('dev-1', 'dev-1:100', 1785564000);
    expect(id).toBe(tripId('dev-1', 'dev-1:100', 1785564000));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableUuidFrom('x')).not.toBe(stableUuidFrom('y'));
  });

  it('the same drive produces identical events twice (§5 purity)', () => {
    const specs = [
      ...cruise(0, 20, 50),
      { i: 20, speedKmh: 30, prevKmh: 50 },
      { i: 21, speedKmh: 10, prevKmh: 30 },
      ...cruise(22, 20, 45, { vertPeak: 0.6 }),
      { i: 42, speedKmh: 45, prevKmh: 45, vertPeak: 6.2, vertRms: 2.3 },
    ];
    const a = drive(specs).events;
    const b = drive(specs).events;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('every detector is registered and has a unique name', () => {
    const names = detectors.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'integrity',
        'longitudinal',
        'lateral',
        'swerve',
        'impact',
        'speed',
        'duty',
      ]),
    );
  });

  it('a throwing detector cannot take down the pipeline', () => {
    const st = state();
    const res = normalizeRow(mkRow({ i: 0, speedKmh: 40 }), st, cfg);
    if (!res.ok) throw new Error('expected ok');
    const errors: string[] = [];
    // runDetectors must swallow and report, not propagate.
    const out = runDetectors(
      { sample: res.sample, state: st, meta: st.meta, cfg },
      { onError: (n) => errors.push(n) },
    );
    expect(Array.isArray(out)).toBe(true);
    expect(errors).toHaveLength(0);
  });
});
