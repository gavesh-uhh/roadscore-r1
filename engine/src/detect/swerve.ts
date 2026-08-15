/**
 * Swerving / erratic steering — ENGINE-PLAN §6.3.
 *
 * The interesting constraint: `yaw_rate_peak` is unsigned, so left-right-left
 * alternation — the actual signature of weaving — is invisible. §2.7 calls this
 * a "⚠️ workaround" and §6.3 gives the geometry that recovers it:
 *
 *   turning a lot (large accumulated |ω|) while going nowhere (small net
 *   heading change) = weaving.
 *
 * A genuine turn accumulates yaw AND changes heading. A lane change accumulates
 * yaw and returns to the original heading, but only once. Weaving does it
 * repeatedly, which is why the excursion count is part of the rule.
 */

import type { EventCandidate, EventSeverity } from '../types.js';
import { Flags } from '../types.js';
import type { Detector, DetectorContext } from './context.js';
import { baseCandidate, clamp01 } from './context.js';
import { headingDelta } from '../domain/state.js';
import { DEG2RAD, RAD2DEG } from '../config/thresholds.js';

interface SwerveWindow {
  /** Σ|ω|·Δt over the window, radians. */
  integratedYaw: number;
  /** |net Δheading| across the window, radians. */
  netHeadingChange: number;
  /** Count of separate yaw excursions above the excursion threshold. */
  excursions: number;
  minSpeed: number;
  indices: number[];
  spanS: number;
}

/**
 * Measure the window. Exported so a test can assert the geometry directly
 * without going through the event machinery.
 */
export function measureSwerveWindow(ctx: DetectorContext): SwerveWindow | null {
  const r = ctx.state.ring;
  const t = ctx.cfg.swerve;

  // `windowIndices` stops at a time discontinuity, so a data gap can never
  // silently widen the window across a reboot (§2.6).
  const idx = r.windowIndices(t.windowS);
  if (idx.length < 3) return null;

  let integratedYaw = 0;
  let excursions = 0;
  let inExcursion = false;
  let minSpeed = Infinity;

  for (const i of idx) {
    if (!r.hasFlagAt(i, Flags.GYRO_VALID) || !r.hasFlagAt(i, Flags.GPS_USABLE)) return null;

    const w = r.yawRateAt(i);
    const speed = r.speedAt(i);
    if (!Number.isFinite(w) || !Number.isFinite(speed)) return null;
    minSpeed = Math.min(minSpeed, speed);

    // Δt to the next-older sample; the oldest slot uses the nominal 1 Hz period.
    const older = r.tSecAt(i + 1);
    const dt = Number.isFinite(older) ? r.tSecAt(i) - older : 1;
    if (dt > 0 && dt < 5) integratedYaw += w * dt;

    // A contiguous run above the excursion threshold counts once.
    if (w > ctx.cfg.swerve.excursionYaw) {
      if (!inExcursion) {
        excursions++;
        inExcursion = true;
      }
    } else {
      inExcursion = false;
    }
  }

  const newest = idx[0];
  const oldest = idx[idx.length - 1];
  if (newest === undefined || oldest === undefined) return null;

  const hNew = r.headingAt(newest);
  const hOld = r.headingAt(oldest);
  if (!Number.isFinite(hNew) || !Number.isFinite(hOld)) return null;

  const spanS = r.tSecAt(newest) - r.tSecAt(oldest);
  if (!(spanS > 0)) return null;

  return {
    integratedYaw,
    netHeadingChange: Math.abs(headingDelta(hNew, hOld)) * DEG2RAD,
    excursions,
    minSpeed,
    indices: idx,
    spanS,
  };
}

function severityFor(ratio: number, excursions: number): EventSeverity {
  if (ratio >= 8 || excursions >= 6) return 'high';
  if (ratio >= 5 || excursions >= 4) return 'medium';
  return 'low';
}

export const swerveDetector: Detector = {
  name: 'swerve',
  run(ctx: DetectorContext): EventCandidate[] {
    const t = ctx.cfg.swerve;
    const m = measureSwerveWindow(ctx);
    if (m === null) return [];

    // All four conditions from §6.3 must hold together.
    if (!(m.integratedYaw > t.minIntegratedYaw)) return [];
    if (!(m.netHeadingChange < t.maxNetHeadingChange)) return [];
    if (!(m.minSpeed > t.minSpeed)) return [];
    if (!(m.excursions >= t.minExcursions)) return [];

    // Re-arming: one weave emits one event, not one per sample for the whole
    // 8 s window. The window must clear before the next event can fire.
    const last = ctx.state.lastSwerveEmitTSec;
    if (last !== null && ctx.sample.tSec - last < t.windowS) return [];
    ctx.state.lastSwerveEmitTSec = ctx.sample.tSec;

    // §6.3: "Confidence scales with the ratio Σ|ω| / |net Δheading|."
    // The floor on the denominator both guards division by zero and stops a
    // perfectly-straight-heading artefact from producing infinite confidence.
    const denom = Math.max(m.netHeadingChange, 0.05);
    const ratio = m.integratedYaw / denom;

    return [
      baseCandidate(ctx, {
        type: 'driver.swerving',
        category: 'driver',
        severity: severityFor(ratio, m.excursions),
        confidence: clamp01(0.45 + 0.08 * (ratio - t.minIntegratedYaw / 0.35)),
        magnitude: Number.parseFloat(m.integratedYaw.toFixed(4)),
        magnitudeUnit: 'rad',
        evidence: {
          rule: '§6.3 integrated |yaw| with near-zero net heading change',
          integrated_yaw_rad: Number.parseFloat(m.integratedYaw.toFixed(4)),
          integrated_yaw_deg: Number.parseFloat((m.integratedYaw * RAD2DEG).toFixed(2)),
          net_heading_change_rad: Number.parseFloat(m.netHeadingChange.toFixed(4)),
          net_heading_change_deg: Number.parseFloat((m.netHeadingChange * RAD2DEG).toFixed(2)),
          ratio: Number.parseFloat(ratio.toFixed(3)),
          excursions: m.excursions,
          min_speed_mps: Number.parseFloat(m.minSpeed.toFixed(3)),
          window_s: Number.parseFloat(m.spanS.toFixed(2)),
          samples: m.indices.length,
          thresholds: {
            min_integrated_yaw_rad: t.minIntegratedYaw,
            max_net_heading_change_rad: t.maxNetHeadingChange,
            min_speed_mps: t.minSpeed,
            min_excursions: t.minExcursions,
          },
          limitation:
            'yaw_rate_peak is unsigned (§2.2), so alternation is inferred from geometry rather than observed directly',
          time_quality: ctx.sample.timeQuality,
        },
        telemetryIds: ctx.state.ring.telemetryIdsOver(m.indices),
      }),
    ];
  },
};

export default swerveDetector;
