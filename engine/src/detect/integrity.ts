/**
 * Integrity suite — ENGINE-PLAN §6.7, all seven rules.
 *
 * The governing constraint, from §6.7 and restated in §8:
 *
 *   "Integrity events never penalise the driver. They gate other detectors and
 *    they mark trips as low-confidence for the report."
 *
 * Every candidate here is category 'integrity' with `attributedToDriver: false`,
 * and §8's penalty model excludes the whole category in one place. A device fault
 * is not driver behaviour, and conflating the two would make the fairness claim
 * (the project's central contribution) untrue at the first flat battery.
 */

import type { EventCandidate, EventSeverity, RawVec3 } from '../types.js';
import { Flags } from '../types.js';
import type { Detector, DetectorContext } from './context.js';
import { baseCandidate } from './context.js';
import { RAD2DEG } from '../config/thresholds.js';

/**
 * Angle between two gravity reference vectors, degrees.
 *
 * §6.7 mount_shift: "angle between successive calibrated `gravity_ref` vectors
 * > ~15° (tamper or slipped mount)". Returns NaN for a zero-length vector rather
 * than dividing by zero and reporting a spurious 90°.
 */
export function vectorAngleDeg(a: RawVec3, b: RawVec3): number {
  const na = Math.hypot(a.x, a.y, a.z);
  const nb = Math.hypot(b.x, b.y, b.z);
  if (!(na > 0) || !(nb > 0)) return NaN;
  const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (na * nb);
  return Math.acos(Math.max(-1, Math.min(1, dot))) * RAD2DEG;
}

function gapSeverity(gapS: number): EventSeverity {
  if (gapS >= 300) return 'high';
  if (gapS >= 60) return 'medium';
  if (gapS >= 10) return 'low';
  return 'info';
}

function integrity(
  ctx: DetectorContext,
  type: EventCandidate['type'],
  severity: EventSeverity,
  confidence: number,
  evidence: Record<string, unknown>,
  extra: Partial<EventCandidate> = {},
): EventCandidate {
  return baseCandidate(ctx, {
    type,
    category: 'integrity',
    severity,
    confidence,
    // Never, under any circumstances, attributed to the driver.
    attributedToDriver: false,
    evidence: { ...evidence, never_penalises_driver: true, time_quality: ctx.sample.timeQuality },
    ...extra,
  });
}

export const integrityDetector: Detector = {
  name: 'integrity',
  run(ctx: DetectorContext): EventCandidate[] {
    const s = ctx.sample;
    const st = ctx.state;
    const cfg = ctx.cfg;
    const r = st.ring;
    const out: EventCandidate[] = [];

    // -----------------------------------------------------------------------
    // 1. device_reboot — `seq` or `uptime_ms` decreased.
    //
    // normalize() already detected this, reset the ring and minted a new
    // bootId before we were called, so the ring cannot show us the decrease.
    // We read the flag it left on the state instead. This is the one input this
    // detector takes from outside the ring, and it is recorded on the sample so
    // replay reproduces it identically.
    // -----------------------------------------------------------------------
    if (st.pendingRebootEvent !== null) {
      const p = st.pendingRebootEvent;
      st.pendingRebootEvent = null;
      out.push(
        integrity(ctx, 'integrity.device_reboot', 'low', 0.95, {
          rule: '§6.7 device_reboot: seq or uptime_ms decreased',
          previous_seq: p.previousSeq,
          new_seq: s.seq,
          previous_uptime_ms: p.previousUptimeMs,
          new_uptime_ms: s.uptimeMs,
          previous_boot_id: p.previousBootId,
          new_boot_id: s.bootId,
          trigger: p.trigger,
          consequence: 'ring buffer, excursion trackers and time anchors flushed; open trip closed',
        }),
      );
    }

    // -----------------------------------------------------------------------
    // 2. data_gap — `seq` jump > 1, or resolved-time gap > 3 s.
    // -----------------------------------------------------------------------
    const prevSeq = r.seqAt(1);
    const prevT = r.tSecAt(1);
    if (Number.isFinite(prevSeq) && Number.isFinite(prevT)) {
      const seqJump = s.seq - prevSeq;
      const timeGap = s.tSec - prevT;
      // A seq jump and a time gap are two views of the same loss; report once,
      // preferring whichever is larger as the magnitude.
      if (seqJump > 1 || timeGap > cfg.integrity.gapS) {
        const missing = Math.max(0, seqJump - 1);
        out.push(
          integrity(
            ctx,
            'integrity.data_gap',
            gapSeverity(timeGap),
            0.9,
            {
              rule: '§6.7 data_gap: seq jump > 1 or resolved-time gap > 3 s',
              seq_jump: seqJump,
              missing_rows: missing,
              time_gap_s: Number.parseFloat(timeGap.toFixed(3)),
              threshold_s: cfg.integrity.gapS,
              // §12 ask #6: a device-reported counter would make this exact
              // rather than inferred.
              device_reported_dropped_posts: s.droppedPosts,
            },
            {
              magnitude: Number.parseFloat(Math.max(timeGap, missing).toFixed(3)),
              magnitudeUnit: timeGap >= missing ? 's' : 'rows',
            },
          ),
        );

        // -------------------------------------------------------------------
        // 3. upload_loss — weak WiFi correlated with the gap.
        //
        // §6.7: "wifi_rssi < -85 correlated with seq gaps (device-side queue
        // shedding)". The firmware queue is 4 deep and drops silently (§3), so a
        // gap during weak signal is almost certainly shed uploads rather than a
        // sensor fault — a materially different diagnosis.
        // -------------------------------------------------------------------
        if (Number.isFinite(s.wifiRssi) && s.wifiRssi < cfg.integrity.weakRssi) {
          out.push(
            integrity(ctx, 'integrity.upload_loss', gapSeverity(timeGap), 0.7, {
              rule: '§6.7 upload_loss: weak RSSI correlated with a seq gap',
              wifi_rssi: s.wifiRssi,
              threshold_rssi: cfg.integrity.weakRssi,
              missing_rows: missing,
              time_gap_s: Number.parseFloat(timeGap.toFixed(3)),
              cause: 'device-side post queue is 4 deep and drops on overflow (§3); firmware ask #5 would make this recoverable',
            }),
          );
        }
      }
    }

    // -----------------------------------------------------------------------
    // 4. mount_shift — the gravity reference moved.
    // -----------------------------------------------------------------------
    const calibrated = (s.flags & Flags.CALIBRATED) !== 0;
    if (calibrated && s.gravityRef !== null) {
      const prev = st.lastGravityRef;
      if (prev !== null) {
        const angle = vectorAngleDeg(prev, s.gravityRef);
        if (Number.isFinite(angle) && angle > cfg.integrity.mountShiftDeg) {
          out.push(
            integrity(
              ctx,
              'integrity.mount_shift',
              angle > cfg.integrity.mountShiftDeg * 3 ? 'high' : 'medium',
              0.8,
              {
                rule: '§6.7 mount_shift: angle between successive calibrated gravity_ref vectors > 15°',
                angle_deg: Number.parseFloat(angle.toFixed(2)),
                threshold_deg: cfg.integrity.mountShiftDeg,
                previous_gravity_ref: prev,
                new_gravity_ref: s.gravityRef,
                interpretation: 'tamper or slipped mount; the vertical/horizontal decomposition before this point described a different axis',
              },
              {
                magnitude: Number.parseFloat(angle.toFixed(2)),
                magnitudeUnit: 'deg',
              },
            ),
          );
        }
      }
      st.lastGravityRef = s.gravityRef;
    }

    // -----------------------------------------------------------------------
    // 5. calibration_stale — §2.5's gate, reported rather than hidden.
    //
    // "Emit integrity.calibration_stale instead of silently producing garbage
    // events." This is the event that explains an absence of impact events.
    // -----------------------------------------------------------------------
    const moving = s.speed >= cfg.trip.startSpeed;
    if (!calibrated) {
      if (st.calibrationStaleSinceTSec === null && moving) {
        st.calibrationStaleSinceTSec = s.tSec;
      }
    } else {
      st.calibrationStaleSinceTSec = null;
    }

    const staleFor =
      st.calibrationStaleSinceTSec !== null ? s.tSec - st.calibrationStaleSinceTSec : 0;
    const ageStale = s.calibrationAgeMs > cfg.integrity.calibrationMaxAgeMs;

    if ((staleFor >= cfg.integrity.calibrationStaleS || (calibrated && ageStale)) &&
        st.lastCalibrationStaleEmitTSec !== st.calibrationStaleSinceTSec) {
      st.lastCalibrationStaleEmitTSec = st.calibrationStaleSinceTSec;
      out.push(
        integrity(ctx, 'integrity.calibration_stale', 'medium', 0.9, {
          rule: "§6.7 calibration_stale: state != 'calibrated' for > 300 s of driving, or age_ms > 3 600 000",
          calibration_state: s.calibrationState,
          stale_for_s: Number.parseFloat(staleFor.toFixed(1)),
          threshold_s: cfg.integrity.calibrationStaleS,
          calibration_age_ms: s.calibrationAgeMs,
          max_age_ms: cfg.integrity.calibrationMaxAgeMs,
          consequence:
            'every accel_cal/gyro_cal-derived detector is suppressed while this holds (§2.5); GPS-only detectors stay live',
        }),
      );
    }

    // -----------------------------------------------------------------------
    // 6. sensor_degraded — the 50 Hz loop is starving, or an axis is stuck.
    // -----------------------------------------------------------------------
    const reasons: string[] = [];
    if (s.samples > 0 && s.samples < cfg.integrity.minSamples) {
      reasons.push(`samples=${s.samples} < ${cfg.integrity.minSamples}`);
    }

    // Identical raw accelerometer readings across successive rows means the axis
    // is not being read at all. Real 50 Hz data never repeats exactly.
    const raw = s.accelRaw;
    if (raw !== null) {
      const prev = st.lastAccelRaw;
      if (prev !== null && prev.x === raw.x && prev.y === raw.y && prev.z === raw.z) {
        st.stuckRawCount++;
      } else {
        st.stuckRawCount = 0;
      }
      st.lastAccelRaw = raw;
      if (st.stuckRawCount >= cfg.integrity.stuckRawRows) {
        reasons.push(`identical accel_raw across ${st.stuckRawCount + 1} rows`);
      }
    }

    // Mic flatline: a working ADC on a moving vehicle always has some variance.
    if (moving && r.size >= 10) {
      const idx = r.windowIndices(10);
      let min = Infinity;
      let max = -Infinity;
      let n = 0;
      for (const i of idx) {
        const v = r.micRmsAt(i);
        if (!Number.isFinite(v)) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
        n++;
      }
      if (n >= 8 && max - min === 0) reasons.push('mic RMS variance is exactly zero over 10 s while moving');
    }

    if (reasons.length > 0 && st.lastSensorDegradedEmitTSec === null) {
      st.lastSensorDegradedEmitTSec = s.tSec;
      out.push(
        integrity(ctx, 'integrity.sensor_degraded', 'medium', 0.75, {
          rule: '§6.7 sensor_degraded: samples < 40, stuck accel_raw, or mic flatline',
          reasons,
          samples: s.samples,
          min_samples: cfg.integrity.minSamples,
          stuck_raw_rows: st.stuckRawCount,
        }),
      );
    } else if (reasons.length === 0) {
      st.lastSensorDegradedEmitTSec = null;
    }

    // -----------------------------------------------------------------------
    // 7. gps_degraded — a fix that should exist but does not, or is unusable.
    // -----------------------------------------------------------------------
    const fix = (s.flags & Flags.GPS_FIX) !== 0;
    const impossible = !fix && s.sats > 4;
    const poorHdop = fix && s.hdop > cfg.gps.degradedHdop;

    if (impossible || poorHdop) {
      if (st.gpsDegradedSinceTSec === null) st.gpsDegradedSinceTSec = s.tSec;
      const degradedFor = s.tSec - st.gpsDegradedSinceTSec;
      const sustained = degradedFor >= cfg.gps.degradedSustainedS;
      if (sustained && st.lastGpsDegradedEmitTSec !== st.gpsDegradedSinceTSec) {
        st.lastGpsDegradedEmitTSec = st.gpsDegradedSinceTSec;
        out.push(
          integrity(ctx, 'integrity.gps_degraded', 'low', 0.8, {
            rule: '§6.7 gps_degraded: fix == false while sats > 4, or hdop > 5 sustained',
            fix,
            sats: s.sats,
            hdop: Number.isFinite(s.hdop) ? s.hdop : null,
            hdop_threshold: cfg.gps.degradedHdop,
            sustained_for_s: Number.parseFloat(degradedFor.toFixed(1)),
            trigger: impossible ? 'no fix despite sats > 4' : 'hdop above threshold',
            consequence:
              'longitudinal, cornering and speeding detectors are gated off; position is not trusted for the road map',
          }),
        );
      }
    } else {
      st.gpsDegradedSinceTSec = null;
      st.lastGpsDegradedEmitTSec = null;
    }

    return out;
  },
};

export default integrityDetector;
