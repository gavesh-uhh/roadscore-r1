/**
 * The contract every detector implements.
 *
 * ENGINE-PLAN §5: "Detectors are pure functions (ring, cfg, deviceMeta) →
 * EventCandidate[]. No I/O, no clock reads, no randomness. That is what makes
 * the replay harness possible, and it is what lets you tune thresholds without
 * a car."
 *
 * Purity here means: given the same `DetectorContext`, a detector returns the
 * same candidates. Detectors MAY mutate `ctx.state` (baselines, excursion
 * trackers, timers) because that mutation is itself deterministic and replayed
 * identically — but they may not read `Date.now()`, touch the network, or call
 * `Math.random()`.
 */

import type { DeviceState } from '../domain/state.js';
import type { Thresholds } from '../config/thresholds.js';
import type { DeviceMeta, EventCandidate, Sample } from '../types.js';

export interface DetectorContext {
  /** The sample just pushed onto the ring. Equivalent to `state.ring` offset 0. */
  sample: Sample;
  /** Mutable per-device state, including the ring. */
  state: DeviceState;
  meta: DeviceMeta;
  cfg: Thresholds;
}

export interface Detector {
  /** Stable identifier, used in logs and metrics. */
  readonly name: string;
  /**
   * Called once per normalised sample, in registry order.
   * Must not throw; return `[]` when nothing fires.
   */
  run(ctx: DetectorContext): EventCandidate[];
}

/**
 * Helper for building a candidate with the fields that are identical across
 * every detector, so individual detectors only specify what makes them distinct.
 */
export function baseCandidate(
  ctx: DetectorContext,
  partial: Pick<EventCandidate, 'type' | 'category' | 'severity' | 'confidence'> &
    Partial<EventCandidate>,
): EventCandidate {
  const s = ctx.sample;
  return {
    deviceId: s.deviceId,
    bootId: s.bootId,
    anchorSeq: s.seq,
    occurredAt: s.tSec,
    timeQuality: s.timeQuality,
    lat: s.lat,
    lon: s.lon,
    h3_12: null,
    headingSector: null,
    speedKmh: Number.isFinite(s.speed) ? s.speed * 3.6 : null,
    magnitude: null,
    magnitudeUnit: null,
    severityCensored: false,
    attributedToDriver: partial.category === 'driver',
    roadDefectId: null,
    evidence: {},
    telemetryIds: [s.telemetryId],
    ...partial,
  };
}

/** Clamp a confidence into 0..1. */
export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Pick a severity band from an absolute magnitude and three ascending cut points. */
export function bandSeverity(
  magnitude: number,
  bands: { low: number; medium: number; high: number },
): 'low' | 'medium' | 'high' | null {
  const m = Math.abs(magnitude);
  const { low, medium, high } = {
    low: Math.abs(bands.low),
    medium: Math.abs(bands.medium),
    high: Math.abs(bands.high),
  };
  if (m >= high) return 'high';
  if (m >= medium) return 'medium';
  if (m >= low) return 'low';
  return null;
}
