/**
 * Cornering and excessive cornering speed — ENGINE-PLAN §6.2.
 *
 * The physical identity is a_lat = v · ω (the plan's Slide 4 claim). It needs no
 * calibration to be meaningful, because it is built from GPS speed and the gyro
 * yaw rate rather than from the gravity-decomposed accelerometer — which is why
 * this detector survives §2.5 suppression while the impact detector does not.
 *
 * `yaw_rate_peak` is unsigned, so we know how hard the vehicle turned but not
 * which way. That is fine here (a 0.5 g corner is a 0.5 g corner in either
 * direction) and fatal in §6.3, which is why swerving needs a different trick.
 */

import type { EventCandidate, EventSeverity } from '../types.js';
import { Flags } from '../types.js';
import type { Detector, DetectorContext } from './context.js';
import { baseCandidate, clamp01 } from './context.js';
import { headingDelta, newExcursion } from '../domain/state.js';
import { DEG2RAD } from '../config/thresholds.js';

/**
 * Yaw rate implied by the change in GPS heading, rad/s.
 *
 * §6.2 asks for this as an "independent check ... catches gyro drift and heading
 * noise on both sides". Returns NaN when either sample lacks a usable fix, or
 * when the vehicle is too slow for GPS heading to mean anything (a stationary
 * receiver reports essentially random heading).
 */
export function gpsYawRate(ctx: DetectorContext): number {
  const r = ctx.state.ring;
  if (r.size < 2) return NaN;
  if (!r.hasFlagAt(0, Flags.GPS_USABLE) || !r.hasFlagAt(1, Flags.GPS_USABLE)) return NaN;

  const h0 = r.headingAt(0);
  const h1 = r.headingAt(1);
  const dt = r.tSecAt(0) - r.tSecAt(1);
  if (!Number.isFinite(h0) || !Number.isFinite(h1) || !(dt > 0)) return NaN;

  // Heading is only trustworthy while genuinely moving.
  if (!(r.speedAt(0) > ctx.cfg.gps.minSpeedForDynamics)) return NaN;

  return Math.abs(headingDelta(h0, h1) * DEG2RAD) / dt;
}

/**
 * §6.2's consistency envelope, stated in the plan as an *inequality*:
 *
 *   max(|a_long|, a_lat) − 0.5  ≤  horizontal_peak  ≤  hypot(a_long, a_lat) + 0.8
 *
 * The plan is explicit that this "is an inequality, not equality — the two peaks
 * need not co-occur within the 1 s window". The lower bound says the measured
 * horizontal peak must be at least as large as the biggest single component;
 * the upper bound says it cannot exceed their vector sum by more than slack.
 *
 * Returns true when the accelerometer is untrustworthy (§2.5) — we do not gate
 * on a number we have already decided is meaningless.
 */
export function lateralConsistent(ctx: DetectorContext, aLat: number): boolean {
  const s = ctx.sample;
  if ((s.flags & Flags.ACCEL_VALID) === 0) return true;
  if (!Number.isFinite(s.horizPeak)) return true;

  const aLong = Number.isFinite(s.aLong) ? s.aLong : 0;
  const lower = Math.max(Math.abs(aLong), aLat) - ctx.cfg.lateral.consistencyLowSlack;
  const upper = Math.hypot(aLong, aLat) + ctx.cfg.lateral.consistencyHighSlack;
  return s.horizPeak >= lower && s.horizPeak <= upper;
}

function excessiveSeverity(aLat: number, ctx: DetectorContext): EventSeverity | null {
  const b = ctx.cfg.lateral.excessive;
  if (aLat >= b.high) return 'high';
  if (aLat >= b.medium) return 'medium';
  if (aLat >= b.low) return 'low';
  return null;
}

export const lateralDetector: Detector = {
  name: 'lateral',
  run(ctx: DetectorContext): EventCandidate[] {
    const s = ctx.sample;
    const ex = ctx.state.corneringExcursion;
    const t = ctx.cfg.lateral;

    const yaw = s.yawRate;
    const speed = ctx.cfg.demoMode && (!Number.isFinite(s.speed) || s.speed === 0) ? 11.11 : s.speed;
    const gyroValid = (s.flags & Flags.GYRO_VALID) !== 0;
    const gpsUsable = ctx.cfg.demoMode || (s.flags & Flags.GPS_USABLE) !== 0;

    const cornering =
      gyroValid &&
      gpsUsable &&
      Number.isFinite(yaw) &&
      Number.isFinite(speed) &&
      yaw > t.cornerYaw &&
      speed > t.cornerSpeed;

    // a_lat = v · ω — the whole detector in one line (§6.2).
    const aLat = cornering ? speed * yaw : NaN;

    // Independent GPS cross-check. Only *disqualifies* when both witnesses are
    // available and disagree; an absent GPS yaw is not evidence against.
    const wGps = ctx.cfg.demoMode ? NaN : gpsYawRate(ctx);
    const crossChecked = Number.isFinite(wGps);
    const agrees = !crossChecked || Math.abs(yaw - wGps) <= t.gpsYawTolerance;
    const consistent = ctx.cfg.demoMode ? true : lateralConsistent(ctx, Number.isFinite(aLat) ? aLat : 0);

    const valid = cornering && agrees && consistent;

    if (!valid) {
      // Corner over (or never trustworthy): flush the tracker and emit.
      if (ex.active) {
        const out = closeCorner(ctx, ex);
        Object.assign(ex, newExcursion());
        return out;
      }
      return [];
    }

    if (!ex.active) {
      ex.active = true;
      ex.peak = aLat;
      ex.peakSeq = s.seq;
      ex.peakTSec = s.tSec;
      ex.peakLat = s.lat;
      ex.peakLon = s.lon;
      ex.peakSpeed = speed;
      ex.startTSec = s.tSec;
      ex.telemetryIds = [s.telemetryId];
      ex.corroborated = consistent;
      return [];
    }

    ex.telemetryIds.push(s.telemetryId);
    if (aLat > ex.peak) {
      ex.peak = aLat;
      ex.peakSeq = s.seq;
      ex.peakTSec = s.tSec;
      ex.peakLat = s.lat;
      ex.peakLon = s.lon;
      ex.peakSpeed = speed;
      ex.corroborated = consistent;
    }
    return [];
  },
};

/**
 * One corner produces at most two events: the fact that it happened, and — only
 * if the lateral load was uncomfortable — that it was taken too fast.
 *
 * Both are anchored at the peak so they share a timestamp with the physical
 * moment of maximum load.
 */
function closeCorner(
  ctx: DetectorContext,
  ex: typeof ctx.state.corneringExcursion,
): EventCandidate[] {
  const aLat = ex.peak;
  if (!Number.isFinite(aLat) || ex.telemetryIds.length === 0) return [];

  const durationS = Math.max(0, ex.peakTSec - ex.startTSec);
  const omega = ex.peakSpeed > 0 ? aLat / ex.peakSpeed : NaN;

  const evidence = {
    rule: '§6.2 a_lat = v · ω',
    a_lat_mps2: Number.parseFloat(aLat.toFixed(4)),
    a_lat_g: Number.parseFloat((aLat / 9.80665).toFixed(4)),
    speed_mps: Number.parseFloat(ex.peakSpeed.toFixed(3)),
    yaw_rate_radps: Number.isFinite(omega) ? Number.parseFloat(omega.toFixed(5)) : null,
    corner_yaw_threshold_radps: ctx.cfg.lateral.cornerYaw,
    duration_s: Number.parseFloat(durationS.toFixed(3)),
    samples: ex.telemetryIds.length,
    consistency_envelope_held: ex.corroborated,
    time_quality: ctx.sample.timeQuality,
  };

  const common = {
    anchorSeq: ex.peakSeq,
    occurredAt: ex.peakTSec,
    lat: ex.peakLat,
    lon: ex.peakLon,
    speedKmh: Number.parseFloat((ex.peakSpeed * 3.6).toFixed(3)),
    magnitude: Number.parseFloat(aLat.toFixed(4)),
    magnitudeUnit: 'm/s2',
    telemetryIds: ex.telemetryIds.slice(),
  };

  const out: EventCandidate[] = [];

  out.push(
    baseCandidate(ctx, {
      type: 'driver.sharp_corner',
      category: 'driver',
      // A corner on its own is not misconduct — it is context. It carries the
      // lowest weight in §8 and exists mostly so cornering speed has a
      // denominator and the dashboard can show route shape.
      severity: 'info',
      confidence: clamp01(ex.corroborated ? 0.8 : 0.6),
      evidence: { ...evidence, note: 'corner occurred; severity judged by excessive_cornering_speed' },
      ...common,
    }),
  );

  const sev = excessiveSeverity(aLat, ctx);
  if (sev !== null) {
    const span = Math.max(ctx.cfg.lateral.excessive.high - ctx.cfg.lateral.excessive.low, 0.1);
    const over = (aLat - ctx.cfg.lateral.excessive.low) / span;
    out.push(
      baseCandidate(ctx, {
        type: 'driver.excessive_cornering_speed',
        category: 'driver',
        severity: sev,
        confidence: clamp01(0.6 + 0.3 * clamp01(over) - (ex.corroborated ? 0 : 0.15)),
        evidence: {
          ...evidence,
          bands_mps2: ctx.cfg.lateral.excessive,
          // The plan's own worked example, kept next to the verdict so the
          // calibration is legible to a reader (§6.2).
          worked_example: '40 km/h through a 20 °/s turn → a_lat = 3.9 m/s² = 0.40 g',
        },
        ...common,
      }),
    );
  }

  return out;
}

export default lateralDetector;
