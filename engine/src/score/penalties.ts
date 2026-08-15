/**
 * Penalty model — ENGINE-PLAN §8.
 *
 *   raw_penalty = Σ over events: weight[type] · severity_multiplier · confidence
 *   exposure    = max(distance_km, 1.0)
 *   score       = clamp(100 − 100 · raw_penalty / (exposure · k), 0, 100)
 *
 * §8 requires the fairness rule to be enforced "in one place (`penalties.ts`) so
 * it is auditable". `isScorable` below IS that one place. Nothing else in the
 * engine may decide whether an event counts against a driver.
 *
 * The rule: only `attributed_to_driver = true` events count. Road defects,
 * undecided impacts and every integrity event are excluded. That is the fairness
 * claim of the whole project, and it is four lines of code — which is the point.
 */

import type {
  EventCandidate,
  PenaltyContribution,
  PersistableEvent,
  Score,
  ScoreSubject,
} from '../types.js';
import type { Thresholds } from '../config/thresholds.js';

/** An event as scoring sees it: enough to judge, no more. */
export type ScorableEvent = Pick<
  PersistableEvent,
  'type' | 'category' | 'severity' | 'confidence' | 'attributedToDriver' | 'severityCensored'
> & { eventKey?: string; id?: string };

export interface Exclusion {
  eventKey: string;
  reason: string;
}

/**
 * THE fairness gate. Every exclusion in §8 is decided here and nowhere else.
 *
 * Returns null when the event should be scored, or a human-readable reason when
 * it must not be. The reason is persisted in the score `breakdown`, so a driver
 * asking "why didn't that count?" gets an answer rather than an assertion.
 */
export function exclusionReason(e: ScorableEvent, cfg: Thresholds): string | null {
  // 1. Not the driver's doing. Road defects and undecided impacts land here, and
  //    this single check is what makes the §7.3 arbitration meaningful.
  if (!e.attributedToDriver) {
    return `not attributed to the driver (category=${e.category}); §8 excludes road defects, undecided impacts and integrity events`;
  }

  // 2. Integrity events never penalise, even in the impossible case that one is
  //    somehow marked as attributed. Defence in depth for the §6.7 guarantee.
  if (e.category === 'integrity') {
    return 'integrity events never penalise the driver (§6.7)';
  }

  // 3. An event type with no weight is not a scoring input — `collision_suspected`
  //    is weight 0 by design (§2.7: "treat as an alert, not a score input").
  const weight = cfg.scoring.weights[e.type];
  if (weight === undefined) {
    return `no penalty weight defined for ${e.type}; not a scoring input`;
  }
  if (weight === 0) {
    return `${e.type} carries weight 0 — recorded as an alert, not a penalty (§2.7)`;
  }

  // 4. 'info' severity is context, not misconduct (e.g. that a corner happened).
  const mult = cfg.scoring.severityMultipliers[e.severity];
  if (mult === undefined || mult === 0) {
    return `severity '${e.severity}' carries no penalty multiplier`;
  }

  return null;
}

export function isScorable(e: ScorableEvent, cfg: Thresholds): boolean {
  return exclusionReason(e, cfg) === null;
}

/**
 * The penalty for one event.
 *
 * Confidence is a direct multiplier, so a 0.5-confidence event costs half of a
 * certain one. That is what lets the engine record uncertain findings honestly
 * instead of having to choose between "assert it" and "discard it".
 */
export function penaltyFor(e: ScorableEvent, cfg: Thresholds): PenaltyContribution | null {
  if (exclusionReason(e, cfg) !== null) return null;

  const weight = cfg.scoring.weights[e.type] ?? 0;
  const severityMultiplier = cfg.scoring.severityMultipliers[e.severity] ?? 0;
  const confidence = Math.max(0, Math.min(1, e.confidence));

  return {
    eventId: e.id ?? '',
    eventKey: e.eventKey ?? '',
    type: e.type,
    severity: e.severity,
    confidence,
    weight,
    severityMultiplier,
    penalty: weight * severityMultiplier * confidence,
  };
}

export interface ScoreInput {
  subjectType: ScoreSubject;
  subjectId: string;
  periodStart: number;
  periodEnd: number;
  events: ScorableEvent[];
  /** Kilometres driven in the period — the exposure denominator. */
  distanceKm: number;
  durationMin?: number;
  /**
   * Marks the period as low-confidence (§8): GPS coverage below 0.5, or heavy
   * calibration staleness. Low-confidence periods are still scored but flagged,
   * and the daily rollup excludes them.
   */
  lowConfidence?: boolean;
}

/**
 * Compute a score with a full, auditable breakdown.
 *
 * §8: "`breakdown` jsonb stores every contributing event id and its penalty, so a
 * driver can be shown exactly why they lost points. Non-negotiable for the
 * proposal's 'transparent accountability' goal."
 *
 * So the breakdown records both sides: what counted, and what was deliberately
 * excluded and why. A score with no explanation is not accountable.
 */
export function computeScore(input: ScoreInput, cfg: Thresholds, ruleVersion: string): Score {
  const contributions: PenaltyContribution[] = [];
  const excluded: Exclusion[] = [];

  for (const e of input.events) {
    const reason = exclusionReason(e, cfg);
    if (reason !== null) {
      excluded.push({ eventKey: e.eventKey ?? e.id ?? '', reason });
      continue;
    }
    const c = penaltyFor(e, cfg);
    if (c !== null) contributions.push(c);
  }

  const rawPenalty = contributions.reduce((sum, c) => sum + c.penalty, 0);

  // §8: exposure = max(distance_km, 1.0). The floor stops a single event on a
  // 200 m trip from producing a zero, which would be an artefact of the
  // denominator rather than a judgement about the driving.
  const exposureKm = Math.max(input.distanceKm, cfg.scoring.minExposureKm);
  const k = cfg.scoring.k;
  const score = Math.max(0, Math.min(100, 100 - (100 * rawPenalty) / (exposureKm * k)));

  return {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    score: Number.parseFloat(score.toFixed(2)),
    exposureKm: Number.parseFloat(exposureKm.toFixed(3)),
    exposureMin: input.durationMin ?? null,
    breakdown: {
      contributions,
      rawPenalty: Number.parseFloat(rawPenalty.toFixed(6)),
      exposureKm: Number.parseFloat(exposureKm.toFixed(3)),
      k,
      excluded,
      lowConfidence: input.lowConfidence ?? false,
    },
    ruleVersion,
  };
}

/**
 * Recompute a score from its own breakdown, for verification.
 *
 * §11 Phase 5's done-when is "a driver's daily score reconciles against its
 * breakdown by hand". This makes that check mechanical: if the stored score does
 * not match the arithmetic of its own contributions, the breakdown is not a real
 * explanation of the score and the transparency claim fails.
 */
export function reconcile(score: Score, cfg: Thresholds): { ok: boolean; expected: number; actual: number } {
  const raw = score.breakdown.contributions.reduce((s, c) => s + c.penalty, 0);
  const exposure = Math.max(score.breakdown.exposureKm, cfg.scoring.minExposureKm);
  const expected = Math.max(
    0,
    Math.min(100, 100 - (100 * raw) / (exposure * score.breakdown.k)),
  );
  const rounded = Number.parseFloat(expected.toFixed(2));
  return { ok: Math.abs(rounded - score.score) < 0.01, expected: rounded, actual: score.score };
}

/** Convenience for candidates that have not been persisted yet. */
export function toScorable(e: EventCandidate & { eventKey?: string }): ScorableEvent {
  return {
    type: e.type,
    category: e.category,
    severity: e.severity,
    confidence: e.confidence,
    attributedToDriver: e.attributedToDriver,
    severityCensored: e.severityCensored,
    eventKey: e.eventKey,
  };
}
