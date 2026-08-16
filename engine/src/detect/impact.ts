/**
 * Impact / pothole candidates — ENGINE-PLAN §6.4.
 *
 * The most important thing in this file is what it does *not* decide.
 *
 * §6.4: "An impact candidate is **not** an event yet. It goes to arbitration
 * (§7.3), which decides whether it becomes `driver.avoidable_impact` or
 * `road.defect_observation`. This is the project's central contribution and it
 * must be visibly the same code path for both outcomes."
 *
 * So this detector emits `road.impact_candidate` with category 'road' and
 * `attributedToDriver: false` for every impact, without exception. Arbitration
 * rewrites the type. A driver is never blamed here, because here we cannot know.
 */

import type { EventCandidate, EventSeverity } from '../types.js';
import { Flags } from '../types.js';
import type { Thresholds } from '../config/thresholds.js';
import type { Detector, DetectorContext } from './context.js';
import { baseCandidate, clamp01 } from './context.js';
import { ewma } from '../domain/state.js';

/**
 * Speed-normalise a vertical RMS to the reference speed — §7.2.
 *
 *   rms_norm = rms_obs · (v_ref / max(v_obs, v_floor))^β
 *
 * Vertical vibration rises with speed over the same surface, so an un-normalised
 * baseline drifts down in traffic and every pothole looks bigger once the vehicle
 * speeds up again. Normalising *before* the EWMA keeps the baseline a property of
 * the road-and-vehicle rather than of the current speed.
 *
 * NOTE ON OWNERSHIP: `src/arbitrate/roadmap.ts` holds the authoritative copy used
 * for the fleet map, where β is fitted empirically per fleet (§7.2 calls that a
 * reportable calibration result). This local copy exists so the impact detector
 * stays a pure function with no dependency on the arbitration layer. Both read β
 * from the same `cfg.roadmap`, so they cannot silently diverge.
 */
export function speedNormalise(rms: number, speedMps: number, cfg: Thresholds): number {
  if (!Number.isFinite(rms)) return NaN;
  const { speedRefMps, speedFloorMps, beta } = cfg.roadmap;
  const v = Math.max(Number.isFinite(speedMps) ? speedMps : 0, speedFloorMps);
  return rms * Math.pow(speedRefMps / v, beta);
}

/**
 * Severity from the vertical peak, with the §2.4 censoring rule applied.
 *
 * "Impact detection is reliable; impact severity is right-censored." At ±2 g with
 * ~1 g consumed by gravity there is only ~1 g of upward headroom, so a real
 * pothole rails the axis. We therefore CAP severity at 'high' when clipped and
 * never extrapolate past the rail — a censored 0.8 g reading might be 1 g or
 * 5 g and we have no way to tell.
 */
function severityFor(peak: number, censored: boolean, cfg: Thresholds): EventSeverity {
  const floor = cfg.impact.absoluteFloor;
  let sev: EventSeverity;
  if (peak >= floor * 2.2) sev = 'high';
  else if (peak >= floor * 1.6) sev = 'medium';
  else sev = 'low';

  // Cap, never extrapolate (§2.4). A clipped sample cannot justify 'critical'.
  if (censored && sev === 'high') return 'high';
  return sev;
}

export const impactDetector: Detector = {
  name: 'impact',
  run(ctx: DetectorContext): EventCandidate[] {
    const s = ctx.sample;
    const st = ctx.state;
    const cfg = ctx.cfg;

    // §2.5 hard rule: without a valid gravity vector the vertical/horizontal
    // decomposition is meaningless, so every accel-derived detector is
    // suppressed. The integrity suite reports why, instead of us inventing data.
    if ((s.flags & Flags.ACCEL_VALID) === 0) return [];
    if (!Number.isFinite(s.vertPeak) || !Number.isFinite(s.vertRms)) return [];

    const normRms = speedNormalise(s.vertRms, s.speed, cfg);

    // Baseline is learned only from passes fast enough to carry roughness
    // information (§7.2: "discard passes below ~15 km/h entirely").
    const learnable = s.speed >= cfg.roadmap.minPassSpeedMps;
    const baselineBefore = st.vertBaseline;
    if (learnable) {
      st.vertBaseline = ewma(st.vertBaseline, normRms, cfg.impact.baselineAlpha);
    }

    // Mic baselines: the ambient floor is learned while parked, the running
    // baseline while driving. Both feed corroboration only, never detection.
    if (Number.isFinite(s.micRms)) {
      st.micBaseline = ewma(st.micBaseline, s.micRms, cfg.impact.baselineAlpha);
      if (s.speed < cfg.duty.idleSpeed) {
        st.micAmbient = ewma(st.micAmbient, s.micRms, cfg.impact.baselineAlpha);
      }
    }

    // A baseline needs to exist before it can be exceeded. Until then the
    // absolute floor alone governs, so a pothole in the first seconds of a
    // drive is still caught.
    const base = Number.isFinite(baselineBefore) ? baselineBefore : NaN;
    const dynamicThreshold = Number.isFinite(base)
      ? Math.max(base * cfg.impact.baselineMultiplier, cfg.impact.absoluteFloor)
      : cfg.impact.absoluteFloor;

    if (!(s.vertPeak > dynamicThreshold)) return [];

    // An impact is a transient shock impulse, not a static steady-state tilt or inverted gravity offset.
    // If vertPeak is roughly equal to vertRms, the sensor is simply resting tilted or uncalibrated.
    if (Number.isFinite(s.vertRms) && s.vertRms > 2.0 && s.vertPeak <= s.vertRms * 1.25) return [];

    // In demo mode: ignore horizontal sliding friction that bleeds into the vertical axis.
    // An intentional pothole demo is a vertical desk tap where vertPeak dominates.
    if (cfg.demoMode && s.horizPeak > s.vertPeak * 1.5) return [];

    // §2.4 clipping check, on RAW COUNTS — the only reason normalize keeps them.
    const censored =
      s.rawVertPeakCounts > cfg.impact.clipCounts || s.rawMagPeakCounts > cfg.impact.clipCounts;

    // Mic corroboration (§6.4): a pothole makes a noise. Worth +0.15 confidence,
    // never required — the mic is a raw unitless ADC and relative only (§2.1).
    const micCorroborated =
      Number.isFinite(s.micPeak) &&
      Number.isFinite(st.micBaseline) &&
      s.micPeak > st.micBaseline * cfg.impact.micMultiplier;

    const ratio = Number.isFinite(base) && base > 0 ? s.vertPeak / base : NaN;
    let confidence = 0.5 + 0.2 * clamp01((s.vertPeak - dynamicThreshold) / dynamicThreshold);
    if (micCorroborated) confidence += cfg.impact.micConfidenceBonus;
    // A censored sample is a *more* certain impact but a less certain severity.
    if (censored) confidence += 0.1;

    const out: EventCandidate[] = [];

    out.push(
      baseCandidate(ctx, {
        type: 'road.impact_candidate',
        // Deliberately 'road' and unattributed: §6.4 forbids deciding blame here.
        category: 'road',
        severity: severityFor(s.vertPeak, censored, cfg),
        confidence: clamp01(confidence),
        attributedToDriver: false,
        magnitude: Number.parseFloat(s.vertPeak.toFixed(4)),
        magnitudeUnit: 'm/s2',
        severityCensored: censored,
        evidence: {
          rule: '§6.4 vertical_peak vs speed-normalised adaptive baseline',
          vertical_peak_mps2: Number.parseFloat(s.vertPeak.toFixed(4)),
          vertical_peak_g: Number.parseFloat((s.vertPeak / 9.80665).toFixed(4)),
          vertical_rms_mps2: Number.parseFloat(s.vertRms.toFixed(4)),
          vertical_rms_normalised_mps2: Number.isFinite(normRms)
            ? Number.parseFloat(normRms.toFixed(4))
            : null,
          baseline_mps2: Number.isFinite(base) ? Number.parseFloat(base.toFixed(4)) : null,
          baseline_seeded: Number.isFinite(base),
          threshold_mps2: Number.parseFloat(dynamicThreshold.toFixed(4)),
          ratio_to_baseline: Number.isFinite(ratio) ? Number.parseFloat(ratio.toFixed(3)) : null,
          mic_peak: Number.isFinite(s.micPeak) ? s.micPeak : null,
          mic_baseline: Number.isFinite(st.micBaseline)
            ? Number.parseFloat(st.micBaseline.toFixed(2))
            : null,
          mic_corroborated: micCorroborated,
          raw_vertical_peak_counts: s.rawVertPeakCounts,
          raw_magnitude_peak_counts: s.rawMagPeakCounts,
          clip_threshold_counts: cfg.impact.clipCounts,
          severity_censored: censored,
          censoring_note: censored
            ? 'accelerometer railed at the ±2 g limit; severity is a lower bound, not a measurement (§2.4)'
            : null,
          awaiting_arbitration: true,
          arbitration_note:
            'blame is not assigned here; §7.3 fleet consensus decides road.defect_observation vs driver.avoidable_impact',
          time_quality: s.timeQuality,
        },
      }),
    );

    // -----------------------------------------------------------------------
    // Collision heuristic — §2.7.
    //
    // "clipped magnitude + mic peak + speed collapse to ~0. Detectable, but
    // severity unquantifiable — treat as an alert, not a score input."
    //
    // Enforced twice over: weight 0 in `cfg.scoring.weights`, and category
    // 'driver' but severity 'critical' with an explicit not-for-scoring note.
    // -----------------------------------------------------------------------
    const r = st.ring;
    const speedBefore = r.speedAt(1);
    const collapsed =
      Number.isFinite(speedBefore) &&
      speedBefore > cfg.gps.minSpeedForDynamics &&
      s.speed < cfg.impact.collisionSpeedCollapse;

    if (censored && collapsed && micCorroborated) {
      out.push(
        baseCandidate(ctx, {
          type: 'driver.collision_suspected',
          category: 'driver',
          severity: 'critical',
          confidence: clamp01(0.5),
          // An alert, not a penalty. Weight 0 in §8 keeps it out of the score.
          attributedToDriver: false,
          magnitude: Number.parseFloat(s.magPeak.toFixed(4)),
          magnitudeUnit: 'm/s2',
          severityCensored: true,
          evidence: {
            rule: '§2.7 collision: clipped magnitude + mic peak + speed collapse',
            speed_before_mps: Number.parseFloat(speedBefore.toFixed(3)),
            speed_after_mps: Number.parseFloat(s.speed.toFixed(3)),
            magnitude_peak_mps2: Number.parseFloat(s.magPeak.toFixed(4)),
            mic_corroborated: micCorroborated,
            severity_unquantifiable: true,
            scoring_note: 'alert only; weight 0 in §8 — severity cannot be quantified from clipped data',
            time_quality: s.timeQuality,
          },
          telemetryIds: [r.telemetryIdAt(1), s.telemetryId].filter((v) => Number.isFinite(v)),
        }),
      );
    }

    return out;
  },
};

export default impactDetector;
