/**
 * ENGINE-PLAN §10: "Unit tests worth writing regardless: unit conversion, the
 * timeline resolver (all three tiers plus reboot) …"
 *
 * These are the tests that pin §2 — the physics section — against the plan's own
 * stated numbers. If one of these fails, either the plan is wrong or the engine
 * is, and every threshold in §6 is meaningless until that is resolved.
 */

import { describe, it, expect } from 'vitest';
import { THRESHOLDS, G, DEG2RAD } from '../src/config/thresholds.js';
import { newDeviceState } from '../src/domain/state.js';
import type { DeviceState } from '../src/domain/state.js';
import {
  normalizeRow,
  rawRowSchema,
  countsPerG,
  countsPerDps,
  accelCountsToMps2,
  gyroCountsToDps,
  gyroCountsToRadps,
  resolveScales,
  parseTsSec,
  makeBootId,
  causalSlope,
  plausibilityReason,
  REJECT,
} from '../src/domain/normalize.js';
import { Flags, hasFlag } from '../src/types.js';
import type { DeviceMeta, RawRow, Sample } from '../src/types.js';

const cfg = THRESHOLDS;

const META: DeviceMeta = {
  deviceId: 'esp32-test',
  vehicleId: null,
  driverId: null,
  accelFsG: 2,
  gyroFsDps: 250,
  active: true,
};

function state(meta: Partial<DeviceMeta> = {}): DeviceState {
  // 0 rather than Date.now(): `nowWallMs` only feeds the §9 eviction timer, and
  // a test that reads the clock is a test that can flake.
  return newDeviceState({ ...META, ...meta }, 0);
}

let nextId = 1;

/** A well-formed, plausible row. Every test overrides only what it is about. */
function row(over: Partial<RawRow> = {}): RawRow {
  const base: RawRow = {
    id: nextId++,
    device_id: 'esp32-test',
    ts: '2026-08-09T06:00:00.000Z',
    uptime_ms: 60_000,
    seq: 60,
    samples: 50,
    accel_raw: { x: 100, y: 200, z: 16000 },
    accel_cal: {
      vertical_peak: 4871,
      vertical_rms: 1200,
      horizontal_peak: 2000,
      magnitude_peak: 5200,
    },
    gyro_raw: { x: 1, y: 2, z: 3 },
    gyro_cal: { yaw_rate_peak: 190, pitch_rate_peak: 40, roll_rate_peak: 30 },
    gps: {
      fix: true,
      lat: 6.9271,
      lon: 79.8612,
      alt_m: 8,
      speed_kmh: 40,
      heading: 90,
      sats: 9,
      hdop: 1.2,
    },
    mic: { rms: 300, peak: 900 },
    calibration: { state: 'calibrated', age_ms: 5000, gravity_ref: { x: 0, y: 0, z: 16384 } },
    wifi_rssi: -60,
    server_received_at: '2026-08-09T06:00:00.400Z',
  };
  return { ...base, ...over };
}

function ok(r: ReturnType<typeof normalizeRow>): { sample: Sample; rebooted: boolean } {
  if (!r.ok) throw new Error(`expected ok, got reject: ${r.reason}`);
  return { sample: r.sample, rebooted: r.rebooted };
}

// ===========================================================================
// §2.1 — unit conversion. The load-bearing numbers.
// ===========================================================================

describe('§2.1 unit conversion', () => {
  it('derives 16384 counts/g at ±2 g exactly, from 32768 / fsG', () => {
    expect(countsPerG(2)).toBe(16384);
    // Doubling the range halves the sensitivity — the property that makes
    // firmware ask #2 (widen to ±4 g / ±8 g) a threshold rescale and not a
    // rewrite.
    expect(countsPerG(4)).toBe(8192);
    expect(countsPerG(8)).toBe(4096);
  });

  it('derives 131 counts/(°/s) at ±250 dps (131.072 unrounded — the datasheet prints 3 s.f.)', () => {
    // Exact value; the datasheet's "131" is the same number to 3 s.f.
    expect(countsPerDps(250)).toBe(131.072);
    expect(countsPerDps(500)).toBe(65.536);
    // The plan and the datasheet print "131". The 0.055 % difference is four
    // orders of magnitude below the gyro's noise floor.
    expect(Math.abs(countsPerDps(250) - 131) / 131).toBeLessThan(0.001);
  });

  it("reproduces the plan's own sanity check: vertical_peak 4871 → 0.297 g → 2.92 m/s²", () => {
    // §2.1 verbatim: "vertical_peak: 4871 = 0.297 g = 2.92 m/s²".
    const g = 4871 / countsPerG(2);
    expect(g).toBeCloseTo(0.297, 3);

    const mps2 = accelCountsToMps2(4871, 2);
    expect(mps2).toBeCloseTo(2.92, 2);
    expect(mps2).toBeCloseTo(g * G, 10);
  });

  it("reproduces the plan's own sanity check: yaw_rate_peak 190 → 1.45 °/s", () => {
    // §2.1 verbatim: "yaw_rate_peak: 190 = 1.45 °/s".
    expect(gyroCountsToDps(190, 250)).toBeCloseTo(1.45, 2);
    // And in the SI unit the ring actually stores.
    expect(gyroCountsToRadps(190, 250)).toBeCloseTo(1.45 * DEG2RAD, 4);
  });

  it('carries both sanity-check numbers through normalizeRow end to end', () => {
    const { sample } = ok(normalizeRow(row(), state(), cfg));
    expect(sample.vertPeak).toBeCloseTo(2.92, 2);
    expect(sample.yawRate / DEG2RAD).toBeCloseTo(1.45, 2);
    // The raw counts survive for the §2.4 clipping check and nothing else.
    expect(sample.rawVertPeakCounts).toBe(4871);
    expect(sample.rawMagPeakCounts).toBe(5200);
  });

  it('propagates NaN rather than inventing a zero for an absent block', () => {
    // A missing `accel_cal` is a device that has not calibrated yet, not a
    // perfectly smooth road. Zeroing here would drag the fleet roughness map
    // down (§7.2).
    const { sample } = ok(normalizeRow(row({ accel_cal: null }), state(), cfg));
    expect(sample.vertPeak).toBeNaN();
    expect(sample.vertRms).toBeNaN();
    expect(hasFlag(sample.flags, Flags.ACCEL_VALID)).toBe(false);
  });
});

describe('§2.1 firmware ask #1 — self-describing scale', () => {
  it('prefers the row-reported full-scale over DeviceMeta', () => {
    // The device knows its own configuration; the `devices` table is a
    // hand-maintained guess. Same counts at ±4 g mean twice the acceleration.
    const st = state({ accelFsG: 2, gyroFsDps: 250 });
    const { sample } = ok(
      normalizeRow(row({ accel_fs_g: 4, gyro_fs_dps: 500 }), st, cfg),
    );
    // Anchor on the exact conversion, not the plan's 3-s.f. "2.92" — doubling a
    // rounded figure compounds the rounding past any useful tolerance.
    expect(sample.vertPeak).toBeCloseTo(accelCountsToMps2(4871, 2) * 2, 6);
    expect(sample.yawRate / DEG2RAD).toBeCloseTo(gyroCountsToDps(190, 250) * 2, 6);
  });

  it('falls back to DeviceMeta when the firmware is silent (current firmware)', () => {
    const st = state({ accelFsG: 4, gyroFsDps: 500 });
    const { sample } = ok(normalizeRow(row(), st, cfg));
    expect(sample.vertPeak).toBeCloseTo(accelCountsToMps2(4871, 2) * 2, 6);
  });

  it('rejects a zero or negative reported scale rather than producing Infinity', () => {
    // A `0` here would make every magnitude Infinity and light up every impact
    // detector on the fleet.
    const parsed = rawRowSchema.parse(row({ accel_fs_g: 0, gyro_fs_dps: -250 }));
    const scales = resolveScales(parsed, state());
    expect(scales.accelFsG).toBe(2);
    expect(scales.gyroFsDps).toBe(250);
    expect(scales.selfDescribed).toBe(false);
  });
});

// ===========================================================================
// §2.6 — the timeline resolver, all three tiers
// ===========================================================================

describe('§2.6 timeline resolver', () => {
  it('tier 1 `gps`: prefers `ts` and re-anchors the uptime offset', () => {
    const st = state();
    const { sample } = ok(normalizeRow(row(), st, cfg));
    expect(sample.timeQuality).toBe('gps');
    expect(sample.tSec).toBe(Date.parse('2026-08-09T06:00:00.000Z') / 1000);
    expect(st.anchorTSec).toBe(sample.tSec);
    expect(st.anchorUptimeMs).toBe(60_000);
  });

  it('tier 2 `anchored`: carries the GPS timeline forward through a fix loss', () => {
    const st = state();
    ok(normalizeRow(row({ ts: '2026-08-09T06:00:00.000Z', uptime_ms: 60_000, seq: 60 }), st, cfg));

    // Tunnel: no `ts`, no fix, but uptime is still monotonic.
    const { sample } = ok(
      normalizeRow(
        row({ ts: null, uptime_ms: 63_000, seq: 63, gps: { fix: false } }),
        st,
        cfg,
      ),
    );
    expect(sample.timeQuality).toBe('anchored');
    expect(sample.tSec).toBe(Date.parse('2026-08-09T06:00:03.000Z') / 1000);
  });

  it('tier 2 does not drift: every fix re-zeroes the anchor against GPS UTC', () => {
    const st = state();
    ok(normalizeRow(row({ ts: '2026-08-09T06:00:00.000Z', uptime_ms: 60_000 }), st, cfg));
    // A later fix whose uptime has drifted 40 ms against UTC.
    ok(normalizeRow(row({ ts: '2026-08-09T06:00:10.000Z', uptime_ms: 70_040 }), st, cfg));
    expect(st.anchorUptimeMs).toBe(70_040);

    const { sample } = ok(
      normalizeRow(row({ ts: null, uptime_ms: 71_040, gps: { fix: false } }), st, cfg),
    );
    // Anchored off the *newest* fix, so the tunnel entry shows no discontinuity
    // that §6.7's data-gap rule would misread.
    expect(sample.tSec).toBe(Date.parse('2026-08-09T06:00:11.000Z') / 1000);
  });

  it('tier 3 `server`: cold start with no fix ever seen', () => {
    const st = state();
    const { sample } = ok(
      normalizeRow(
        row({
          ts: null,
          gps: { fix: false },
          server_received_at: '2026-08-09T06:00:00.400Z',
        }),
        st,
        cfg,
      ),
    );
    expect(sample.timeQuality).toBe('server');
    expect(sample.tSec).toBe(Date.parse('2026-08-09T06:00:00.400Z') / 1000);
  });

  it('rejects the row when all three clocks fail rather than inventing a time', () => {
    // `Sample.tSec` is contractually never NaN; everything keyed on time
    // downstream would be poisoned.
    const r = normalizeRow(
      row({ ts: null, gps: { fix: false }, server_received_at: 'not-a-date' }),
      state(),
      cfg,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(REJECT.TIME);
  });

  it("parses Postgres's space-separated timestamptz form identically to ISO-8601", () => {
    // Replay must not depend on the V8 version's date-parsing leniency.
    expect(parseTsSec('2026-08-09 06:00:00+00')).toBe(parseTsSec('2026-08-09T06:00:00Z'));
    expect(parseTsSec('2026-08-09 06:00:00.500+00:00')).toBe(
      parseTsSec('2026-08-09T06:00:00.500Z'),
    );
    // A naive timestamp is UTC, not container-local.
    expect(parseTsSec('2026-08-09T06:00:00')).toBe(parseTsSec('2026-08-09T06:00:00Z'));
    expect(parseTsSec(null)).toBeNaN();
    expect(parseTsSec('')).toBeNaN();
  });
});

// ===========================================================================
// §2.6 — reboot detection
// ===========================================================================

describe('§2.6 reboot detection', () => {
  it('the very first row of a device is not a reboot', () => {
    // Otherwise every engine restart emits `integrity.device_reboot` for the
    // whole fleet.
    const { rebooted, sample } = ok(normalizeRow(row(), state(), cfg));
    expect(rebooted).toBe(false);
    expect(sample.bootId).toBe('esp32-test:60000');
  });

  it('detects a reboot when `seq` decreases', () => {
    const st = state();
    ok(normalizeRow(row({ seq: 500, uptime_ms: 500_000 }), st, cfg));
    const r = ok(normalizeRow(row({ seq: 2, uptime_ms: 2_000 }), st, cfg));
    expect(r.rebooted).toBe(true);
    expect(r.sample.bootId).toBe('esp32-test:2000');
  });

  it('detects a reboot when `uptime_ms` decreases even if `seq` does not', () => {
    // A device whose seq counter is not reset by its own restart path.
    const st = state();
    ok(normalizeRow(row({ seq: 500, uptime_ms: 500_000 }), st, cfg));
    const r = ok(normalizeRow(row({ seq: 501, uptime_ms: 1_000 }), st, cfg));
    expect(r.rebooted).toBe(true);
    expect(r.sample.bootId).toBe('esp32-test:1000');
  });

  it('flushes per-boot state and keeps learned baselines (flushOnReboot contract)', () => {
    const st = state();
    ok(normalizeRow(row({ seq: 500, uptime_ms: 500_000 }), st, cfg));
    ok(normalizeRow(row({ seq: 501, uptime_ms: 501_000 }), st, cfg));
    expect(st.ring.size).toBe(2);

    st.vertBaseline = 1.234; // pretend the impact detector has learned something

    ok(normalizeRow(row({ seq: 1, uptime_ms: 1_000 }), st, cfg));
    // The ring was cleared, then the post-reboot row was pushed.
    expect(st.ring.size).toBe(1);
    // The physical vehicle and its mount are unchanged by a firmware restart.
    expect(st.vertBaseline).toBe(1.234);
  });

  it('bootId is deterministic and stable across replays', () => {
    // `${device_id}:${uptimeAnchorMs}` — a pure function of bytes already in the
    // capture file. No clock, no counter, no UUID, so the same JSONL produces
    // the same boot_id and therefore the same event_key (§4 idempotency).
    expect(makeBootId('esp32-test', 60_000)).toBe('esp32-test:60000');
    expect(makeBootId('esp32-test', 60_000.7)).toBe('esp32-test:60000');

    const a = state();
    const b = state();
    const rows = [row({ seq: 1, uptime_ms: 1000 }), row({ seq: 2, uptime_ms: 2000 })];
    const bootA = rows.map((x) => ok(normalizeRow(x, a, cfg)).sample.bootId);
    const bootB = rows.map((x) => ok(normalizeRow(x, b, cfg)).sample.bootId);
    expect(bootA).toEqual(bootB);
  });

  it('a reboot resets the time anchor, so the new boot re-resolves from scratch', () => {
    const st = state();
    ok(normalizeRow(row({ ts: '2026-08-09T06:00:00Z', seq: 500, uptime_ms: 500_000 }), st, cfg));
    // Post-reboot row with no fix yet: uptime is meaningless against the old
    // anchor, so it must fall to tier 3 rather than compute a time in 1987.
    const r = ok(
      normalizeRow(
        row({ ts: null, seq: 1, uptime_ms: 1_000, gps: { fix: false } }),
        st,
        cfg,
      ),
    );
    expect(r.rebooted).toBe(true);
    expect(r.sample.timeQuality).toBe('server');
  });
});

// ===========================================================================
// §2.5 — the calibration hard rule
// ===========================================================================

describe('§2.5 calibration gates everything', () => {
  for (const badState of ['calibrating', 'uncalibrated', 'default', 'whatever']) {
    it(`clears ACCEL_VALID/GYRO_VALID when state is '${badState}'`, () => {
      const { sample } = ok(
        normalizeRow(
          row({ calibration: { state: badState, age_ms: 1000, gravity_ref: null } }),
          state(),
          cfg,
        ),
      );
      expect(hasFlag(sample.flags, Flags.CALIBRATED)).toBe(false);
      expect(hasFlag(sample.flags, Flags.ACCEL_VALID)).toBe(false);
      expect(hasFlag(sample.flags, Flags.GYRO_VALID)).toBe(false);
    });
  }

  it('FLAGS the values invalid — it does not zero them', () => {
    // The distinction is the whole point. A zeroed vertPeak is indistinguishable
    // from a genuinely smooth road and would quietly lower the cell's roughness
    // statistics (§7.2); a flagged one is visibly untrustworthy and is still
    // available as evidence.
    const { sample } = ok(
      normalizeRow(row({ calibration: { state: 'calibrating' } }), state(), cfg),
    );
    expect(hasFlag(sample.flags, Flags.ACCEL_VALID)).toBe(false);
    expect(sample.vertPeak).toBeCloseTo(2.92, 2);
    expect(sample.yawRate).toBeGreaterThan(0);
    expect(sample.calibrationState).toBe('calibrating');
  });

  it('GPS-only signals stay live while calibration is stale', () => {
    // §2.5: "GPS-only detectors (speeding, idling, trip shape) stay live."
    const { sample } = ok(
      normalizeRow(row({ calibration: { state: 'uncalibrated' } }), state(), cfg),
    );
    expect(hasFlag(sample.flags, Flags.GPS_FIX)).toBe(true);
    expect(hasFlag(sample.flags, Flags.GPS_USABLE)).toBe(true);
    expect(sample.speed).toBeCloseTo(40 / 3.6, 6);
  });

  it('a missing calibration block defaults to uncalibrated, not calibrated', () => {
    const { sample } = ok(normalizeRow(row({ calibration: null }), state(), cfg));
    expect(sample.calibrationState).toBe('uncalibrated');
    expect(hasFlag(sample.flags, Flags.ACCEL_VALID)).toBe(false);
  });
});

// ===========================================================================
// Flags
// ===========================================================================

describe('flags', () => {
  it('GPS_USABLE requires fix && sats >= minSats && hdop <= maxHdop', () => {
    const cases: [Partial<RawRow['gps']>, boolean][] = [
      [{ fix: true, sats: 9, hdop: 1.2 }, true],
      [{ fix: true, sats: 5, hdop: 2.5 }, true], // exactly at both bounds
      [{ fix: true, sats: 4, hdop: 1.0 }, false],
      [{ fix: true, sats: 9, hdop: 2.6 }, false],
      [{ fix: false, sats: 9, hdop: 1.0 }, false],
      // No hdop reported is no quality claim, and an unsupported claim must
      // fail the gate — otherwise every hdop-less row is silently promoted.
      [{ fix: true, sats: 9 }, false],
    ];
    for (const [gps, expected] of cases) {
      const { sample } = ok(
        normalizeRow(row({ gps: { ...gps, speed_kmh: 40, lat: 6.9, lon: 79.9 } }), state(), cfg),
      );
      expect(hasFlag(sample.flags, Flags.GPS_USABLE), JSON.stringify(gps)).toBe(expected);
    }
  });

  it('CLIPPED fires above cfg.impact.clipCounts on the RAW counts (§2.4)', () => {
    // The rail is a property of the ADC, not of the SI value, which is why the
    // threshold is expressed in counts and checked before conversion.
    const under = ok(
      normalizeRow(row({ accel_cal: { vertical_peak: 12_999, magnitude_peak: 100 } }), state(), cfg),
    );
    expect(hasFlag(under.sample.flags, Flags.CLIPPED)).toBe(false);

    const overVert = ok(
      normalizeRow(row({ accel_cal: { vertical_peak: 13_001, magnitude_peak: 100 } }), state(), cfg),
    );
    expect(hasFlag(overVert.sample.flags, Flags.CLIPPED)).toBe(true);

    const overMag = ok(
      normalizeRow(row({ accel_cal: { vertical_peak: 100, magnitude_peak: 16_000 } }), state(), cfg),
    );
    expect(hasFlag(overMag.sample.flags, Flags.CLIPPED)).toBe(true);

    // The axis rails in both directions.
    const negative = ok(
      normalizeRow(row({ accel_cal: { vertical_peak: -16_000 } }), state(), cfg),
    );
    expect(hasFlag(negative.sample.flags, Flags.CLIPPED)).toBe(true);
  });

  it('MOVING follows the idle-speed threshold and requires a fix', () => {
    const moving = ok(
      normalizeRow(row({ gps: { fix: true, sats: 9, hdop: 1, speed_kmh: 40 } }), state(), cfg),
    );
    expect(hasFlag(moving.sample.flags, Flags.MOVING)).toBe(true);

    const parked = ok(
      normalizeRow(row({ gps: { fix: true, sats: 9, hdop: 1, speed_kmh: 1 } }), state(), cfg),
    );
    expect(hasFlag(parked.sample.flags, Flags.MOVING)).toBe(false);

    const noFix = ok(normalizeRow(row({ gps: { fix: false, speed_kmh: 40 } }), state(), cfg));
    expect(hasFlag(noFix.sample.flags, Flags.MOVING)).toBe(false);
    // §2.6 contract: speed is 0 without a fix.
    expect(noFix.sample.speed).toBe(0);
  });

  it('MIC_VALID rejects a read outside the 12-bit ADC range (§2.1)', () => {
    const good = ok(normalizeRow(row({ mic: { rms: 300, peak: 900 } }), state(), cfg));
    expect(hasFlag(good.sample.flags, Flags.MIC_VALID)).toBe(true);

    const broken = ok(normalizeRow(row({ mic: { rms: 300, peak: 99_999 } }), state(), cfg));
    expect(hasFlag(broken.sample.flags, Flags.MIC_VALID)).toBe(false);

    const absent = ok(normalizeRow(row({ mic: null }), state(), cfg));
    expect(hasFlag(absent.sample.flags, Flags.MIC_VALID)).toBe(false);
  });
});

// ===========================================================================
// §2.2 — aLong
// ===========================================================================

describe('§2.2 longitudinal acceleration', () => {
  /** A run of rows one second apart at the given speeds (km/h). */
  function drive(speeds: number[], st: DeviceState): Sample[] {
    const out: Sample[] = [];
    speeds.forEach((kmh, i) => {
      const t = new Date(Date.parse('2026-08-09T06:00:00Z') + i * 1000).toISOString();
      const r = normalizeRow(
        row({
          ts: t,
          seq: 100 + i,
          uptime_ms: 100_000 + i * 1000,
          gps: { fix: true, sats: 9, hdop: 1.0, speed_kmh: kmh, lat: 6.92, lon: 79.86, heading: 90 },
        }),
        st,
        cfg,
      );
      out.push(ok(r).sample);
    });
    return out;
  }

  it('is NaN on the first sample — a derivative needs two points', () => {
    const s = drive([40], state());
    expect(s[0]!.aLong).toBeNaN();
  });

  it('gives the signed slope of GPS speed, in m/s²', () => {
    // A 14.4 km/h drop in one second = 4 m/s², §2.2's own harsh-brake example.
    const s = drive([50, 35.6], state());
    expect(s[1]!.aLong).toBeCloseTo(-4.0, 6);

    const a = drive([20, 30], state());
    expect(a[1]!.aLong).toBeCloseTo(10 / 3.6, 6);
  });

  it('the causal 3-point slope equals the plan\'s centred difference, reported one sample late', () => {
    // For evenly spaced samples the N=3 least-squares slope is exactly
    // (v[0] - v[2]) / (t[0] - t[2]) — the same central difference §6.1 asks for.
    // We attribute it to the newest sample instead of the middle one, which is
    // the documented (N-1)/2 = 1 s group delay.
    const s = drive([36, 43.2, 50.4], state());
    const expected = (50.4 / 3.6 - 36 / 3.6) / 2;
    expect(s[2]!.aLong).toBeCloseTo(expected, 6);
    expect(causalSlope([
      { t: 2, v: 50.4 / 3.6 },
      { t: 1, v: 43.2 / 3.6 },
      { t: 0, v: 36 / 3.6 },
    ])).toBeCloseTo(expected, 6);
  });

  it('is NaN when GPS is not usable — §2.2\'s noise budget only holds behind the gate', () => {
    const st = state();
    drive([40, 45], st);
    const r = ok(
      normalizeRow(
        row({
          ts: '2026-08-09T06:00:02Z',
          seq: 200,
          uptime_ms: 200_000,
          gps: { fix: true, sats: 3, hdop: 6, speed_kmh: 50 },
        }),
        st,
        cfg,
      ),
    );
    expect(r.sample.aLong).toBeNaN();
  });

  it('does not fit across a data gap', () => {
    // Averaging two unrelated driving states 30 s apart is not an acceleration.
    const st = state();
    drive([40], st);
    const r = ok(
      normalizeRow(
        row({
          ts: '2026-08-09T06:00:30Z',
          seq: 130,
          uptime_ms: 130_000,
          gps: { fix: true, sats: 9, hdop: 1, speed_kmh: 5 },
        }),
        st,
        cfg,
      ),
    );
    expect(r.sample.aLong).toBeNaN();
  });

  it('does not fit across a reboot', () => {
    const st = state();
    drive([40, 45, 50], st);
    const r = ok(
      normalizeRow(
        row({
          ts: '2026-08-09T06:00:10Z',
          seq: 1,
          uptime_ms: 1_000,
          gps: { fix: true, sats: 9, hdop: 1, speed_kmh: 0 },
        }),
        st,
        cfg,
      ),
    );
    expect(r.rebooted).toBe(true);
    // The ring was flushed, so there is no history to fit against.
    expect(r.sample.aLong).toBeNaN();
  });

  it('causalSlope returns NaN when every sample shares a timestamp', () => {
    // 1 s `ts` granularity can do this when the device posts twice in a second.
    expect(causalSlope([{ t: 5, v: 1 }, { t: 5, v: 2 }])).toBeNaN();
    expect(causalSlope([{ t: 5, v: 1 }])).toBeNaN();
  });
});

// ===========================================================================
// §3 — the plausibility gate
// ===========================================================================

describe('§3 plausibility gate', () => {
  it('rejects speed above cfg.plausibility.maxSpeedKmh', () => {
    const r = normalizeRow(row({ gps: { fix: true, sats: 9, hdop: 1, speed_kmh: 251 } }), state(), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(REJECT.SPEED);
  });

  it('accepts exactly at the limit', () => {
    const r = normalizeRow(row({ gps: { fix: true, sats: 9, hdop: 1, speed_kmh: 250 } }), state(), cfg);
    expect(r.ok).toBe(true);
  });

  it('rejects negative speed', () => {
    const r = normalizeRow(row({ gps: { fix: true, speed_kmh: -1 } }), state(), cfg);
    expect(r.ok).toBe(false);
  });

  it('rejects positions outside the operating bounding box', () => {
    for (const [lat, lon] of [[0, 0], [51.5, -0.12], [6.9, 100], [-6.9, 79.9]] as const) {
      const r = normalizeRow(row({ gps: { fix: true, sats: 9, hdop: 1, lat, lon } }), state(), cfg);
      expect(r.ok, `${lat},${lon}`).toBe(false);
      if (!r.ok) expect(r.reason).toContain(REJECT.BBOX);
    }
  });

  it('does not treat a missing position as out of bounds', () => {
    // A row with no fix is normal, not hostile.
    const r = normalizeRow(row({ gps: { fix: false } }), state(), cfg);
    expect(r.ok).toBe(true);
  });

  it('rejects samples above cfg.plausibility.maxSamples', () => {
    const r = normalizeRow(row({ samples: 61 }), state(), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(REJECT.SAMPLES);
    // 61 > 60, but a *low* count is a degraded sensor (§6.7), not a poisoned
    // row, and must reach the integrity detector rather than be dropped.
    expect(normalizeRow(row({ samples: 12 }), state(), cfg).ok).toBe(true);
  });

  it('rejects a row routed to the wrong device', () => {
    const r = normalizeRow(row({ device_id: 'someone-else' }), state(), cfg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(REJECT.DEVICE_MISMATCH);
  });

  it('leaves device state untouched when a row is rejected', () => {
    // A burst of poisoned rows must not be able to drag the device's own
    // timeline anchor along with it.
    const st = state();
    ok(normalizeRow(row({ seq: 10, uptime_ms: 10_000 }), st, cfg));
    const before = {
      lastSeq: st.lastSeq,
      lastUptimeMs: st.lastUptimeMs,
      anchorTSec: st.anchorTSec,
      ringSize: st.ring.size,
    };
    const r = normalizeRow(
      row({ seq: 11, uptime_ms: 11_000, gps: { fix: true, speed_kmh: 900 } }),
      st,
      cfg,
    );
    expect(r.ok).toBe(false);
    expect(st.lastSeq).toBe(before.lastSeq);
    expect(st.lastUptimeMs).toBe(before.lastUptimeMs);
    expect(st.anchorTSec).toBe(before.anchorTSec);
    expect(st.ring.size).toBe(before.ringSize);
  });

  it('plausibilityReason is pure and returns null for a good row', () => {
    expect(plausibilityReason(rawRowSchema.parse(row()), cfg)).toBeNull();
  });
});

// ===========================================================================
// zod schema leniency (§5: "device JSON is partial by design")
// ===========================================================================

describe('rawRowSchema', () => {
  it('accepts a row with every optional block absent', () => {
    const minimal = {
      id: 1,
      device_id: 'esp32-test',
      ts: null,
      uptime_ms: 1000,
      seq: 1,
      server_received_at: '2026-08-09T06:00:00Z',
    };
    expect(rawRowSchema.safeParse(minimal).success).toBe(true);
    const r = normalizeRow(minimal as RawRow, state(), cfg);
    expect(r.ok).toBe(true);
  });

  it('accepts gps without lat/lon — the no-fix case the plan calls out', () => {
    const parsed = rawRowSchema.safeParse({
      id: 1,
      device_id: 'esp32-test',
      ts: null,
      uptime_ms: 1000,
      seq: 1,
      gps: { fix: false, sats: 0, hdop: 99.9 },
      server_received_at: '2026-08-09T06:00:00Z',
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts postgres.js's Date and bigint-as-string shapes", () => {
    const parsed = rawRowSchema.safeParse({
      id: '4815162342',
      device_id: 'esp32-test',
      ts: new Date('2026-08-09T06:00:00Z'),
      uptime_ms: '60000',
      seq: '60',
      server_received_at: new Date('2026-08-09T06:00:00.4Z'),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.id).toBe(4815162342);
      expect(parsed.data.ts).toBe('2026-08-09T06:00:00.000Z');
    }
  });

  it('coerces junk in a numeric slot to undefined rather than throwing', () => {
    // One bad key must not cost us the other fifteen good ones on the row.
    const parsed = rawRowSchema.safeParse({
      id: 1,
      device_id: 'esp32-test',
      ts: null,
      uptime_ms: 1000,
      seq: 1,
      gps: { fix: true, speed_kmh: 'fast', sats: 9, hdop: 1.0, lat: 6.9, lon: 79.9 },
      server_received_at: '2026-08-09T06:00:00Z',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.gps?.speed_kmh).toBeUndefined();
  });

  it('passes unknown keys through, so firmware asks are not silently stripped', () => {
    const parsed = rawRowSchema.parse({
      id: 1,
      device_id: 'esp32-test',
      ts: null,
      uptime_ms: 1000,
      seq: 1,
      server_received_at: '2026-08-09T06:00:00Z',
      some_future_field: 42,
    });
    expect((parsed as Record<string, unknown>)['some_future_field']).toBe(42);
  });

  it('rejects a row with no id / seq / uptime_ms', () => {
    // Without `id` a row cannot be deduped or cited as evidence; without
    // seq/uptime_ms boot identity and ordering are both undefined.
    const r = normalizeRow(
      { device_id: 'esp32-test', server_received_at: '2026-08-09T06:00:00Z' } as unknown as RawRow,
      state(),
      cfg,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(REJECT.SCHEMA);
  });
});

// ===========================================================================
// Ring integration + determinism
// ===========================================================================

describe('normalizeRow / ring contract', () => {
  it('pushes the sample so ring offset 0 IS the returned sample', () => {
    const st = state();
    const { sample } = ok(normalizeRow(row(), st, cfg));
    expect(st.ring.size).toBe(1);
    expect(st.ring.telemetryIdAt(0)).toBe(sample.telemetryId);
    expect(st.ring.speedAt(0)).toBe(sample.speed);
    expect(st.ring.flagsAt(0)).toBe(sample.flags);
  });

  it('is deterministic: the same input twice produces identical samples', () => {
    // The Phase 1 gate (§11): "losslessly replay a recorded drive with
    // byte-identical intermediate state".
    const rows = [
      row({ seq: 1, uptime_ms: 1000, ts: '2026-08-09T06:00:00Z' }),
      row({ seq: 2, uptime_ms: 2000, ts: '2026-08-09T06:00:01Z' }),
      row({ seq: 3, uptime_ms: 3000, ts: null, gps: { fix: false } }),
      row({ seq: 1, uptime_ms: 500, ts: '2026-08-09T06:00:03Z' }), // reboot
    ];
    const runA = rows.map((r) => normalizeRow(r, state(), cfg));
    const stA = state();
    const stB = state();
    const seqA = rows.map((r) => JSON.stringify(normalizeRow(r, stA, cfg)));
    const seqB = rows.map((r) => JSON.stringify(normalizeRow(r, stB, cfg)));
    expect(seqA).toEqual(seqB);
    expect(runA.length).toBe(4);
  });
});

// ===========================================================================
// Hardware MCU Payload Compatibility
// ===========================================================================

describe('MCU payload compatibility', () => {
  it('parses calibration.gravity_ref sent as an array [0, 0, 16384] by ESP32 MCU', () => {
    const mcuRow = row({
      calibration: {
        state: 'calibrated',
        age_ms: 1200,
        gravity_ref: [0, 0, 16384] as unknown as { x: number; y: number; z: number },
      },
    });
    const { sample } = ok(normalizeRow(mcuRow, state(), cfg));
    expect(sample.gravityRef).toEqual({ x: 0, y: 0, z: 16384 });
  });

  it('accepts gps.altitude key from ESP32 MCU', () => {
    const mcuRow = row({
      gps: {
        fix: true,
        lat: 6.9271,
        lon: 79.8612,
        altitude: 12,
        speed_kmh: 30,
        heading: 180,
        sats: 8,
        hdop: 1.1,
      },
    });
    const parsed = rawRowSchema.safeParse(mcuRow);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.gps?.altitude).toBe(12);
    }
  });
});

