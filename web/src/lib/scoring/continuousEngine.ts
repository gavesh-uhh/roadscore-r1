/**
 * Unified Scoring Module — Re-exports and wraps the canonical backend scoring engine.
 *
 * All scoring logic is unified in `canonicalEngine.ts` using the canonical formula:
 *   Score = clamp(100 − 100 · raw_penalty / (exposure_km · k), 0, 100)
 *
 * Frontend duplicate/custom scoring logic is completely replaced with the canonical engine.
 */

import {
  computeCanonicalScore,
  computeFleetScore,
  calculateFactorRadarScores as canonicalFactorRadar,
  calculateCanonicalDeductions,
  getCanonicalExcludedEvents,
  generateScoreTimeline as canonicalTimeline,
  evaluateStreamHealth as canonicalStreamHealth,
  resolveEventDriverId as canonicalResolveDriverId,
  CANONICAL_SCORING_CONFIG,
  RULE_VERSION,
  toScorableEvent,
  isScorable,
  exclusionReason,
  penaltyFor,
  type ScorableEvent,
  type PenaltyContribution,
  type Exclusion,
  type ScoreBreakdown,
  type CanonicalScoreResult,
  type FleetScoreResult,
  type FactorRadarScores,
  type DeductionItem,
  type ExcludedEventItem,
  type OperationalState,
  type StreamStatus,
} from './canonicalEngine';

export {
  computeCanonicalScore,
  computeFleetScore,
  CANONICAL_SCORING_CONFIG,
  RULE_VERSION,
  toScorableEvent,
  isScorable,
  exclusionReason,
  penaltyFor,
};

export type {
  ScorableEvent,
  PenaltyContribution,
  Exclusion,
  ScoreBreakdown,
  CanonicalScoreResult,
  FleetScoreResult,
  FactorRadarScores,
  DeductionItem,
  ExcludedEventItem,
  OperationalState,
  StreamStatus,
};

export interface TelematicsEvent {
  id?: string;
  event_key?: string;
  eventKey?: string;
  type: string;
  category?: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical' | string;
  occurred_at?: string;
  occurredAt?: string;
  magnitude?: number;
  magnitude_unit?: string;
  magnitudeUnit?: string;
  confidence?: number;
  op_state?: OperationalState;
  opState?: OperationalState;
  attributed_to_driver?: boolean;
  attributedToDriver?: boolean;
  driver_id?: string | null;
  driverId?: string | null;
  device_id?: string | null;
  deviceId?: string | null;
}

export interface DriverAggregates {
  score24h: number;
  totalDistanceKm: number;
  totalTrips: number;
  eventsPer100km: number;
  roadRoughnessAvg: number;
  trend15m: number;
}

/**
 * Calculates score using canonical backend formula:
 *   Score = clamp(100 − 100 · raw_penalty / (exposure_km · k), 0, 100)
 */
export function calculateContinuousScore24h(
  events: TelematicsEvent[],
  nowTsOrDistance: number = Date.now(),
  distanceKm: number = 10,
): number {
  // If called with (events, distanceKm) where distanceKm is a reasonable distance
  const exposure = typeof nowTsOrDistance === 'number' && nowTsOrDistance < 10000 && nowTsOrDistance > 0
    ? nowTsOrDistance
    : distanceKm;

  const res = computeCanonicalScore({
    distanceKm: exposure,
    events,
  });
  return res.score;
}

/**
 * Returns itemized list of deductions for driver-attributed events using canonical penalties
 */
export function calculateDriverDeductions(
  events: TelematicsEvent[],
  nowTs: number = Date.now(),
): DeductionItem[] {
  void nowTs;
  return calculateCanonicalDeductions(events);
}

/**
 * Returns list of events excluded from driver scoring (§8 fairness audit)
 */
export function getExcludedEvents(events: TelematicsEvent[]): ExcludedEventItem[] {
  return getCanonicalExcludedEvents(events);
}

/**
 * Generates continuous score timeline points across past hours
 */
export function generateScoreTimeline(
  events: TelematicsEvent[],
  nowTs: number = Date.now(),
  hours: number = 12,
): { hour: string; score: number }[] {
  return canonicalTimeline(events, 10, nowTs, hours);
}

/**
 * Calculates 5-Factor Radar Scores (Longitudinal, Cornering, Speed, Road Adaptation, Fatigue/Eco)
 */
export function calculateFactorRadarScores(events: TelematicsEvent[]): FactorRadarScores {
  return canonicalFactorRadar(events);
}

/**
 * Calculates live telemetry ingress rate and active status
 */
export function evaluateStreamHealth(
  packetArrivalTimestamps: number[],
  nowTs: number = Date.now(),
): { status: StreamStatus; rateHz: number; lastSeenSecAgo: number } {
  return canonicalStreamHealth(packetArrivalTimestamps, nowTs);
}

/**
 * Cascade resolver to match telematics events to driver ID
 */
export function resolveEventDriverId(
  event: TelematicsEvent,
  driverAssignedDeviceIdMap: Record<string, string>,
  deviceAssignedDriverMap: Record<string, string>,
): string | null {
  return canonicalResolveDriverId(event, driverAssignedDeviceIdMap, deviceAssignedDriverMap);
}
