/**
 * Idling and fatigue — ENGINE-PLAN §6.6.
 *
 * Both are honest about their weakness. §2.7 rates idling "⚠️ low confidence"
 * because there is no engine state on the bus: a stationary vehicle with the
 * engine off and one stuck in traffic look identical to this sensor set. So the
 * detector caps its own confidence rather than pretending otherwise.
 *
 * Fatigue, by contrast, needs no sensor at all — it is trip bookkeeping, which
 * is why §2.7 rates it ✅.
 */

import type { EventCandidate, EventSeverity } from '../types.js';
import { Flags } from '../types.js';
import type { Detector, DetectorContext } from './context.js';
import { baseCandidate, clamp01 } from './context.js';

function idleSeverity(durationS: number, cfg: DetectorContext['cfg']): EventSeverity {
  const base = cfg.duty.idleSustainedS;
  if (durationS >= base * 6) return 'high';
  if (durationS >= base * 3) return 'medium';
  return 'low';
}

export const dutyDetector: Detector = {
  name: 'duty',
  run(ctx: DetectorContext): EventCandidate[] {
    const s = ctx.sample;
    const st = ctx.state;
    const cfg = ctx.cfg;
    const out: EventCandidate[] = [];

    const moving = s.speed >= cfg.duty.idleSpeed;
    const prevTSec = st.lastRowTSec;
    const dt = prevTSec !== null && s.tSec > prevTSec ? Math.min(s.tSec - prevTSec, 5) : 0;

    // ---------------------------------------------------------------------
    // Idling (§6.6)
    // ---------------------------------------------------------------------
    if (!moving) {
      if (st.idleSinceTSec === null) st.idleSinceTSec = s.tSec;
      const idleFor = s.tSec - st.idleSinceTSec;

      const alreadyEmitted =
        st.lastIdleEmitTSec !== null && st.lastIdleEmitTSec >= st.idleSinceTSec;

      if (idleFor >= cfg.duty.idleSustainedS && !alreadyEmitted) {
        // Mic above the parked-ambient floor suggests an engine is actually
        // running, which is the only evidence available that this is idling
        // rather than simply being parked (§6.6).
        const micElevated =
          Number.isFinite(s.micRms) &&
          Number.isFinite(st.micAmbient) &&
          s.micRms > st.micAmbient * 1.2;

        st.lastIdleEmitTSec = s.tSec;
        out.push(
          baseCandidate(ctx, {
            type: 'driver.excessive_idling',
            category: 'driver',
            severity: idleSeverity(idleFor, cfg),
            // Hard-capped: no engine state exists, so certainty is impossible.
            confidence: clamp01(micElevated ? cfg.duty.idleMicConfidence : cfg.duty.idleBaseConfidence),
            magnitude: Number.parseFloat(idleFor.toFixed(1)),
            magnitudeUnit: 's',
            evidence: {
              rule: '§6.6 idling: speed < 2 km/h sustained, device powered',
              idle_duration_s: Number.parseFloat(idleFor.toFixed(1)),
              threshold_s: cfg.duty.idleSustainedS,
              speed_mps: Number.parseFloat(s.speed.toFixed(3)),
              mic_rms: Number.isFinite(s.micRms) ? s.micRms : null,
              mic_ambient: Number.isFinite(st.micAmbient)
                ? Number.parseFloat(st.micAmbient.toFixed(2))
                : null,
              mic_elevated: micElevated,
              limitation:
                'no engine state on the bus (§2.7); a parked vehicle and a running-but-stopped one are indistinguishable. Confidence capped accordingly.',
              time_quality: s.timeQuality,
            },
          }),
        );
      }
    } else {
      st.idleSinceTSec = null;
    }

    // ---------------------------------------------------------------------
    // Fatigue / continuous driving (§6.6)
    // ---------------------------------------------------------------------
    if (moving && (s.flags & Flags.GPS_FIX) !== 0) {
      st.continuousMovingS += dt;
    } else if (!moving) {
      // A stop long enough to count as a break resets the clock.
      const stoppedFor = st.idleSinceTSec !== null ? s.tSec - st.idleSinceTSec : 0;
      if (stoppedFor >= cfg.duty.fatigueResetStopS) {
        st.continuousMovingS = 0;
        st.lastFatigueEmitS = 0;
      }
    }

    if (st.continuousMovingS >= cfg.duty.fatigueMovingS) {
      // Escalate once per further interval, so a 4-hour drive produces a
      // sequence of increasingly severe events rather than one or hundreds.
      const over = st.continuousMovingS - cfg.duty.fatigueMovingS;
      const step = Math.floor(over / cfg.duty.fatigueEscalationS);
      const marker = cfg.duty.fatigueMovingS + step * cfg.duty.fatigueEscalationS;

      if (st.lastFatigueEmitS < marker) {
        st.lastFatigueEmitS = marker;
        const severity: EventSeverity = step >= 2 ? 'high' : step >= 1 ? 'medium' : 'low';
        out.push(
          baseCandidate(ctx, {
            type: 'driver.continuous_driving',
            category: 'driver',
            severity,
            confidence: 0.9,
            magnitude: Number.parseFloat(st.continuousMovingS.toFixed(1)),
            magnitudeUnit: 's',
            evidence: {
              rule: '§6.6 fatigue: moving_s > 7200 with no stop >= 300 s, escalating hourly',
              continuous_moving_s: Number.parseFloat(st.continuousMovingS.toFixed(1)),
              threshold_s: cfg.duty.fatigueMovingS,
              escalation_step: step,
              reset_stop_s: cfg.duty.fatigueResetStopS,
              time_quality: s.timeQuality,
            },
          }),
        );
      }
    }

    return out;
  },
};

export default dutyDetector;
