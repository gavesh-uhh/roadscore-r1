/**
 * Canonical RoadScore Scoring Engine — ENGINE-PLAN §8.
 *
 * Single source of truth for safety scoring across the backend and frontend:
 *
 *   raw_penalty = Σ over events: weight[type] · severity_multiplier · confidence
 *   exposure    = max(distance_km, minExposureKm)   // default minExposureKm = 1.0
 *   score       = clamp(100 − 100 · raw_penalty / (exposure · k), 0, 100)  // k = 2.0
 *
 * §8 Fairness Gate:
 *   - Only attributed_to_driver = true events count
 *   - Road defects, undecided impacts and integrity/sensor events are excluded
 *   - Weight 0 events (such as collision_suspected) are alerts, not score inputs
 *   - 'info' severity carries 0 multiplier
 */

export const RULE_VERSION = '2026.08.09-r1';

export type OperationalState = 'DRIVING' | 'STATIONARY_IDLE' | 'YARD_MANEUVER' | 'OFF_ROAD_PTO';

export interface ScoringConfig {
  version: string;
  weights: Record<string, number>;
  severityMultipliers: Record<string, number>;
  k: number;
  minExposureKm: number;
  minGpsCoverage: number;
}

export const CANONICAL_SCORING_CONFIG: ScoringConfig = {
  version: RULE_VERSION,
  weights: {
    'driver.harsh_brake': 1.0,
    'driver.harsh_accel': 0.8,
    'driver.sharp_corner': 0.4,
    'driver.excessive_cornering_speed': 1.0,
    'driver.swerving': 1.5,
    'driver.avoidable_impact': 1.2,
    'driver.speeding_relative': 0.9,
    'driver.speeding_for_conditions': 1.1,
    'driver.excessive_idling': 0.2,
    'driver.continuous_driving': 1.0,
    'driver.collision_suspected': 0, // Alert only
  },
  severityMultipliers: {
    info: 0,
    low: 1.0,
    medium: 2.0,
    high: 3.5,
    critical: 5.0,
  },
  k: 2.0,
  minExposureKm: 1.0,
  minGpsCoverage: 0.5,
};

export interface ScorableEvent {
  id?: string;
  eventKey?: string;
  event_key?: string;
  type: string;
  category?: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical' | string;
  confidence?: number;
  attributedToDriver?: boolean;
  attributed_to_driver?: boolean;
  severityCensored?: boolean;
  severity_censored?: boolean;
  occurredAt?: string;
  occurred_at?: string;
  magnitude?: number;
  magnitudeUnit?: string;
  magnitude_unit?: string;
  opState?: OperationalState;
  op_state?: OperationalState;
  driverId?: string | null;
  driver_id?: string | null;
  deviceId?: string | null;
  device_id?: string | null;
}

export interface PenaltyContribution {
  eventId: string;
  eventKey: string;
  type: string;
  severity: string;
  confidence: number;
  weight: number;
  severityMultiplier: number;
  penalty: number;
  occurredAt?: string;
  magnitude?: number;
  magnitudeUnit?: string;
  opState?: OperationalState;
}

export interface Exclusion {
  eventKey: string;
  reason: string;
  type?: string;
  severity?: string;
  occurredAt?: string;
  event?: any;
}

export interface ScoreBreakdown {
  contributions: PenaltyContribution[];
  rawPenalty: number;
  exposureKm: number;
  k: number;
  excluded: Exclusion[];
  lowConfidence?: boolean;
}

export interface CanonicalScoreResult {
  score: number;
  distanceKm: number;
  penalty: number;
  eventsCount: number;
  subjectType?: string;
  subjectId?: string;
  periodStart?: number;
  periodEnd?: number;
  breakdown: ScoreBreakdown;
  ruleVersion: string;
}

export interface FleetScoreResult {
  score: number;
  totalDistanceKm: number;
  totalPenalty: number;
  contributionsCount: number;
  eventsCount: number;
  breakdown: ScoreBreakdown;
  ruleVersion: string;
}

export interface FactorRadarScores {
  longitudinal: number;
  cornering: number;
  speedCompliance: number;
  roadRiskAdaptation: number;
  fatigueEco: number;
}

export interface DeductionItem {
  id: string;
  eventKey: string;
  type: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical' | string;
  occurredAt: string;
  magnitude?: number;
  magnitudeUnit?: string;
  confidence: number;
  basePenalty: number;
  severityMultiplier: number;
  penalty: number;
  netPenalty: number;
  decayFactor: number;
  opState: OperationalState;
}

export interface ExcludedEventItem {
  id?: string;
  type: string;
  severity: string;
  occurredAt?: string;
  reason: string;
  event: any;
}

/**
 * Normalises an arbitrary event payload (snake_case or camelCase) into a ScorableEvent.
 */
export function toScorableEvent(e: any): ScorableEvent {
  const attributed =
    e.attributedToDriver !== undefined
      ? Boolean(e.attributedToDriver)
      : e.attributed_to_driver !== undefined
      ? Boolean(e.attributed_to_driver)
      : true;

  const type = String(e.type || '');
  let category = e.category;
  if (!category) {
    if (type.startsWith('driver.')) category = 'driver';
    else if (type.startsWith('road.')) category = 'road';
    else if (type.startsWith('integrity.') || type.startsWith('sensor.')) category = 'integrity';
    else category = 'driver';
  }

  const id = e.id ? String(e.id) : undefined;
  const eventKey = e.eventKey || e.event_key || id || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const severity = String(e.severity || 'low').toLowerCase();
  const confidence = typeof e.confidence === 'number' ? Math.max(0, Math.min(1, e.confidence)) : 1.0;
  const occurredAt = e.occurredAt || e.occurred_at || new Date().toISOString();
  const magnitude = e.magnitude != null ? Number(e.magnitude) : undefined;
  const magnitudeUnit = e.magnitudeUnit || e.magnitude_unit || undefined;
  const opState = e.opState || e.op_state || 'DRIVING';
  const driverId = e.driverId || e.driver_id || null;
  const deviceId = e.deviceId || e.device_id || null;
  const severityCensored = Boolean(e.severityCensored || e.severity_censored);

  return {
    id,
    eventKey,
    event_key: eventKey,
    type,
    category,
    severity,
    confidence,
    attributedToDriver: attributed,
    attributed_to_driver: attributed,
    severityCensored,
    severity_censored: severityCensored,
    occurredAt,
    occurred_at: occurredAt,
    magnitude,
    magnitudeUnit,
    magnitude_unit: magnitudeUnit,
    opState,
    op_state: opState,
    driverId,
    driver_id: driverId,
    deviceId,
    device_id: deviceId,
  };
}

/**
 * THE fairness gate — Single source of truth for exclusions.
 * Returns null if event is scorable, or a human-readable exclusion reason if excluded.
 */
export function exclusionReason(
  rawEvent: any,
  cfg: ScoringConfig = CANONICAL_SCORING_CONFIG,
): string | null {
  const e = toScorableEvent(rawEvent);

  // 1. Not the driver's doing (§8 fairness filter: road defects, undecided impacts)
  if (!e.attributedToDriver) {
    return `not attributed to the driver (category=${e.category}); §8 excludes road defects, undecided impacts and integrity events`;
  }

  // 2. Integrity / hardware sensor events never penalise the driver (§6.7)
  if (
    e.category === 'integrity' ||
    e.type.startsWith('integrity.') ||
    e.type.startsWith('sensor.')
  ) {
    return 'integrity events never penalise the driver (§6.7)';
  }

  // 3. Events with weight 0 or without defined weight are not scoring penalties (§2.7)
  const weight = cfg.weights[e.type];
  if (weight === undefined) {
    return `no penalty weight defined for ${e.type}; not a scoring input`;
  }
  if (weight === 0) {
    return `${e.type} carries weight 0 — recorded as an alert, not a penalty (§2.7)`;
  }

  // 4. 'info' severity carries multiplier 0 (context, not misconduct)
  const mult = cfg.severityMultipliers[e.severity];
  if (mult === undefined || mult === 0) {
    return `severity '${e.severity}' carries no penalty multiplier`;
  }

  return null;
}

export function isScorable(
  rawEvent: any,
  cfg: ScoringConfig = CANONICAL_SCORING_CONFIG,
): boolean {
  return exclusionReason(rawEvent, cfg) === null;
}

/**
 * Compute the penalty contribution for one event according to the canonical formula:
 *   penalty = weight[type] · severity_multiplier · confidence
 */
export function penaltyFor(
  rawEvent: any,
  cfg: ScoringConfig = CANONICAL_SCORING_CONFIG,
): PenaltyContribution | null {
  if (!isScorable(rawEvent, cfg)) return null;

  const e = toScorableEvent(rawEvent);
  const weight = cfg.weights[e.type] ?? 0;
  const severityMultiplier = cfg.severityMultipliers[e.severity] ?? 0;
  const confidence = typeof e.confidence === 'number' ? Math.max(0, Math.min(1, e.confidence)) : 1.0;
  const penalty = weight * severityMultiplier * confidence;

  return {
    eventId: e.id ?? '',
    eventKey: e.eventKey ?? '',
    type: e.type,
    severity: e.severity,
    confidence,
    weight,
    severityMultiplier,
    penalty: Number.parseFloat(penalty.toFixed(6)),
    occurredAt: e.occurredAt,
    magnitude: e.magnitude,
    magnitudeUnit: e.magnitudeUnit,
    opState: e.opState,
  };
}

export interface ComputeScoreInput {
  distanceKm: number;
  events: any[];
  subjectType?: 'driver' | 'device' | 'trip' | string;
  subjectId?: string;
  durationMin?: number;
  periodStart?: number;
  periodEnd?: number;
  lowConfidence?: boolean;
}

/**
 * Canonical driver / trip score calculation:
 *   Score = clamp(100 − 100 · raw_penalty / (exposure_km · k), 0, 100)
 */
export function computeCanonicalScore(
  input: ComputeScoreInput,
  cfg: ScoringConfig = CANONICAL_SCORING_CONFIG,
  ruleVersion: string = RULE_VERSION,
): CanonicalScoreResult {
  const contributions: PenaltyContribution[] = [];
  const excluded: Exclusion[] = [];

  for (const raw of input.events || []) {
    const e = toScorableEvent(raw);
    const reason = exclusionReason(e, cfg);
    if (reason !== null) {
      excluded.push({
        eventKey: e.eventKey ?? e.id ?? '',
        reason,
        type: e.type,
        severity: e.severity,
        occurredAt: e.occurredAt,
        event: e,
      });
      continue;
    }
    const c = penaltyFor(e, cfg);
    if (c !== null) contributions.push(c);
  }

  const rawPenalty = contributions.reduce((sum, c) => sum + c.penalty, 0);
  const exposureKm = Math.max(Number(input.distanceKm) || 0, cfg.minExposureKm);
  const k = cfg.k;
  const score = Math.max(0, Math.min(100, 100 - (100 * rawPenalty) / (exposureKm * k)));

  return {
    score: Number.parseFloat(score.toFixed(2)),
    distanceKm: Number.parseFloat((input.distanceKm || 0).toFixed(3)),
    penalty: Number.parseFloat(rawPenalty.toFixed(4)),
    eventsCount: (input.events || []).length,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
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
 * Canonical Fleet Score calculation:
 *   Fleet Score = clamp(100 − 100 · total_fleet_penalties / (total_fleet_distance · k), 0, 100)
 *
 * Does NOT average individual driver scores, ensuring high-distance drivers
 * and short-distance drivers are weighted proportionally to true exposure.
 */
export function computeFleetScore(
  input: { totalDistanceKm: number; events: any[]; periodStart?: number; periodEnd?: number },
  cfg: ScoringConfig = CANONICAL_SCORING_CONFIG,
  ruleVersion: string = RULE_VERSION,
): FleetScoreResult {
  const contributions: PenaltyContribution[] = [];
  const excluded: Exclusion[] = [];

  for (const raw of input.events || []) {
    const e = toScorableEvent(raw);
    const reason = exclusionReason(e, cfg);
    if (reason !== null) {
      excluded.push({
        eventKey: e.eventKey ?? e.id ?? '',
        reason,
        type: e.type,
        severity: e.severity,
        occurredAt: e.occurredAt,
        event: e,
      });
      continue;
    }
    const c = penaltyFor(e, cfg);
    if (c !== null) contributions.push(c);
  }

  const totalPenalty = contributions.reduce((sum, c) => sum + c.penalty, 0);
  const exposureKm = Math.max(Number(input.totalDistanceKm) || 0, cfg.minExposureKm);
  const k = cfg.k;
  const score = Math.max(0, Math.min(100, 100 - (100 * totalPenalty) / (exposureKm * k)));

  return {
    score: Number.parseFloat(score.toFixed(2)),
    totalDistanceKm: Number.parseFloat((input.totalDistanceKm || 0).toFixed(3)),
    totalPenalty: Number.parseFloat(totalPenalty.toFixed(4)),
    contributionsCount: contributions.length,
    eventsCount: (input.events || []).length,
    breakdown: {
      contributions,
      rawPenalty: Number.parseFloat(totalPenalty.toFixed(6)),
      exposureKm: Number.parseFloat(exposureKm.toFixed(3)),
      k,
      excluded,
    },
    ruleVersion,
  };
}

/**
 * Supporting Analytics: 5-Factor Radar Scores (0..100)
 */
export function calculateFactorRadarScores(
  events: any[],
  cfg: ScoringConfig = CANONICAL_SCORING_CONFIG,
): FactorRadarScores {
  let longitudinalPen = 0;
  let corneringPen = 0;
  let speedPen = 0;
  let roadAdaptPen = 0;
  let fatigueEcoPen = 0;

  for (const raw of events || []) {
    const e = toScorableEvent(raw);
    if (!isScorable(e, cfg)) continue;

    const conf = typeof e.confidence === 'number' ? e.confidence : 1.0;
    const pen = (cfg.weights[e.type] ?? 1.0) * (cfg.severityMultipliers[e.severity] ?? 1.0) * conf;

    if (
      e.type.includes('harsh_brake') ||
      e.type.includes('harsh_accel') ||
      e.type.includes('collision')
    ) {
      longitudinalPen += pen;
    } else if (
      e.type.includes('corner') ||
      e.type.includes('swerving')
    ) {
      corneringPen += pen;
    } else if (e.type.includes('speeding')) {
      speedPen += pen;
    } else if (
      e.type.includes('avoidable_impact') ||
      e.type.includes('pothole')
    ) {
      roadAdaptPen += pen;
    } else if (
      e.type.includes('idle') ||
      e.type.includes('continuous_driving') ||
      e.type.includes('fatigue') ||
      e.type.includes('pto') ||
      e.type.includes('yard')
    ) {
      fatigueEcoPen += pen;
    }
  }

  return {
    longitudinal: Math.max(0, Math.min(100, Math.round(100 - longitudinalPen * 10))),
    cornering: Math.max(0, Math.min(100, Math.round(100 - corneringPen * 10))),
    speedCompliance: Math.max(0, Math.min(100, Math.round(100 - speedPen * 10))),
    roadRiskAdaptation: Math.max(0, Math.min(100, Math.round(100 - roadAdaptPen * 10))),
    fatigueEco: Math.max(0, Math.min(100, Math.round(100 - fatigueEcoPen * 10))),
  };
}

/**
 * Itemized deductions for driver score audit drawer
 */
export function calculateCanonicalDeductions(
  events: any[],
  cfg: ScoringConfig = CANONICAL_SCORING_CONFIG,
): DeductionItem[] {
  const deductions: DeductionItem[] = [];

  for (const raw of events || []) {
    const e = toScorableEvent(raw);
    if (!isScorable(e, cfg)) continue;

    const basePenalty = cfg.weights[e.type] ?? 1.0;
    const severityMultiplier = cfg.severityMultipliers[e.severity] ?? 1.0;
    const conf = typeof e.confidence === 'number' ? e.confidence : 1.0;
    const penalty = Number.parseFloat((basePenalty * severityMultiplier * conf).toFixed(2));

    deductions.push({
      id: e.id || e.eventKey || Math.random().toString(),
      eventKey: e.eventKey || e.id || 'EVT_UNKNOWN',
      type: e.type,
      severity: e.severity,
      occurredAt: e.occurredAt || new Date().toISOString(),
      magnitude: e.magnitude,
      magnitudeUnit: e.magnitudeUnit,
      confidence: conf,
      basePenalty,
      severityMultiplier,
      penalty,
      netPenalty: penalty,
      decayFactor: 1.0,
      opState: e.opState || 'DRIVING',
    });
  }

  return deductions.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

/**
 * Excluded events for §8 fairness audit
 */
export function getCanonicalExcludedEvents(
  events: any[],
  cfg: ScoringConfig = CANONICAL_SCORING_CONFIG,
): ExcludedEventItem[] {
  const excluded: ExcludedEventItem[] = [];

  for (const raw of events || []) {
    const e = toScorableEvent(raw);
    const reason = exclusionReason(e, cfg);
    if (reason !== null) {
      excluded.push({
        id: e.id,
        type: e.type,
        severity: e.severity,
        occurredAt: e.occurredAt,
        reason,
        event: e,
      });
    }
  }

  return excluded;
}

/**
 * Supporting Analytics: Score timeline across past intervals
 */
export function generateScoreTimeline(
  events: any[],
  totalDistanceKm: number = 10,
  nowTs: number = Date.now(),
  hours: number = 12,
): { hour: string; score: number }[] {
  const points: { hour: string; score: number }[] = [];
  const stepMs = (hours * 3600 * 1000) / 12;

  for (let i = 12; i >= 0; i--) {
    const pointTs = nowTs - i * stepMs;
    // Filter events up to pointTs
    const sliceEvents = (events || []).filter((e) => {
      const occ = new Date(e.occurredAt || e.occurred_at || 0).getTime();
      return occ <= pointTs;
    });

    const res = computeCanonicalScore({
      distanceKm: totalDistanceKm,
      events: sliceEvents,
    });

    const date = new Date(pointTs);
    const hourLabel = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    points.push({ hour: hourLabel, score: res.score });
  }

  return points;
}

export type StreamStatus = 'streaming' | 'intermittent' | 'idle' | 'disconnected';

/**
 * Evaluates live telemetry stream health
 */
export function evaluateStreamHealth(
  packetArrivalTimestamps: number[],
  nowTs: number = Date.now(),
): { status: StreamStatus; rateHz: number; lastSeenSecAgo: number } {
  if (!packetArrivalTimestamps || packetArrivalTimestamps.length === 0) {
    return { status: 'idle', rateHz: 0, lastSeenSecAgo: 999 };
  }

  const sorted = [...packetArrivalTimestamps].sort((a, b) => b - a);
  const latestTs = sorted[0] ?? nowTs;
  const lastSeenSecAgo = Math.max(0, Math.floor((nowTs - latestTs) / 1000));

  const recentPackets = sorted.filter((ts) => nowTs - ts <= 3000);
  const rateHz = recentPackets.length > 1 ? Number((recentPackets.length / 3.0).toFixed(1)) : 0;

  let status: StreamStatus = 'idle';
  if (lastSeenSecAgo <= 3 && rateHz >= 10) {
    status = 'streaming';
  } else if (lastSeenSecAgo <= 6) {
    status = 'intermittent';
  } else if (lastSeenSecAgo <= 30) {
    status = 'idle';
  } else {
    status = 'disconnected';
  }

  return { status, rateHz, lastSeenSecAgo };
}

/**
 * Driver resolution cascade
 */
export function resolveEventDriverId(
  event: any,
  driverAssignedDeviceIdMap: Record<string, string>,
  deviceAssignedDriverMap: Record<string, string>,
): string | null {
  const driverId = event.driverId || event.driver_id;
  if (driverId) return driverId;

  const deviceId = event.deviceId || event.device_id;
  if (deviceId && deviceAssignedDriverMap[deviceId]) {
    return deviceAssignedDriverMap[deviceId] || null;
  }
  if (deviceId) {
    for (const [dId, devId] of Object.entries(driverAssignedDeviceIdMap)) {
      if (devId === deviceId) return dId;
    }
  }
  return null;
}
