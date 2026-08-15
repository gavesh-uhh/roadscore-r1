/**
 * Score rollups — ENGINE-PLAN §8 and §11 Phase 5.
 *
 * Per-trip scores are the atom; daily per-driver scores are the aggregate the
 * dashboard shows. §8's exclusion applies at the rollup level too: "Trips with
 * `gps_coverage < 0.5` or heavy `calibration_stale` are marked low-confidence and
 * excluded from daily rollups."
 *
 * That exclusion is a deliberate trade. A trip we cannot measure properly should
 * not move a driver's score in either direction — neither punishing them for a
 * GPS outage nor rewarding them for one.
 */

import type { Score, Trip } from '../types.js';
import type { Thresholds } from '../config/thresholds.js';
import { computeScore, type ScorableEvent } from './penalties.js';

/** Seconds in a day, for period bucketing. */
const DAY_S = 86400;

/** UTC day boundaries containing `tSec`. */
export function dayBounds(tSec: number): { start: number; end: number } {
  const start = Math.floor(tSec / DAY_S) * DAY_S;
  return { start, end: start + DAY_S };
}

/**
 * Is this trip trustworthy enough to move a driver's daily score? (§8)
 */
export function tripIsLowConfidence(
  trip: Trip,
  cfg: Thresholds,
  calibrationStaleEvents = 0,
): { low: boolean; reason: string | null } {
  if (trip.gpsCoverage !== null && trip.gpsCoverage < cfg.scoring.minGpsCoverage) {
    return {
      low: true,
      reason: `gps_coverage ${trip.gpsCoverage.toFixed(2)} < ${cfg.scoring.minGpsCoverage}`,
    };
  }
  // "Heavy" calibration staleness: more than one stale episode in a single trip
  // means the accel-derived detectors were suppressed for much of it, so the
  // absence of events is not evidence of good driving.
  if (calibrationStaleEvents > 1) {
    return { low: true, reason: `${calibrationStaleEvents} calibration_stale episodes` };
  }
  if (trip.status === 'abandoned') {
    return { low: true, reason: 'trip abandoned (reboot, stale data, or went nowhere)' };
  }
  return { low: false, reason: null };
}

export interface TripScoreInput {
  trip: Trip;
  events: ScorableEvent[];
  calibrationStaleEvents?: number;
}

/** Score one trip. */
export function scoreTrip(input: TripScoreInput, cfg: Thresholds, ruleVersion: string): Score {
  const { trip } = input;
  const lc = tripIsLowConfidence(trip, cfg, input.calibrationStaleEvents ?? 0);

  const score = computeScore(
    {
      subjectType: 'trip',
      subjectId: trip.id,
      periodStart: trip.startedAt,
      periodEnd: trip.endedAt ?? trip.startedAt,
      events: input.events,
      distanceKm: trip.distanceM / 1000,
      durationMin: trip.durationS === null ? undefined : trip.durationS / 60,
      lowConfidence: lc.low,
    },
    cfg,
    ruleVersion,
  );

  if (lc.reason !== null) {
    score.breakdown.excluded.push({
      eventKey: `trip:${trip.id}`,
      reason: `trip marked low-confidence: ${lc.reason} — excluded from daily rollups (§8)`,
    });
  }

  return score;
}

export interface DailyRollupInput {
  subjectType: 'driver' | 'device';
  subjectId: string;
  dayTSec: number;
  /** Trips and their events, for the day. */
  trips: TripScoreInput[];
}

/**
 * Roll trips up into one daily score per subject.
 *
 * Not an average of trip scores — that would weight a 500 m errand the same as a
 * 200 km shift. §8's exposure normalisation only works if the penalties and the
 * distances are summed and divided once, so that is what happens here.
 */
export function rollupDaily(
  input: DailyRollupInput,
  cfg: Thresholds,
  ruleVersion: string,
): Score {
  const { start, end } = dayBounds(input.dayTSec);

  const events: ScorableEvent[] = [];
  let distanceKm = 0;
  let durationMin = 0;
  const excludedTrips: { eventKey: string; reason: string }[] = [];

  for (const t of input.trips) {
    const lc = tripIsLowConfidence(t.trip, cfg, t.calibrationStaleEvents ?? 0);
    if (lc.low) {
      // Excluded entirely — its events and its distance both drop out, so the
      // driver is neither punished nor credited for an unmeasurable trip.
      excludedTrips.push({
        eventKey: `trip:${t.trip.id}`,
        reason: `excluded from daily rollup: ${lc.reason} (§8)`,
      });
      continue;
    }
    events.push(...t.events);
    distanceKm += t.trip.distanceM / 1000;
    if (t.trip.durationS !== null) durationMin += t.trip.durationS / 60;
  }

  const score = computeScore(
    {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      periodStart: start,
      periodEnd: end,
      events,
      distanceKm,
      durationMin,
    },
    cfg,
    ruleVersion,
  );

  score.breakdown.excluded.push(...excludedTrips);
  return score;
}

/**
 * Group trips by driver (falling back to device when no driver is mapped) and by
 * UTC day, ready for `rollupDaily`.
 */
export function groupForRollup(
  trips: TripScoreInput[],
): Map<string, { subjectType: 'driver' | 'device'; subjectId: string; dayTSec: number; trips: TripScoreInput[] }> {
  const groups = new Map<
    string,
    { subjectType: 'driver' | 'device'; subjectId: string; dayTSec: number; trips: TripScoreInput[] }
  >();

  for (const t of trips) {
    const subjectType: 'driver' | 'device' = t.trip.driverId !== null ? 'driver' : 'device';
    const subjectId = t.trip.driverId ?? t.trip.deviceId;
    const { start } = dayBounds(t.trip.startedAt);
    const key = `${subjectType}:${subjectId}:${start}`;

    const g = groups.get(key);
    if (g === undefined) {
      groups.set(key, { subjectType, subjectId, dayTSec: start, trips: [t] });
    } else {
      g.trips.push(t);
    }
  }

  return groups;
}
