/**
 * Prediction outcome resolution — ENGINE-PLAN §7.4.
 *
 * "Closing the loop (this is what makes it a real predictor)."
 *
 * A system that only emits warnings cannot be wrong in any measurable way. This
 * module resolves each prediction against what actually happened:
 *
 *   - traversed the cell AND an impact fired there  → hit
 *   - traversed, no impact                          → miss
 *   - never traversed (turned off the road)         → not_traversed, EXCLUDED
 *
 * The exclusion matters. Counting a prediction as wrong because the driver turned
 * left would make precision a function of route choice rather than of the
 * predictor's quality. §7.4 is explicit that those are "excluded from stats".
 *
 * The output is a precision/recall figure over real drives — which §7.4 notes the
 * proposal's Ch. 2.4 performance testing "currently has no way to produce".
 */

import { gridDisk } from 'h3-js';
import type { EventCandidate, Prediction, PredictionOutcome, Sample } from '../types.js';
import { Flags } from '../types.js';
import type { Thresholds } from '../config/thresholds.js';
import { haversineM } from '../domain/state.js';
import { cellKey, type RoadMap } from '../arbitrate/roadmap.js';

/**
 * Tracks open predictions and closes them as evidence arrives.
 *
 * Held in memory per engine instance; open predictions are reloaded from the
 * `predictions` table on startup so a restart does not silently drop the
 * denominator of the accuracy figure.
 */
export class PredictionEvaluator {
  /** Open predictions by device, in issue order. */
  private readonly open = new Map<string, Prediction[]>();
  private readonly cfg: Thresholds;

  constructor(cfg: Thresholds) {
    this.cfg = cfg;
  }

  track(p: Prediction): void {
    if (p.outcome !== 'pending') return;
    const list = this.open.get(p.deviceId);
    if (list === undefined) this.open.set(p.deviceId, [p]);
    else list.push(p);
  }

  trackAll(ps: Prediction[]): void {
    for (const p of ps) this.track(p);
  }

  openCount(): number {
    let n = 0;
    for (const list of this.open.values()) n += list.length;
    return n;
  }

  /**
   * Feed one sample and any impact candidates that fired on it.
   *
   * Returns predictions that have just been resolved. Called once per row, after
   * the detectors, so an impact on this row can close a prediction targeting this
   * cell.
   */
  observe(
    sample: Sample,
    impacts: EventCandidate[],
    map: RoadMap,
    onResolved?: (p: Prediction) => void,
  ): Prediction[] {
    const list = this.open.get(sample.deviceId);
    if (list === undefined || list.length === 0) return [];

    const resolved: Prediction[] = [];
    const keep: Prediction[] = [];

    // The cells the vehicle can currently be said to occupy. The k-ring absorbs
    // the same position error §7.1 describes: judging traversal on an exact cell
    // match would score a 4 m GPS offset as "never went there".
    const here = new Set<string>();
    let sector = -1;
    if (sample.lat !== null && sample.lon !== null && (sample.flags & Flags.GPS_USABLE) !== 0) {
      sector = map.sectorOf(sample.heading);
      const exact = map.indexOf(sample.lat, sample.lon);
      try {
        for (const h of gridDisk(exact, this.cfg.roadmap.kRing)) here.add(h);
      } catch {
        here.add(exact);
      }
    }

    const impactCells = new Set<string>();
    for (const e of impacts) {
      if (e.h3_12 !== null) impactCells.add(e.h3_12);
      // An impact without a resolved cell still counts if it happened while the
      // vehicle was inside the target's neighbourhood — position is the same fix.
      else if (e.lat !== null && e.lon !== null) impactCells.add(map.indexOf(e.lat, e.lon));
    }

    for (const p of list) {
      const age = sample.tSec - p.issuedAt;
      const traversed = here.has(p.targetH3_12);

      // Also treat "came within the traversal radius" as traversal, so a
      // prediction is not left open by a cell-boundary technicality.
      const nearby =
        !traversed &&
        sample.lat !== null &&
        sample.lon !== null &&
        p.distanceM >= 0 &&
        this.withinRadius(sample, p, map);

      if (traversed || nearby) {
        // Did an impact fire in the target cell, or its immediate neighbours?
        const hit = impactCells.has(p.targetH3_12) || this.impactNear(impactCells, p.targetH3_12);
        // `outcome_event_id` is a DB uuid the writer assigns, which does not exist
        // yet at this point in the pipeline. The sink backfills it from the
        // event key; recording the key here would put a non-uuid in a uuid column.
        this.close(p, hit ? 'hit' : 'miss', sample.tSec, null);
        resolved.push(p);
        onResolved?.(p);
        continue;
      }

      if (age > this.cfg.predict.evaluationTimeoutS) {
        // Timed out without the vehicle ever reaching the cell — the driver went
        // somewhere else. Not the predictor's fault, and NOT counted against it.
        this.close(p, 'not_traversed', sample.tSec, null);
        resolved.push(p);
        onResolved?.(p);
        continue;
      }

      keep.push(p);
    }

    this.open.set(sample.deviceId, keep);
    return resolved;
  }

  /** Close out everything still open for a device — called at trip end. */
  closeDevice(deviceId: string, atTSec: number): Prediction[] {
    const list = this.open.get(deviceId) ?? [];
    for (const p of list) this.close(p, 'not_traversed', atTSec, null);
    this.open.delete(deviceId);
    return list;
  }

  private close(
    p: Prediction,
    outcome: PredictionOutcome,
    atTSec: number,
    eventId: string | null,
  ): void {
    p.outcome = outcome;
    p.outcomeCheckedAt = atTSec;
    p.outcomeEventId = eventId;
  }

  private withinRadius(sample: Sample, p: Prediction, map: RoadMap): boolean {
    const cell = map.get(p.targetH3_12, map.sectorOf(sample.heading));
    if (cell === null || cell.centroidLat === null || cell.centroidLon === null) return false;
    if (sample.lat === null || sample.lon === null) return false;
    return (
      haversineM(sample.lat, sample.lon, cell.centroidLat, cell.centroidLon) <=
      this.cfg.predict.traversalRadiusM
    );
  }

  private impactNear(impactCells: Set<string>, target: string): boolean {
    if (impactCells.size === 0) return false;
    try {
      for (const h of gridDisk(target, this.cfg.roadmap.kRing)) {
        if (impactCells.has(h)) return true;
      }
    } catch {
      /* fall through */
    }
    return false;
  }

}

export interface AccuracyReport {
  hits: number;
  misses: number;
  notTraversed: number;
  pending: number;
  /** hit / (hit + miss) — of the warnings we can judge, how many were right. */
  precision: number | null;
  /**
   * hit / (hit + unwarned impacts) — of the hazards actually encountered, how
   * many did we warn about. Requires the count of impacts that no prediction
   * covered, which only the caller knows.
   */
  recall: number | null;
  /** Harmonic mean, when both are available. */
  f1: number | null;
  evaluable: number;
  note: string;
}

/**
 * Precision and recall over resolved predictions — the §7.4 deliverable.
 *
 * `unwarnedImpacts` is the count of impact candidates that fired where no
 * prediction had been issued: the false negatives. Without it recall is
 * unknowable, so it is required rather than assumed to be zero — a recall of 1.0
 * reported because nobody counted the misses would be worse than no figure.
 */
export function accuracyReport(
  predictions: Prediction[],
  unwarnedImpacts: number | null = null,
): AccuracyReport {
  let hits = 0;
  let misses = 0;
  let notTraversed = 0;
  let pending = 0;

  for (const p of predictions) {
    if (p.outcome === 'hit') hits++;
    else if (p.outcome === 'miss') misses++;
    else if (p.outcome === 'not_traversed') notTraversed++;
    else pending++;
  }

  const evaluable = hits + misses;
  const precision = evaluable > 0 ? hits / evaluable : null;
  const recall =
    unwarnedImpacts === null ? null : hits + unwarnedImpacts > 0 ? hits / (hits + unwarnedImpacts) : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;

  return {
    hits,
    misses,
    notTraversed,
    pending,
    precision,
    recall,
    f1,
    evaluable,
    note:
      'not_traversed predictions are excluded from precision (§7.4): the driver turning off the route is not a prediction error. Recall requires the count of impacts no prediction covered.',
  };
}
