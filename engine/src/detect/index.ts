/**
 * The detector registry — ENGINE-PLAN §5 (`detect/index.ts`, "Detector[] registry,
 * all pure functions").
 *
 * Order matters in one respect only: `integrity` runs first, because its verdicts
 * explain the *absence* of other events. Everything else is independent, and the
 * plan's per-device sequential queue guarantees no interleaving within a device.
 */

import type { EventCandidate } from '../types.js';
import type { Detector, DetectorContext } from './context.js';
import { integrityDetector } from './integrity.js';
import { longitudinalDetector } from './longitudinal.js';
import { lateralDetector } from './lateral.js';
import { swerveDetector } from './swerve.js';
import { impactDetector } from './impact.js';
import { speedDetector } from './speed.js';
import { dutyDetector } from './duty.js';

/**
 * Registry. The replay CLI (§10) imports this by name and degrades gracefully if
 * it is absent, so the export name is part of that contract — see
 * `src/replay/cli.ts::loadDetectors`.
 */
export const detectors: readonly Detector[] = [
  integrityDetector,
  longitudinalDetector,
  lateralDetector,
  swerveDetector,
  impactDetector,
  speedDetector,
  dutyDetector,
];

/** Alias for the alternative name the replay loader also accepts. */
export const DETECTORS = detectors;

export interface RunDetectorsOptions {
  /**
   * Called when a detector throws. A single bad detector must never take down
   * the ingest pipeline — the row is already durable in Postgres (§3) and the
   * remaining detectors still have useful verdicts to offer.
   */
  onError?: (detectorName: string, err: unknown) => void;
}

/**
 * Run every detector over one sample and concatenate the candidates.
 *
 * Detector purity (§5) means this function is itself deterministic: same context,
 * same output. That is the property the §10 replay harness depends on.
 */
export function runDetectors(
  ctx: DetectorContext,
  opts: RunDetectorsOptions = {},
): EventCandidate[] {
  const out: EventCandidate[] = [];
  for (const d of detectors) {
    try {
      const found = d.run(ctx);
      for (const c of found) out.push(c);
    } catch (err) {
      opts.onError?.(d.name, err);
    }
  }
  return out;
}

export { integrityDetector, longitudinalDetector, lateralDetector, swerveDetector, impactDetector, speedDetector, dutyDetector };
export type { Detector, DetectorContext };
