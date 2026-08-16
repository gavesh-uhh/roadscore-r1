/**
 * The normalizer: raw MPU6050 counts and three broken clocks in, one SI
 * `Sample` on a single resolved timeline out.
 *
 * ENGINE-PLAN §2 in code. Everything downstream — every detector, every
 * threshold, every event magnitude — is only as correct as this file. Raw counts
 * exist above this boundary and must not exist below it.
 *
 * Four jobs, in this order:
 *
 *   1. Validate (zod, leniently — the device omits `gps.lat` when it has no fix,
 *      so "partial" is the normal case, not an error).
 *   2. Reject implausible rows (§3 routing change #5 — `anon` can insert
 *      anything, and a poisoned row does not just corrupt one driver's history,
 *      it shifts the fleet consensus on a shared H3 cell and changes the
 *      driver-vs-road verdict for everyone who crosses it).
 *   3. Resolve boot identity and time (§2.6).
 *   4. Convert counts → SI, derive `aLong`, and set the flags that tell
 *      detectors what they are allowed to believe (§2.5).
 *
 * PURITY: this function reads no clock, no network and no randomness. The only
 * wall-clock value it ever sees is `server_received_at`, which arrives *inside*
 * the row. That is what makes §10's replay harness able to reproduce byte-
 * identical intermediate state from a JSONL file.
 *
 * SIDE EFFECT — read this before wiring the pipeline:
 * `normalizeRow` is the SOLE WRITER of `state.ring`. On success it has already
 * pushed the returned `Sample`, so `state.ring` offset 0 *is* that sample and
 * `DetectorContext.sample === ring[0]` holds without the caller doing anything.
 * Do not push again. It also owns the scalar bookkeeping it needs to do its own
 * job across rows: `bootId`, `lastSeq`, `lastUptimeMs`, `anchorTSec`,
 * `anchorUptimeMs`, `lastTimeQuality`. Every other field of `DeviceState`
 * belongs to trips, detectors or arbitration and is not touched here.
 */

import { z } from 'zod';
import type { Thresholds } from '../config/thresholds.js';
import { DEG2RAD, G } from '../config/thresholds.js';
import type { CalibrationState, RawRow, RawVec3, Sample, TimeQuality } from '../types.js';
import { Flags } from '../types.js';
import type { DeviceState } from './state.js';
import { flushOnReboot } from './state.js';

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export type NormalizeResult =
  | {
      ok: true;
      /** Already pushed onto `state.ring` at offset 0. */
      sample: Sample;
      /**
       * The device rebooted at this row. The caller must emit
       * `integrity.device_reboot` and close the open trip (§6.7, §9) — state has
       * already been flushed here, so the trip object is the caller's last
       * chance to see the pre-reboot ring.
       */
      rebooted: boolean;
    }
  | { ok: false; reason: string };

/** Stable, greppable rejection reasons. One string per gate. */
export const REJECT = {
  SCHEMA: 'schema_invalid',
  DEVICE_MISMATCH: 'device_id_mismatch',
  SPEED: 'implausible_speed',
  BBOX: 'position_outside_operating_bbox',
  SAMPLES: 'implausible_sample_count',
  TIME: 'unresolvable_time',
} as const;

// ---------------------------------------------------------------------------
// zod schema (§5: "device JSON is partial by design")
// ---------------------------------------------------------------------------
//
// Lenient on purpose. Three separate realities have to survive this schema:
//
//   * The firmware omits whole blocks. `gps.lat` is absent with no fix,
//     `accel_cal` is absent before the first calibration completes. A strict
//     schema here would reject the majority of a cold-start drive.
//   * postgres.js returns `bigint` columns as strings (to avoid the silent
//     precision loss of Number) and `timestamptz` columns as `Date` objects.
//     Both must land in the same shape as a JSONL capture, which round-trips
//     everything through JSON and therefore has strings for both.
//   * A jsonb blob is whatever was inserted. Non-numeric junk in a numeric slot
//     is coerced to `undefined` rather than throwing, so one bad key never
//     costs us the other fifteen good ones on the row. The plausibility gate
//     below, not the schema, is what rejects rows.
//
// Unknown keys pass through untouched (`.passthrough()`): firmware asks #1, #4
// and #6 add fields, and a schema that strips them would silently discard the
// self-describing scale the moment the firmware starts sending it.

/** A number, a numeric string, or nothing. Junk becomes `undefined`, never a throw. */
const num = z
  .preprocess((v) => {
    if (v === null || v === undefined || v === '') return undefined;
    if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  }, z.number().optional())
  .optional();

/** `true`/`false`, or Postgres's `'t'`/`'f'`/`'true'`/`'1'` text forms. */
const bool = z
  .preprocess((v) => {
    if (v === null || v === undefined || v === '') return undefined;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (['t', 'true', '1', 'yes'].includes(s)) return true;
      if (['f', 'false', '0', 'no'].includes(s)) return false;
    }
    return undefined;
  }, z.boolean().optional())
  .optional();

/** A `Date` (postgres.js) or an ISO string (JSONL) → ISO string. */
const timestamp = z
  .preprocess((v) => {
    if (v === null || v === undefined || v === '') return undefined;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
    if (typeof v === 'string') return v;
    return undefined;
  }, z.string().optional())
  .optional();

const vec3Schema = z
  .union([
    z.object({ x: num, y: num, z: num }).passthrough(),
    z.tuple([num, num, num]).transform(([x, y, z]) => ({ x, y, z })),
  ])
  .optional()
  .nullable();

export const rawRowSchema = z
  .object({
    // `id` is the dedupe key for both ingest paths and the audit trail on every
    // event (`telemetry_ids`). It is the one field with no sensible default.
    id: num,
    device_id: z.string().min(1),
    ts: timestamp.nullable(),
    uptime_ms: num,
    seq: num,
    samples: num.nullable(),

    accel_raw: vec3Schema,
    accel_cal: z
      .object({
        vertical_peak: num.nullable(),
        vertical_rms: num.nullable(),
        horizontal_peak: num.nullable(),
        magnitude_peak: num.nullable(),
      })
      .passthrough()
      .optional()
      .nullable(),

    gyro_raw: vec3Schema,
    gyro_cal: z
      .object({
        yaw_rate_peak: num.nullable(),
        pitch_rate_peak: num.nullable(),
        roll_rate_peak: num.nullable(),
      })
      .passthrough()
      .optional()
      .nullable(),

    gps: z
      .object({
        fix: bool.nullable(),
        lat: num.nullable(),
        lon: num.nullable(),
        alt_m: num.nullable(),
        altitude: num.nullable(),
        speed_kmh: num.nullable(),
        heading: num.nullable(),
        sats: num.nullable(),
        hdop: num.nullable(),
      })
      .passthrough()
      .optional()
      .nullable(),

    mic: z
      .object({ rms: num.nullable(), peak: num.nullable() })
      .passthrough()
      .optional()
      .nullable(),

    calibration: z
      .object({
        state: z.string().optional().nullable(),
        age_ms: num.nullable(),
        gravity_ref: vec3Schema,
      })
      .passthrough()
      .optional()
      .nullable(),

    wifi_rssi: num.nullable(),

    // Firmware ask #1. Absent on current firmware; when present it WINS over
    // the `devices` table, because the device knows its own configuration and
    // the table is a human-maintained guess.
    accel_fs_g: num.nullable(),
    gyro_fs_dps: num.nullable(),

    // Firmware asks #4 / #6.
    fw_version: z.string().optional().nullable(),
    dropped_posts: num.nullable(),

    server_received_at: timestamp,
  })
  .passthrough();

export type ParsedRawRow = z.infer<typeof rawRowSchema>;

// ---------------------------------------------------------------------------
// §2.1 Unit conversion
// ---------------------------------------------------------------------------
//
// DERIVATION. The MPU6050 reports each axis as a signed 16-bit integer. A signed
// 16-bit word spans [-32768, +32767], and the part maps the *negative* rail
// (-32768) onto -FS and the positive rail onto just under +FS. So the scale is
//
//     counts_per_unit = 2^15 / full_scale = 32768 / FS
//
// Check it against the two numbers ENGINE-PLAN §2.1 states outright:
//
//     accel, FS = ±2 g     → 32768 / 2   = 16384       counts/g      EXACT
//     gyro,  FS = ±250 °/s → 32768 / 250 = 131.072     counts/(°/s)
//
// The accelerometer figure reproduces the plan (and the datasheet) exactly. The
// gyro figure is 131.072 where both the plan and the InvenSense datasheet print
// "131" — the datasheet rounds to three significant figures, and 131.072 is the
// unrounded truth. The difference is 0.055 %, i.e. ~0.0008 °/s on the plan's own
// sanity-check value, which is four orders of magnitude below the sensor's noise
// floor and invisible at any threshold in §6. We use the derived value rather
// than the printed one because it is what the hardware actually does, and
// because it is the form that stays correct when firmware ask #2 widens the
// range to ±4 g or ±500 °/s.
//
// Sanity check against the README row quoted in §2.1:
//     vertical_peak 4871 counts / 16384 = 0.29730 g × 9.80665 = 2.9153 m/s²  ✓ (plan: 0.297 g, 2.92)
//     yaw_rate_peak 190  counts / 131.072 = 1.4496 °/s                       ✓ (plan: 1.45)
//
// Both round to the plan's stated values. test/normalize.test.ts asserts them.

/** Signed 16-bit full span. See the derivation above. */
export const COUNTS_FULL_SCALE = 32768;

/** Counts per g for an accelerometer at ±`fsG`. 16384 at ±2 g. */
export function countsPerG(fsG: number): number {
  return COUNTS_FULL_SCALE / fsG;
}

/** Counts per °/s for a gyro at ±`fsDps`. 131.072 at ±250 °/s. */
export function countsPerDps(fsDps: number): number {
  return COUNTS_FULL_SCALE / fsDps;
}

/**
 * Resolve the full-scale ranges for one row.
 *
 * Firmware ask #1: prefer what the device reports about itself. `DeviceMeta`
 * (from the `devices` table) is the fallback, and it is a *guess* maintained by
 * hand — the moment someone widens the range in firmware without updating the
 * row, every historical threshold silently changes meaning. Self-describing
 * scale is the fix; this is the code that consumes it.
 *
 * Zero and negative values are rejected rather than trusted: a `0` here would
 * make every converted magnitude `Infinity` and light up every impact detector
 * on the fleet.
 */
export function resolveScales(
  raw: ParsedRawRow,
  state: DeviceState,
): { accelFsG: number; gyroFsDps: number; selfDescribed: boolean } {
  const rawAccel = raw.accel_fs_g;
  const rawGyro = raw.gyro_fs_dps;
  const accelOk = typeof rawAccel === 'number' && rawAccel > 0;
  const gyroOk = typeof rawGyro === 'number' && rawGyro > 0;

  const metaAccel = state.meta.accelFsG > 0 ? state.meta.accelFsG : 2;
  const metaGyro = state.meta.gyroFsDps > 0 ? state.meta.gyroFsDps : 250;

  return {
    accelFsG: accelOk ? rawAccel : metaAccel,
    gyroFsDps: gyroOk ? rawGyro : metaGyro,
    selfDescribed: accelOk && gyroOk,
  };
}

/** Accelerometer counts → m/s². NaN in, NaN out. */
export function accelCountsToMps2(counts: number | null | undefined, fsG: number): number {
  if (typeof counts !== 'number' || !Number.isFinite(counts)) return NaN;
  return (counts / countsPerG(fsG)) * G;
}

/** Gyro counts → rad/s. NaN in, NaN out. */
export function gyroCountsToRadps(counts: number | null | undefined, fsDps: number): number {
  if (typeof counts !== 'number' || !Number.isFinite(counts)) return NaN;
  return (counts / countsPerDps(fsDps)) * DEG2RAD;
}

/** Gyro counts → °/s. Exposed because §2.1's sanity check is stated in °/s. */
export function gyroCountsToDps(counts: number | null | undefined, fsDps: number): number {
  if (typeof counts !== 'number' || !Number.isFinite(counts)) return NaN;
  return counts / countsPerDps(fsDps);
}

// ---------------------------------------------------------------------------
// §2.6 Timeline
// ---------------------------------------------------------------------------

/**
 * Parse a timestamp to epoch seconds, or NaN.
 *
 * Handles both shapes we can receive: an ISO-8601 string (JSONL capture, and
 * what the firmware sends) and Postgres's space-separated
 * `2026-08-09 13:00:00+00` text form, which `Date.parse` treats as
 * implementation-defined. Normalising the separator and padding a bare `+00`
 * offset to `+00:00` makes the result identical on every engine, which matters
 * because a replay whose timestamps depend on the V8 version is not a replay.
 */
export function parseTsSec(value: string | null | undefined): number {
  if (typeof value !== 'string' || value.trim() === '') return NaN;
  let s = value.trim();
  // '2026-08-09 13:00:00+00' → '2026-08-09T13:00:00+00'
  if (s.length > 10 && s[10] === ' ') s = `${s.slice(0, 10)}T${s.slice(11)}`;
  // '...+00' → '...+00:00' (a two-digit offset is not valid ISO-8601)
  s = s.replace(/([+-]\d{2})$/, '$1:00');
  // A naive timestamp with no zone is UTC here: `telemetry.server_received_at`
  // is `timestamptz` and the firmware sends GPS UTC. Assuming local time would
  // make the engine's output depend on the container's TZ.
  if (!/([Zz]|[+-]\d{2}:\d{2})$/.test(s) && /T\d{2}:\d{2}/.test(s)) s = `${s}Z`;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms / 1000 : NaN;
}

export interface ResolvedTime {
  tSec: number;
  quality: TimeQuality;
}

/**
 * The three-tier resolver of §2.6, plus the anchor maintenance that makes tier 2
 * work.
 *
 * Tier 1 `gps`      — `ts` is present. GPS UTC, 1 s granularity, and the only
 *                     one of the three that is both absolute and trustworthy.
 *                     Every tier-1 row re-anchors the uptime offset.
 * Tier 2 `anchored` — no `ts` (fix lost in a tunnel), but we have seen one this
 *                     boot. `uptime_ms` is monotonic within a boot, so
 *                     `anchorTSec + (uptime_ms - anchorUptimeMs)/1000` carries
 *                     the GPS timeline forward with only crystal drift — tens of
 *                     ppm, i.e. sub-second over an hour. Far better than arrival
 *                     time.
 * Tier 3 `server`   — cold start with no fix yet. `server_received_at` includes
 *                     network jitter and, worse, the device's retry delay, so a
 *                     row that sat in the 4-deep queue is stamped late. Usable
 *                     for ordering-of-last-resort, not for measuring a 1 s
 *                     derivative — which is why `aLong` is suppressed below
 *                     unless GPS is usable anyway.
 *
 * The anchor is deliberately re-set on *every* tier-1 row rather than only the
 * first: the ESP32's crystal drifts against GPS UTC, and continuously re-zeroing
 * that drift means a tunnel exit never shows a time discontinuity that §6.7's
 * `integrity.data_gap` would misread as lost data.
 */
export function resolveTime(raw: ParsedRawRow, state: DeviceState): ResolvedTime {
  const gpsSec = parseTsSec(raw.ts ?? null);
  const uptimeMs = raw.uptime_ms;

  if (Number.isFinite(gpsSec)) {
    if (typeof uptimeMs === 'number' && Number.isFinite(uptimeMs)) {
      state.anchorTSec = gpsSec;
      state.anchorUptimeMs = uptimeMs;
    }
    return { tSec: gpsSec, quality: 'gps' };
  }

  if (
    state.anchorTSec !== null &&
    state.anchorUptimeMs !== null &&
    typeof uptimeMs === 'number' &&
    Number.isFinite(uptimeMs)
  ) {
    return {
      tSec: state.anchorTSec + (uptimeMs - state.anchorUptimeMs) / 1000,
      quality: 'anchored',
    };
  }

  return { tSec: parseTsSec(raw.server_received_at ?? null), quality: 'server' };
}

// ---------------------------------------------------------------------------
// §2.6 Boot identity
// ---------------------------------------------------------------------------

/**
 * `${device_id}:${uptimeAnchorMs}` — the `uptime_ms` of the first row we
 * attribute to this boot.
 *
 * Deterministic and stable for replay: it is a pure function of bytes that are
 * already in the JSONL file, with no clock, no counter and no UUID in it. Feed
 * the same capture in twice and every `boot_id`, and therefore every
 * `event_key`, is identical — which is the whole point of §4's idempotency
 * argument.
 *
 * Known limitation, stated rather than hidden: the anchor is the first row *we
 * saw*, not the device's true power-on instant, which the payload does not
 * contain. A capture that begins mid-boot therefore produces a different
 * `boot_id` than the live engine assigned, and its events get different keys.
 * The fix is to replay whole boots (a reboot is a natural, self-identifying
 * capture boundary), not to invent a fuzzier identifier — `uptime_ms - seq*1000`
 * would be stable across a partial capture but drifts with every dropped post,
 * which trades a visible boundary condition for a silent one.
 */
export function makeBootId(deviceId: string, uptimeAnchorMs: number): string {
  const anchor = Number.isFinite(uptimeAnchorMs) ? Math.trunc(uptimeAnchorMs) : 0;
  return `${deviceId}:${anchor}`;
}

/**
 * §2.6: "Detect a reboot when `seq` decreases or `uptime_ms` decreases."
 *
 * Both, not either alone. `seq` is the true ordering key but a device that
 * crashes and restarts fast enough can, in principle, be seen with the same
 * `seq` twice; `uptime_ms` is monotonic per boot and resets to ~0, so it catches
 * that. Conversely `uptime_ms` is coarse and a delayed row can arrive with a
 * lower value than its neighbour for reasons other than a reboot — but `seq`
 * disambiguates because the sweeper and Realtime both feed rows in arrival
 * order, not `seq` order.
 *
 * Note the first-row case is NOT a reboot: `lastSeq < 0` means we have simply
 * never seen this device, which happens on every engine restart and must not
 * emit `integrity.device_reboot` for the whole fleet.
 */
function detectReboot(raw: ParsedRawRow, state: DeviceState): boolean {
  if (state.lastSeq < 0 || state.lastUptimeMs < 0) return false;
  const seq = raw.seq;
  const uptime = raw.uptime_ms;
  const seqWentBack = typeof seq === 'number' && seq < state.lastSeq;
  const uptimeWentBack = typeof uptime === 'number' && uptime < state.lastUptimeMs;
  return seqWentBack || uptimeWentBack;
}

// ---------------------------------------------------------------------------
// §2.2 Longitudinal acceleration
// ---------------------------------------------------------------------------
//
// THE CENTRED-vs-CAUSAL DECISION, and its latency cost.
//
// §2.2 gives `a_long = Δspeed / Δt` and §6.1 asks for it "smoothed over 3
// samples (Savitzky–Golay or 3-pt centred)". A centred window needs the sample
// *after* the one it describes. The ring is newest-first, so at the moment a row
// arrives its own centred estimate does not exist yet; you would have to either
//
//   (a) compute `aLong` for ring offset 1 and backfill it, leaving offset 0
//       permanently wrong until the next row, or
//   (b) hold every sample for one second before running detectors on it.
//
// WE TAKE NEITHER. This engine uses a CAUSAL least-squares slope over the last
// `cfg.longitudinal.smoothingWindow` samples, ending at the current one.
//
// Why:
//   * (a) breaks the contract that `DetectorContext.sample === ring[0]`. A
//     detector reading offset 0 would see a placeholder, and the "byte-identical
//     intermediate state" Phase 1 gate would be asserting a value that a later
//     row mutates — replay would pass while the live engine was subtly wrong.
//   * (b) costs a mandatory 1 s hold on every row, against §5's stated target of
//     p95 telemetry-row → event-row under 500 ms. Halving the latency budget to
//     buy half a sample of phase accuracy is a bad trade for a system whose
//     product is a hazard warning to a moving vehicle.
//   * For evenly spaced samples the N=3 least-squares slope is exactly
//     `(v[0] - v[2]) / (t[0] - t[2])`, i.e. the same central difference the plan
//     asks for — we simply attribute it to the newest sample instead of the
//     middle one, and the least-squares form generalises correctly to the uneven
//     spacing that dropped posts actually produce.
//
// LATENCY IMPLICATION, stated plainly: an N-point causal slope has a group delay
// of (N-1)/2 samples. At the default N=3 and 1 Hz that is **one second**. The
// estimate is centred on t[1] but reported at t[0], so a harsh brake is detected
// and anchored roughly one second after the physical event, and the
// `occurred_at` on `driver.harsh_brake` inherits that one-second lag. It is a
// constant, known bias — not jitter — so it is correctable at analysis time and
// identical in live and replay. If sub-second event timing ever matters more
// than pipeline latency, the fix is firmware ask #3 (sub-window peaks), not a
// centred filter over 1 Hz aggregates.
//
// GATING: `aLong` is NaN unless GPS is usable on every sample in the window.
// §2.2's noise budget (±0.5 km/h → ~0.14 m/s² at 1 Hz) only holds with
// `sats ≥ 5 && hdop ≤ 2.5`; without that gate a wandering fix manufactures
// multi-m/s² "braking" out of nothing.

/**
 * Causal least-squares slope of speed against resolved time, ending at the
 * current sample. Returns NaN when there is not enough usable, contiguous GPS.
 *
 * `prevSpeed`/`prevTSec` come from the ring (offsets 0..N-2 are the *previous*
 * samples at call time, because the new one has not been pushed yet).
 */
export function causalSlope(points: { t: number; v: number }[]): number {
  const n = points.length;
  if (n < 2) return NaN;

  let sumT = 0;
  let sumV = 0;
  for (const p of points) {
    sumT += p.t;
    sumV += p.v;
  }
  const meanT = sumT / n;
  const meanV = sumV / n;

  let num = 0;
  let den = 0;
  for (const p of points) {
    const dt = p.t - meanT;
    num += dt * (p.v - meanV);
    den += dt * dt;
  }
  // Every sample landed on the same timestamp — 1 s `ts` granularity can do this
  // when the device posts twice in one second. No slope is defined; say so.
  if (den <= 0) return NaN;
  return num / den;
}

function computeALong(
  state: DeviceState,
  tSec: number,
  speed: number,
  gpsUsable: boolean,
  cfg: Thresholds,
  rawAxCounts?: number,
  horizPeak?: number,
): number {
  if (cfg.demoMode && (!gpsUsable || !Number.isFinite(speed) || speed === 0)) {
    // In indoor demo mode on a desk: derive signed aLong from calibrated horizontal peak & raw X sign
    if (Number.isFinite(horizPeak) && (horizPeak ?? 0) > 0) {
      const sign =
        typeof rawAxCounts === 'number' && Number.isFinite(rawAxCounts) && rawAxCounts < 0
          ? -1
          : 1;
      return sign * (horizPeak ?? 0);
    }
  }

  if (!gpsUsable || !Number.isFinite(speed) || !Number.isFinite(tSec)) return NaN;

  const window = Math.max(2, Math.trunc(cfg.longitudinal.smoothingWindow));
  const points: { t: number; v: number }[] = [{ t: tSec, v: speed }];

  const ring = state.ring;
  let prevT = tSec;
  for (let i = 0; i < window - 1; i++) {
    if (!ring.has(i)) break;
    // Same GPS quality bar for the history as for the current row. A single
    // unusable sample in the middle of the window would bias the whole fit.
    if (!ring.hasFlagAt(i, Flags.GPS_USABLE)) break;
    const t = ring.tSecAt(i);
    const v = ring.speedAt(i);
    if (!Number.isFinite(t) || !Number.isFinite(v)) break;
    const dt = prevT - t;
    // Stop at a discontinuity: a reboot, a data gap, or out-of-order arrival.
    // Fitting across a 30 s hole would report the average of two unrelated
    // driving states as an acceleration.
    if (!(dt > 0) || dt > cfg.integrity.gapS) break;
    points.push({ t, v });
    prevT = t;
  }

  return causalSlope(points);
}

// ---------------------------------------------------------------------------
// §3 Plausibility gate
// ---------------------------------------------------------------------------

/**
 * The engine-side mitigation for the RLS hole (§3 routing change #5, §13).
 *
 * `telemetry`'s policy is `with check (true)` for `anon`, so anyone with the
 * public key — which ships in every dashboard bundle — can insert arbitrary
 * rows. This gate does not stop them being stored; it stops them reaching the
 * road map, which is where the damage compounds: a fabricated impact on a shared
 * H3 cell moves the `spike_rate` that decides driver-vs-road attribution for
 * every other driver who crosses it.
 *
 * Position is only checked when *both* lat and lon are present; a row with no
 * fix is normal, not hostile.
 */
export function plausibilityReason(raw: ParsedRawRow, cfg: Thresholds): string | null {
  const p = cfg.plausibility;

  const speedKmh = raw.gps?.speed_kmh;
  if (typeof speedKmh === 'number' && (speedKmh > p.maxSpeedKmh || speedKmh < 0)) {
    return `${REJECT.SPEED}:${speedKmh}`;
  }

  const lat = raw.gps?.lat;
  const lon = raw.gps?.lon;
  if (!cfg.demoMode && raw.gps?.fix === true && typeof lat === 'number' && typeof lon === 'number') {
    // (0,0) is Null Island — the canonical "uninitialised GPS struct" value, and
    // it is outside the operating box anyway, so it is rejected by the bounds
    // check rather than needing a special case.
    if (lat < p.latMin || lat > p.latMax || lon < p.lonMin || lon > p.lonMax) {
      return `${REJECT.BBOX}:${lat},${lon}`;
    }
  }

  const samples = raw.samples;
  if (typeof samples === 'number' && (samples > p.maxSamples || samples < 0)) {
    return `${REJECT.SAMPLES}:${samples}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// normalizeRow
// ---------------------------------------------------------------------------

function toVec3(
  v: { x?: unknown; y?: unknown; z?: unknown } | unknown[] | null | undefined,
): RawVec3 | null {
  if (!v) return null;
  if (Array.isArray(v)) {
    const [x, y, z] = v.map((item) => (typeof item === 'number' ? item : Number(item)));
    if (
      typeof x === 'number' &&
      typeof y === 'number' &&
      typeof z === 'number' &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(z)
    ) {
      return { x, y, z };
    }
    return null;
  }
  if (typeof v === 'object') {
    const { x, y, z } = v as { x?: unknown; y?: unknown; z?: unknown };
    const nx = Number(x);
    const ny = Number(y);
    const nz = Number(z);
    if (Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)) {
      return { x: nx, y: ny, z: nz };
    }
  }
  return null;
}

/**
 * The whole of §2, applied to one row.
 *
 * On success the sample has ALREADY been pushed onto `state.ring` (see the file
 * header). On failure nothing in `state` has been mutated — a rejected row must
 * not move the watermark of the device's own timeline, or a burst of poisoned
 * rows could drag the anchor with it.
 */
export function normalizeRow(
  raw: RawRow,
  state: DeviceState,
  cfg: Thresholds,
): NormalizeResult {
  // --- 1. Validate ---------------------------------------------------------
  const parsed = rawRowSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first && first.path.length > 0 ? first.path.join('.') : 'row';
    return { ok: false, reason: `${REJECT.SCHEMA}:${where}:${first?.message ?? 'invalid'}` };
  }
  const row = parsed.data;

  // The three fields with no defensible default. Without `id` a row cannot be
  // deduped or cited as evidence; without `seq`/`uptime_ms` boot identity and
  // ordering are both undefined.
  if (typeof row.id !== 'number' || typeof row.seq !== 'number' || typeof row.uptime_ms !== 'number') {
    return { ok: false, reason: `${REJECT.SCHEMA}:row:id/seq/uptime_ms required` };
  }

  // Routing a row into the wrong device's ring would silently blend two
  // vehicles' dynamics. Cheap assertion, catastrophic failure mode.
  if (row.device_id !== state.deviceId) {
    return {
      ok: false,
      reason: `${REJECT.DEVICE_MISMATCH}:${row.device_id}!=${state.deviceId}`,
    };
  }

  // --- 2. Plausibility -----------------------------------------------------
  const bad = plausibilityReason(row, cfg);
  if (bad !== null) return { ok: false, reason: bad };

  // --- 3. Boot identity (before time: a reboot clears the anchor) ----------
  const rebooted = detectReboot(row, state);
  if (rebooted) {
    // Capture the evidence BEFORE flushing, so `integrity.device_reboot` can
    // report what actually decreased. After the flush the decrease is invisible:
    // the ring is empty and the counters are reset, so the detector could
    // otherwise only report that *a* reboot happened, not which clock proved it.
    state.pendingRebootEvent = {
      previousSeq: state.lastSeq,
      previousUptimeMs: state.lastUptimeMs,
      previousBootId: state.bootId,
      trigger:
        typeof row.seq === 'number' && row.seq < state.lastSeq ? 'seq_decrease' : 'uptime_decrease',
    };
    // flushOnReboot resets the ring, the anchors and every excursion tracker,
    // and deliberately keeps the learned baselines — the physical vehicle and
    // its mount are unchanged by a firmware restart.
    flushOnReboot(state, makeBootId(state.deviceId, row.uptime_ms));
  } else if (state.bootId === '') {
    // First row ever seen for this device (cold engine start, or post-eviction).
    state.bootId = makeBootId(state.deviceId, row.uptime_ms);
  }

  // --- 4. Time -------------------------------------------------------------
  const { tSec, quality } = resolveTime(row, state);
  if (!Number.isFinite(tSec)) {
    // All three clocks failed. Anything downstream keyed on time — the ring's
    // window walk, trip duration, event `occurred_at` — would be poisoned, and
    // `Sample.tSec` is contractually never NaN. Reject rather than invent one.
    return { ok: false, reason: REJECT.TIME };
  }

  // --- 5. Scales and conversion -------------------------------------------
  const { accelFsG, gyroFsDps } = resolveScales(row, state);

  const gps = row.gps ?? undefined;
  const accelCal = row.accel_cal ?? undefined;
  const gyroCal = row.gyro_cal ?? undefined;
  const mic = row.mic ?? undefined;
  const calibration = row.calibration ?? undefined;

  const hasFix = gps?.fix === true;
  const sats = typeof gps?.sats === 'number' ? gps.sats : 0;
  // No hdop reported means no quality claim, and an unsupported claim must fail
  // the gate rather than pass it: NaN <= 2.5 is false, which is the answer we
  // want. Defaulting to 0 would silently promote every hdop-less row to "usable".
  const hdop = typeof gps?.hdop === 'number' ? gps.hdop : NaN;
  const gpsUsable = hasFix && sats >= cfg.gps.minSats && hdop <= cfg.gps.maxHdop;

  const speedKmh = typeof gps?.speed_kmh === 'number' ? gps.speed_kmh : NaN;
  // `Sample.speed` is contractually "m/s, 0 when no fix" — detectors treat 0 as
  // stationary and gate on GPS_FIX before believing it.
  const speed = hasFix && Number.isFinite(speedKmh) ? speedKmh / 3.6 : 0;
  const heading = hasFix && typeof gps?.heading === 'number' ? gps.heading : NaN;
  const lat = hasFix && typeof gps?.lat === 'number' ? gps.lat : null;
  const lon = hasFix && typeof gps?.lon === 'number' ? gps.lon : null;

  // Raw counts kept for the §2.4 clipping check and §6.7's stuck-sensor rule.
  // These are the ONLY counts allowed to survive the normalizer boundary, and
  // they are explicitly named `...Counts` so nothing mistakes them for SI.
  const rawVertPeakCounts =
    typeof accelCal?.vertical_peak === 'number' ? accelCal.vertical_peak : NaN;
  const rawMagPeakCounts =
    typeof accelCal?.magnitude_peak === 'number' ? accelCal.magnitude_peak : NaN;

  const vertPeak = accelCountsToMps2(accelCal?.vertical_peak, accelFsG);
  const vertRms = accelCountsToMps2(accelCal?.vertical_rms, accelFsG);
  const horizPeak = accelCountsToMps2(accelCal?.horizontal_peak, accelFsG);
  const magPeak = accelCountsToMps2(accelCal?.magnitude_peak, accelFsG);
  const yawRate = gyroCountsToRadps(gyroCal?.yaw_rate_peak, gyroFsDps);

  const micRms = typeof mic?.rms === 'number' ? mic.rms : NaN;
  const micPeak = typeof mic?.peak === 'number' ? mic.peak : NaN;

  const calibrationState: CalibrationState =
    typeof calibration?.state === 'string' ? calibration.state : 'uncalibrated';
  const calibrationAgeMs = typeof calibration?.age_ms === 'number' ? calibration.age_ms : NaN;
  const gravityRef = toVec3(calibration?.gravity_ref);

  const rawAx =
    Array.isArray(row.accel_raw)
      ? row.accel_raw[0]
      : typeof row.accel_raw === 'object' && row.accel_raw !== null
        ? (row.accel_raw as any).x
        : NaN;

  const aLong = computeALong(state, tSec, speed, gpsUsable, cfg, rawAx, horizPeak);

  // --- 6. Flags ------------------------------------------------------------
  //
  // §2.5 HARD RULE. "When `calibration.state != 'calibrated'`, the gravity
  // vector is stale or a default, so the vertical/horizontal decomposition is
  // meaningless — vertical noise leaks into horizontal and vice versa. Suppress
  // every `accel_cal`/`gyro_cal`-derived detector."
  //
  // The suppression is expressed as ACCEL_VALID / GYRO_VALID being clear, NOT by
  // zeroing the fields. That distinction is deliberate and it is the reason the
  // flag exists at all: a zeroed `vertPeak` is indistinguishable from a genuinely
  // smooth road, so it would quietly *lower* the cell's roughness statistics and
  // corrupt the fleet map. A flagged one is visibly untrustworthy, is skipped by
  // every detector, and is still there in the evidence blob when someone asks
  // what the sensor actually said. `integrity.calibration_stale` is emitted by
  // the integrity detector off the same signal.
  const calibrated = calibrationState === 'calibrated';

  let flags = 0;
  if (calibrated) flags |= Flags.CALIBRATED;
  if (hasFix || cfg.demoMode) flags |= Flags.GPS_FIX;
  if (gpsUsable || cfg.demoMode) flags |= Flags.GPS_USABLE;

  // §2.4: at ±2 g with ~1 g permanently consumed by gravity there is only ~1 g
  // of headroom, and real potholes exceed it. Checked on the RAW counts because
  // the rail is a property of the ADC, not of the SI value — and `cfg.impact.
  // clipCounts` is expressed in counts for the same reason. `abs` because the
  // axis rails in both directions.
  const clipped =
    (Number.isFinite(rawVertPeakCounts) && Math.abs(rawVertPeakCounts) > cfg.impact.clipCounts) ||
    (Number.isFinite(rawMagPeakCounts) && Math.abs(rawMagPeakCounts) > cfg.impact.clipCounts);
  if (clipped) flags |= Flags.CLIPPED;

  if ((hasFix && speed > cfg.duty.idleSpeed) || (cfg.demoMode && Number.isFinite(horizPeak) && horizPeak > 0)) {
    flags |= Flags.MOVING;
  }

  // The mic is a raw 12-bit ADC (§2.1): 0..4095, unitless, relative only. A
  // value outside that range is not a loud noise, it is a broken read.
  const micValid =
    Number.isFinite(micRms) && Number.isFinite(micPeak) && micPeak >= 0 && micPeak <= 4095;
  if (micValid) flags |= Flags.MIC_VALID;

  // Present AND calibrated — both halves are load-bearing. A missing block is
  // just as unusable as a stale gravity vector.
  const accelValid = calibrated && Number.isFinite(vertPeak) && Number.isFinite(vertRms);
  if (accelValid) flags |= Flags.ACCEL_VALID;

  const gyroValid = calibrated && Number.isFinite(yawRate);
  if (gyroValid) flags |= Flags.GYRO_VALID;

  // --- 7. Assemble ---------------------------------------------------------
  const sample: Sample = {
    telemetryId: row.id,
    deviceId: state.deviceId,
    bootId: state.bootId,
    seq: row.seq,
    uptimeMs: row.uptime_ms,

    tSec,
    timeQuality: quality,

    speed,
    aLong,
    yawRate,
    vertRms,
    vertPeak,
    horizPeak,
    magPeak,
    heading,

    lat,
    lon,
    sats,
    hdop,

    micRms,
    micPeak,

    calibrationState,
    calibrationAgeMs,
    gravityRef,

    samples: typeof row.samples === 'number' ? row.samples : 0,
    wifiRssi: typeof row.wifi_rssi === 'number' ? row.wifi_rssi : NaN,
    droppedPosts: typeof row.dropped_posts === 'number' ? row.dropped_posts : null,

    flags,

    rawVertPeakCounts,
    rawMagPeakCounts,
    accelRaw: toVec3(row.accel_raw),
  };

  // --- 8. Commit to state --------------------------------------------------
  // Last, and only on the success path, so a rejected row leaves no trace.
  state.lastSeq = row.seq;
  state.lastUptimeMs = row.uptime_ms;
  state.lastTimeQuality = quality;
  state.ring.push(sample);

  return { ok: true, sample, rebooted };
}
