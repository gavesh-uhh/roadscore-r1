/**
 * Harsh braking and harsh acceleration — ENGINE-PLAN §6.1.
 *
 * This is the detector that §2.2 forces to be stateful. `horizontal_peak` is a
 * magnitude with no sign, so "brake" and "accelerate" are indistinguishable
 * within a single row; the sign exists only in the derivative of GPS speed.
 * `aLong` (computed once, in normalize) carries that sign, and this detector
 * turns a contiguous run of over-threshold samples into exactly one event.
 *
 * Emitting per-row would turn one 4-second stop into four events and quadruple
 * the penalty, so the excursion tracker with hysteresis is not a refinement —
 * it is what makes the score meaningful.
 */

import type { EventCandidate, EventSeverity } from '../types.js';
import { Flags } from '../types.js';
import type { DetectorContext, Detector } from './context.js';
import { baseCandidate, clamp01 } from './context.js';
import type { Excursion } from '../domain/state.js';
import { newExcursion } from '../domain/state.js';

type Direction = 'brake' | 'accel';

/**
 * Is this sample eligible for a longitudinal verdict at all?
 *
 * §6.1: `gpsFix && sats >= 5 && hdop <= 2.5 && speed >= 2.8 m/s`. GPS_USABLE
 * already encodes the first three (normalize sets it), and `aLong` is NaN
 * whenever the window it was derived from was not usable — so a finite `aLong`
 * is itself part of the gate.
 */
function gated(ctx: DetectorContext): boolean {
  const s = ctx.sample;
  if (!Number.isFinite(s.aLong)) return false;
  if ((s.flags & Flags.GPS_USABLE) === 0) return false;
  if (!(s.speed >= ctx.cfg.gps.minSpeedForDynamics)) return false;

  // §6.1: "suppress if yawRate > 0.17 rad/s — that's a corner bleeding in".
  // A hard corner loads the horizontal axis and perturbs GPS speed; attributing
  // that to braking would double-count it against the cornering detector.
  if (Number.isFinite(s.yawRate) && s.yawRate > ctx.cfg.longitudinal.cornerSuppressYaw) {
    return false;
  }
  return true;
}

/**
 * §6.1 corroboration: "horizontal_peak >= |a_long| - 0.5 m/s²  (peak magnitude
 * must at least contain the longitudinal component)".
 *
 * GPS speed can step for reasons that have nothing to do with the vehicle
 * (a fix jump, a satellite change). The accelerometer is an independent witness:
 * if the body never felt a horizontal force, the speed change was an artefact.
 *
 * Skipped when the accelerometer is not trustworthy — §2.5 says an uncalibrated
 * gravity vector makes the horizontal/vertical split meaningless, and in that
 * case we fall back to GPS alone rather than gating on a garbage number.
 */
function corroborated(ctx: DetectorContext, aLong: number): boolean {
  const s = ctx.sample;
  if ((s.flags & Flags.ACCEL_VALID) === 0) return true;
  if (!Number.isFinite(s.horizPeak)) return true;
  return s.horizPeak >= Math.abs(aLong) - ctx.cfg.longitudinal.corroborationSlack;
}

/** Severity from the signed peak. Bands are negative for braking (§6.1). */
function severityFor(dir: Direction, peak: number, ctx: DetectorContext): EventSeverity | null {
  const t = ctx.cfg.longitudinal;
  if (dir === 'brake') {
    if (peak <= t.brake.high) return 'high';
    if (peak <= t.brake.medium) return 'medium';
    if (peak <= t.brake.low) return 'low';
    return null;
  }
  if (peak >= t.accel.high) return 'high';
  if (peak >= t.accel.medium) return 'medium';
  if (peak >= t.accel.low) return 'low';
  return null;
}

/** Entry threshold — the lowest band that counts as an event. */
function entryThreshold(dir: Direction, ctx: DetectorContext): number {
  return dir === 'brake' ? ctx.cfg.longitudinal.brake.low : ctx.cfg.longitudinal.accel.low;
}

function exceedsEntry(dir: Direction, aLong: number, ctx: DetectorContext): boolean {
  const th = entryThreshold(dir, ctx);
  return dir === 'brake' ? aLong <= th : aLong >= th;
}

/**
 * Hysteresis exit: §6.1 "exit at 60 % of entry threshold".
 *
 * Without this, jitter around the threshold splits one brake into a burst of
 * events. The gap between entry and exit has to be crossed before the excursion
 * is considered over.
 */
function belowExit(dir: Direction, aLong: number, ctx: DetectorContext): boolean {
  const th = entryThreshold(dir, ctx) * ctx.cfg.longitudinal.hysteresisExit;
  return dir === 'brake' ? aLong > th : aLong < th;
}

function isNewPeak(dir: Direction, aLong: number, peak: number): boolean {
  return dir === 'brake' ? aLong < peak : aLong > peak;
}

/** Confidence: how far past the entry threshold the peak got, plus corroboration. */
function confidenceFor(dir: Direction, peak: number, ctx: DetectorContext, corrob: boolean): number {
  const entry = Math.abs(entryThreshold(dir, ctx));
  const high = Math.abs(dir === 'brake' ? ctx.cfg.longitudinal.brake.high : ctx.cfg.longitudinal.accel.high);
  const span = Math.max(high - entry, 0.1);
  const over = (Math.abs(peak) - entry) / span;
  let c = 0.55 + 0.35 * clamp01(over);
  if (!corrob) c -= 0.2;
  // §2.2's noise budget: NEO-6M speed noise is ~±0.5 km/h → ~0.14 m/s² floor.
  // The lowest band sits close enough to that to stay advisory (§13).
  if (Math.abs(peak) < entry * 1.15) c -= 0.1;
  return clamp01(c);
}

function emit(
  ctx: DetectorContext,
  dir: Direction,
  ex: Excursion,
): EventCandidate | null {
  const severity = severityFor(dir, ex.peak, ctx);
  if (severity === null) return null;

  const corrob = ex.telemetryIds.length > 0 && ex.corroborated;
  const type = dir === 'brake' ? 'driver.harsh_brake' : 'driver.harsh_accel';

  return baseCandidate(ctx, {
    type,
    category: 'driver',
    severity,
    confidence: confidenceFor(dir, ex.peak, ctx, corrob),
    // Anchored at the PEAK sample, not the sample that closed the excursion —
    // that is the instant a human would point at, and it keeps `event_key`
    // stable if the tail of the excursion is re-delivered (§4 idempotency).
    anchorSeq: ex.peakSeq,
    occurredAt: ex.peakTSec,
    lat: ex.peakLat,
    lon: ex.peakLon,
    speedKmh: Number.isFinite(ex.peakSpeed) ? ex.peakSpeed * 3.6 : null,
    magnitude: Number.parseFloat(ex.peak.toFixed(4)),
    magnitudeUnit: 'm/s2',
    evidence: {
      rule: dir === 'brake' ? '§6.1 harsh_brake' : '§6.1 harsh_accel',
      peak_a_long_mps2: Number.parseFloat(ex.peak.toFixed(4)),
      entry_threshold_mps2: entryThreshold(dir, ctx),
      exit_threshold_mps2: entryThreshold(dir, ctx) * ctx.cfg.longitudinal.hysteresisExit,
      duration_s: Number.parseFloat(Math.max(0, ex.peakTSec - ex.startTSec).toFixed(3)),
      samples: ex.telemetryIds.length,
      horizontal_corroborated: corrob,
      smoothing_window: ctx.cfg.longitudinal.smoothingWindow,
      // Stated on every event so a reader is never misled about provenance (§2.6).
      time_quality: ctx.sample.timeQuality,
    },
    telemetryIds: ex.telemetryIds.slice(),
  });
}

/**
 * Advance one direction's excursion by one sample, returning an event when the
 * excursion just closed.
 */
function step(ctx: DetectorContext, dir: Direction, ex: Excursion): EventCandidate | null {
  const s = ctx.sample;
  const ok = gated(ctx);
  const aLong = s.aLong;

  if (!ok) {
    // The gate dropped out mid-excursion (lost fix, slowed below the floor, or
    // turned into a corner). Close on what we have rather than discarding it —
    // the peak already happened and is still evidence.
    if (ex.active) {
      const out = emit(ctx, dir, ex);
      Object.assign(ex, newExcursion());
      return out;
    }
    return null;
  }

  if (!ex.active) {
    if (exceedsEntry(dir, aLong, ctx) && corroborated(ctx, aLong)) {
      ex.active = true;
      ex.peak = aLong;
      ex.peakSeq = s.seq;
      ex.peakTSec = s.tSec;
      ex.peakLat = s.lat;
      ex.peakLon = s.lon;
      ex.peakSpeed = s.speed;
      ex.startTSec = s.tSec;
      ex.telemetryIds = [s.telemetryId];
      ex.corroborated = corroborated(ctx, aLong);
    }
    return null;
  }

  // Active: track the peak and accumulate evidence.
  ex.telemetryIds.push(s.telemetryId);
  if (isNewPeak(dir, aLong, ex.peak)) {
    ex.peak = aLong;
    ex.peakSeq = s.seq;
    ex.peakTSec = s.tSec;
    ex.peakLat = s.lat;
    ex.peakLon = s.lon;
    ex.peakSpeed = s.speed;
    ex.corroborated = corroborated(ctx, aLong);
  }

  if (belowExit(dir, aLong, ctx)) {
    const out = emit(ctx, dir, ex);
    Object.assign(ex, newExcursion());
    return out;
  }
  return null;
}

export const longitudinalDetector: Detector = {
  name: 'longitudinal',
  run(ctx: DetectorContext): EventCandidate[] {
    const out: EventCandidate[] = [];
    // Braking and acceleration are tracked independently. They are mutually
    // exclusive per sample by sign, but an excursion of one can still be open
    // when the other starts (lift off the brake, straight onto the throttle).
    const b = step(ctx, 'brake', ctx.state.brakeExcursion);
    if (b) out.push(b);
    const a = step(ctx, 'accel', ctx.state.accelExcursion);
    if (a) out.push(a);
    return out;
  },
};

export default longitudinalDetector;
