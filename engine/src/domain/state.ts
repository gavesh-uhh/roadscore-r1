/**
 * Per-device in-memory state: the ring buffer detectors read, plus the
 * long-lived scalars (baselines, timers) that live beside it.
 *
 * ENGINE-PLAN §5: preallocated typed arrays, no per-row allocation, no GC churn.
 * ~12 arrays x 120 x 8 B = ~11.5 KB/device; a 1000-vehicle fleet is ~12 MB.
 */

import type { CalibrationState, DeviceMeta, RawVec3, Sample, TimeQuality, Trip } from '../types.js';
import type { ScorableEvent } from '../score/penalties.js';
import { Flags } from '../types.js';

export const RING_CAP = 120;

/**
 * Fixed-size circular buffer of the last 120 normalised seconds.
 *
 * Indexing convention used by every detector: `at(0)` is the newest sample,
 * `at(1)` the one before it, and so on. `size` is how many slots are actually
 * populated (< cap while the device warms up). Reading beyond `size` returns
 * NaN / 0 rather than stale data from the previous lap.
 */
export class DeviceRing {
  readonly cap = RING_CAP;

  readonly speed = new Float64Array(RING_CAP); // m/s
  readonly aLong = new Float64Array(RING_CAP); // m/s², signed
  readonly yawRate = new Float64Array(RING_CAP); // rad/s, unsigned
  readonly vertRms = new Float64Array(RING_CAP); // m/s²
  readonly vertPeak = new Float64Array(RING_CAP); // m/s²
  readonly horizPeak = new Float64Array(RING_CAP); // m/s²
  readonly magPeak = new Float64Array(RING_CAP); // m/s²
  readonly heading = new Float64Array(RING_CAP); // deg, NaN without a fix
  readonly tSec = new Float64Array(RING_CAP); // resolved epoch seconds
  readonly lat = new Float64Array(RING_CAP);
  readonly lon = new Float64Array(RING_CAP);
  readonly micRms = new Float64Array(RING_CAP);
  readonly micPeak = new Float64Array(RING_CAP);
  readonly flags = new Uint8Array(RING_CAP);
  readonly seq = new Float64Array(RING_CAP);
  readonly telemetryId = new Float64Array(RING_CAP);

  /** Index of the newest sample. -1 until the first push. */
  head = -1;
  /** Number of populated slots, capped at `cap`. */
  size = 0;

  /** Physical slot for logical offset `i` back from the newest. */
  idx(i: number): number {
    return (this.head - i + this.cap * 2) % this.cap;
  }

  push(s: Sample): void {
    this.head = (this.head + 1) % this.cap;
    const h = this.head;
    this.speed[h] = s.speed;
    this.aLong[h] = s.aLong;
    this.yawRate[h] = s.yawRate;
    this.vertRms[h] = s.vertRms;
    this.vertPeak[h] = s.vertPeak;
    this.horizPeak[h] = s.horizPeak;
    this.magPeak[h] = s.magPeak;
    this.heading[h] = s.heading;
    this.tSec[h] = s.tSec;
    this.lat[h] = s.lat ?? NaN;
    this.lon[h] = s.lon ?? NaN;
    this.micRms[h] = s.micRms;
    this.micPeak[h] = s.micPeak;
    this.flags[h] = s.flags;
    this.seq[h] = s.seq;
    this.telemetryId[h] = s.telemetryId;
    if (this.size < this.cap) this.size++;
  }

  /** True when logical offset `i` refers to a populated slot. */
  has(i: number): boolean {
    return i >= 0 && i < this.size;
  }

  /** Newest-first accessors. Return NaN (or 0 for flags) when out of range. */
  speedAt(i: number): number {
    return this.has(i) ? this.speed[this.idx(i)]! : NaN;
  }
  aLongAt(i: number): number {
    return this.has(i) ? this.aLong[this.idx(i)]! : NaN;
  }
  yawRateAt(i: number): number {
    return this.has(i) ? this.yawRate[this.idx(i)]! : NaN;
  }
  vertRmsAt(i: number): number {
    return this.has(i) ? this.vertRms[this.idx(i)]! : NaN;
  }
  vertPeakAt(i: number): number {
    return this.has(i) ? this.vertPeak[this.idx(i)]! : NaN;
  }
  horizPeakAt(i: number): number {
    return this.has(i) ? this.horizPeak[this.idx(i)]! : NaN;
  }
  magPeakAt(i: number): number {
    return this.has(i) ? this.magPeak[this.idx(i)]! : NaN;
  }
  headingAt(i: number): number {
    return this.has(i) ? this.heading[this.idx(i)]! : NaN;
  }
  tSecAt(i: number): number {
    return this.has(i) ? this.tSec[this.idx(i)]! : NaN;
  }
  latAt(i: number): number {
    return this.has(i) ? this.lat[this.idx(i)]! : NaN;
  }
  lonAt(i: number): number {
    return this.has(i) ? this.lon[this.idx(i)]! : NaN;
  }
  micRmsAt(i: number): number {
    return this.has(i) ? this.micRms[this.idx(i)]! : NaN;
  }
  micPeakAt(i: number): number {
    return this.has(i) ? this.micPeak[this.idx(i)]! : NaN;
  }
  flagsAt(i: number): number {
    return this.has(i) ? this.flags[this.idx(i)]! : 0;
  }
  seqAt(i: number): number {
    return this.has(i) ? this.seq[this.idx(i)]! : NaN;
  }
  telemetryIdAt(i: number): number {
    return this.has(i) ? this.telemetryId[this.idx(i)]! : NaN;
  }

  hasFlagAt(i: number, f: number): boolean {
    return (this.flagsAt(i) & f) !== 0;
  }

  /**
   * Logical offsets covering the last `seconds` of resolved time, newest first.
   * Stops early at a time discontinuity so a data gap never silently widens the
   * window across a reboot.
   */
  windowIndices(seconds: number): number[] {
    const out: number[] = [];
    if (this.size === 0) return out;
    const t0 = this.tSecAt(0);
    for (let i = 0; i < this.size; i++) {
      const t = this.tSecAt(i);
      if (!Number.isFinite(t)) break;
      if (t0 - t > seconds) break;
      out.push(i);
    }
    return out;
  }

  /** Collect telemetry ids over a set of logical offsets, oldest-first. */
  telemetryIdsOver(indices: number[]): number[] {
    return indices
      .slice()
      .sort((a, b) => b - a)
      .map((i) => this.telemetryIdAt(i))
      .filter((v) => Number.isFinite(v));
  }

  reset(): void {
    this.head = -1;
    this.size = 0;
    this.flags.fill(0);
  }
}

/** Tracks an in-progress threshold excursion so one brake emits one event (§6.1). */
export interface Excursion {
  active: boolean;
  /** Peak signed value seen so far. */
  peak: number;
  peakSeq: number;
  peakTSec: number;
  peakLat: number | null;
  peakLon: number | null;
  peakSpeed: number;
  startTSec: number;
  telemetryIds: number[];
  /** Whether the accelerometer corroborated the peak sample (§6.1). */
  corroborated: boolean;
}

export function newExcursion(): Excursion {
  return {
    active: false,
    peak: 0,
    peakSeq: 0,
    peakTSec: 0,
    peakLat: null,
    peakLon: null,
    peakSpeed: 0,
    startTSec: 0,
    telemetryIds: [],
    corroborated: false,
  };
}

/**
 * Everything the engine remembers about one device between rows.
 *
 * Split deliberately: `ring` is what pure detectors read; `scratch` holds the
 * mutable cross-row bookkeeping that detectors are allowed to update (baselines,
 * excursion state, timers). Both are serialisable so the replay harness can
 * assert byte-identical intermediate state (§11, Phase 1 gate).
 */
export interface DeviceState {
  deviceId: string;
  meta: DeviceMeta;
  ring: DeviceRing;

  /** Current boot identity — `${deviceId}:${firstUptimeAnchor}`. */
  bootId: string;
  lastSeq: number;
  lastUptimeMs: number;

  /** Timeline resolver anchor: UTC epoch seconds matching `anchorUptimeMs`. */
  anchorTSec: number | null;
  anchorUptimeMs: number | null;
  lastTimeQuality: TimeQuality;

  /** Trip bookkeeping. */
  trip: Trip | null;
  tripEvents: ScorableEvent[];
  calibrationStaleCount: number;
  movingSinceTSec: number | null;
  stationarySinceTSec: number | null;
  lastRowTSec: number | null;
  /** Last usable fix, for the next distance step and for closing across a gap. */
  lastTripLat: number | null;
  lastTripLon: number | null;

  /** Fatigue: continuous moving seconds since the last qualifying stop. */
  continuousMovingS: number;
  lastFatigueEmitS: number;
  /** Idle accumulator. */
  idleSinceTSec: number | null;
  lastIdleEmitTSec: number | null;
  /** Re-arm guard so one weave emits one event, not one per sample (§6.3). */
  lastSwerveEmitTSec: number | null;

  /** Adaptive baselines (§6.4). NaN until seeded. */
  vertBaseline: number;
  micBaseline: number;
  /** Parked-ambient mic floor, learned while stationary. */
  micAmbient: number;

  /** Excursion trackers, keyed so each detector owns its own. */
  brakeExcursion: Excursion;
  accelExcursion: Excursion;
  corneringExcursion: Excursion;

  /** Integrity bookkeeping. */
  lastGravityRef: RawVec3 | null;
  calibrationStaleSinceTSec: number | null;
  gpsDegradedSinceTSec: number | null;
  /**
   * Reboot handoff. `normalize()` detects the reboot and flushes state before any
   * detector runs, so the decrease is no longer visible in the ring by the time
   * the integrity detector is called. It leaves the facts here instead; the
   * detector consumes and clears them. Deterministic, so replay reproduces it.
   */
  pendingRebootEvent: {
    previousSeq: number;
    previousUptimeMs: number;
    previousBootId: string;
    trigger: 'seq_decrease' | 'uptime_decrease';
  } | null;
  /** Emit guards, so a sustained condition reports once per episode. */
  lastCalibrationStaleEmitTSec: number | null;
  lastSensorDegradedEmitTSec: number | null;
  lastGpsDegradedEmitTSec: number | null;
  stuckRawCount: number;
  lastAccelRaw: RawVec3 | null;
  lastCalibrationState: CalibrationState;
  lastDroppedPosts: number | null;

  /**
   * H3 index of the newest sample's position, published by the road map layer
   * (§7.1) so detectors can key fleet statistics without importing h3-js or
   * depending on the arbitration layer. Null when there is no usable fix.
   */
  lastH3: string | null;

  /** Cells already warned about this trip, so a hazard is not re-issued (§7.4 step 6). */
  predictedCells: Set<string>;
  lastPredictTSec: number | null;

  /** Eviction bookkeeping — devices idle > 30 min are dropped (§9). */
  lastSeenWallMs: number;
}

export function newDeviceState(meta: DeviceMeta, nowWallMs: number): DeviceState {
  return {
    deviceId: meta.deviceId,
    meta,
    ring: new DeviceRing(),
    bootId: '',
    lastSeq: -1,
    lastUptimeMs: -1,
    anchorTSec: null,
    anchorUptimeMs: null,
    lastTimeQuality: 'server',
    trip: null,
    tripEvents: [],
    calibrationStaleCount: 0,
    movingSinceTSec: null,
    stationarySinceTSec: null,
    lastRowTSec: null,
    lastTripLat: null,
    lastTripLon: null,
    continuousMovingS: 0,
    lastFatigueEmitS: 0,
    idleSinceTSec: null,
    lastIdleEmitTSec: null,
    lastSwerveEmitTSec: null,
    vertBaseline: NaN,
    micBaseline: NaN,
    micAmbient: NaN,
    brakeExcursion: newExcursion(),
    accelExcursion: newExcursion(),
    corneringExcursion: newExcursion(),
    lastGravityRef: null,
    calibrationStaleSinceTSec: null,
    gpsDegradedSinceTSec: null,
    pendingRebootEvent: null,
    lastCalibrationStaleEmitTSec: null,
    lastSensorDegradedEmitTSec: null,
    lastGpsDegradedEmitTSec: null,
    stuckRawCount: 0,
    lastAccelRaw: null,
    lastCalibrationState: 'uncalibrated',
    lastDroppedPosts: null,
    lastH3: null,
    predictedCells: new Set(),
    lastPredictTSec: null,
    lastSeenWallMs: nowWallMs,
  };
}

/**
 * Clear everything that cannot survive a reboot, keeping identity and learned
 * baselines. Called when `seq` or `uptime_ms` decreases (§2.6, §6.7).
 */
export function flushOnReboot(st: DeviceState, newBootId: string): void {
  st.ring.reset();
  st.bootId = newBootId;
  st.lastSeq = -1;
  st.lastUptimeMs = -1;
  st.anchorTSec = null;
  st.anchorUptimeMs = null;
  st.movingSinceTSec = null;
  st.stationarySinceTSec = null;
  st.brakeExcursion = newExcursion();
  st.accelExcursion = newExcursion();
  st.corneringExcursion = newExcursion();
  st.calibrationStaleSinceTSec = null;
  st.gpsDegradedSinceTSec = null;
  // Emit guards are per-episode, and a reboot ends every episode. Not clearing
  // these would suppress the first post-reboot report of a condition that is
  // still present. `pendingRebootEvent` is deliberately NOT cleared — the caller
  // sets it immediately before calling this, for the integrity detector to consume.
  st.lastCalibrationStaleEmitTSec = null;
  st.lastSensorDegradedEmitTSec = null;
  st.lastGpsDegradedEmitTSec = null;
  st.lastSwerveEmitTSec = null;
  st.lastH3 = null;
  st.stuckRawCount = 0;
  st.lastAccelRaw = null;
  st.lastGravityRef = null;
  // vertBaseline / micBaseline / micAmbient intentionally survive: the physical
  // vehicle and mount are unchanged by a firmware reboot.
}

/** EWMA update that seeds itself on first use. */
export function ewma(prev: number, x: number, alpha: number): number {
  if (!Number.isFinite(x)) return prev;
  if (!Number.isFinite(prev)) return x;
  return prev + alpha * (x - prev);
}

/** Smallest signed difference between two headings, degrees, in [-180, 180]. */
export function headingDelta(a: number, b: number): number {
  let d = ((a - b + 180) % 360) - 180;
  if (d < -180) d += 360;
  return d;
}

/** Great-circle distance in metres. */
export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const p = Math.PI / 180;
  const dLat = (lat2 - lat1) * p;
  const dLon = (lon2 - lon1) * p;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 8 x 45° sectors, 0 = north-centred (§7.1). */
export function headingSector(headingDeg: number, sectors = 8): number {
  if (!Number.isFinite(headingDeg)) return 0;
  const width = 360 / sectors;
  const shifted = (((headingDeg + width / 2) % 360) + 360) % 360;
  return Math.floor(shifted / width) % sectors;
}

export { Flags };
