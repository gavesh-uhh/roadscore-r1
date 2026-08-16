/**
 * Continuous 24/7 Driver Safety Scoring Calculation Engine
 */

export type OperationalState = 'DRIVING' | 'STATIONARY_IDLE' | 'YARD_MANEUVER' | 'OFF_ROAD_PTO';

export interface TelematicsEvent {
  id?: string;
  event_key?: string;
  type: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  occurred_at: string;
  magnitude?: number;
  magnitude_unit?: string;
  confidence?: number;
  op_state?: OperationalState;
  attributed_to_driver?: boolean;
  driver_id?: string | null;
  device_id?: string | null;
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
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  occurredAt: string;
  magnitude?: number;
  magnitudeUnit?: string;
  confidence?: number;
  basePenalty: number;
  severityMultiplier: number;
  stateWeight: number;
  decayFactor: number;
  netPenalty: number;
  opState: OperationalState;
}

export interface DriverAggregates {
  score24h: number;
  totalDistanceKm: number;
  totalTrips: number;
  eventsPer100km: number;
  roadRoughnessAvg: number;
  trend15m: number;
}

// Operational State Penalty Multipliers
export const STATE_WEIGHTS: Record<OperationalState, number> = {
  DRIVING: 1.00,
  STATIONARY_IDLE: 0.40,
  YARD_MANEUVER: 0.85,
  OFF_ROAD_PTO: 0.60,
};

// Base Penalty Deductions per Event Type
export const EVENT_BASE_PENALTIES: Record<string, number> = {
  'road.pothole_impact': 12.0,
  'driver.harsh_brake': 8.0,
  'driver.harsh_accel': 5.0,
  'driver.sharp_corner': 3.0,
  'driver.excessive_cornering_speed': 7.0,
  'driver.swerving': 10.0,
  'driver.avoidable_impact': 9.0,
  'driver.speeding_relative': 6.0,
  'driver.speeding_for_conditions': 7.0,
  'driver.excessive_idling': 4.0,
  'driver.continuous_driving': 8.0,
  'engine.excessive_idle': 4.0,
  'depot.yard_shunt_impact': 10.0,
  'security.unauthorized_movement': 15.0,
  'engine.pto_overrev': 6.0,
};

// Severity Multipliers
export const SEVERITY_MULTIPLIERS: Record<string, number> = {
  info: 0.0,
  low: 0.8,
  medium: 1.5,
  high: 2.5,
  critical: 4.0,
};

/**
 * Calculates continuous 24h decay-weighted safety score
 */
export function calculateContinuousScore24h(events: TelematicsEvent[], nowTs: number = Date.now()): number {
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  let totalDeductions = 0;

  for (const evt of events) {
    // Only attribute driver-attributed events (§8 fairness gate)
    if (evt.attributed_to_driver === false) continue;

    const eventTs = new Date(evt.occurred_at).getTime();
    const ageMs = nowTs - eventTs;

    // Skip events older than 24 hours or in the future
    if (ageMs > 24 * 60 * 60 * 1000 || ageMs < -60000) continue;

    // Exponential Decay (Half-life = 12 hours)
    const decayFactor = Math.exp(- (Math.LN2 * Math.max(0, ageMs)) / TWELVE_HOURS_MS);

    // Operational State Weight
    const opState = evt.op_state ?? 'DRIVING';
    const stateWeight = STATE_WEIGHTS[opState] ?? 1.0;

    // Event Penalty & Severity Multiplier
    const basePenalty = EVENT_BASE_PENALTIES[evt.type] ?? 5.0;
    const sevMult = SEVERITY_MULTIPLIERS[evt.severity] ?? 1.0;

    const netPenalty = basePenalty * sevMult * stateWeight * decayFactor;
    totalDeductions += netPenalty;
  }

  return Math.max(0, Math.min(100, Number((100 - totalDeductions).toFixed(1))));
}

/**
 * Returns itemized list of deductions for driver-attributed events within the 24h window
 */
export function calculateDriverDeductions(events: TelematicsEvent[], nowTs: number = Date.now()): DeductionItem[] {
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  const deductions: DeductionItem[] = [];

  for (const evt of events) {
    if (evt.attributed_to_driver === false) continue;

    const eventTs = new Date(evt.occurred_at).getTime();
    const ageMs = nowTs - eventTs;
    if (ageMs > 24 * 60 * 60 * 1000 || ageMs < -60000) continue;

    const decayFactor = Math.exp(- (Math.LN2 * Math.max(0, ageMs)) / TWELVE_HOURS_MS);
    const opState = evt.op_state ?? 'DRIVING';
    const stateWeight = STATE_WEIGHTS[opState] ?? 1.0;
    const basePenalty = EVENT_BASE_PENALTIES[evt.type] ?? 5.0;
    const severityMultiplier = SEVERITY_MULTIPLIERS[evt.severity] ?? 1.0;
    const netPenalty = Number((basePenalty * severityMultiplier * stateWeight * decayFactor).toFixed(2));

    deductions.push({
      id: evt.id || evt.event_key || Math.random().toString(),
      eventKey: evt.event_key || evt.id || 'EVT_UNKNOWN',
      type: evt.type,
      severity: evt.severity,
      occurredAt: evt.occurred_at,
      magnitude: evt.magnitude,
      magnitudeUnit: evt.magnitude_unit,
      confidence: evt.confidence ?? 1.0,
      basePenalty,
      severityMultiplier,
      stateWeight,
      decayFactor: Number(decayFactor.toFixed(3)),
      netPenalty,
      opState,
    });
  }

  return deductions.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
}

/**
 * Generates continuous score timeline points across past hours (default 12 intervals)
 */
export function generateScoreTimeline(events: TelematicsEvent[], nowTs: number = Date.now(), hours: number = 12): { hour: string; score: number }[] {
  const points: { hour: string; score: number }[] = [];
  const stepMs = (hours * 3600 * 1000) / 12;

  for (let i = 12; i >= 0; i--) {
    const pointTs = nowTs - i * stepMs;
    const score = calculateContinuousScore24h(events, pointTs);
    const date = new Date(pointTs);
    const hourLabel = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    points.push({ hour: hourLabel, score });
  }

  return points;
}

/**
 * Returns list of events excluded from driver scoring (§8 fairness audit)
 */
export function getExcludedEvents(events: TelematicsEvent[]): { event: TelematicsEvent; reason: string }[] {
  const excluded: { event: TelematicsEvent; reason: string }[] = [];
  for (const evt of events) {
    if (evt.attributed_to_driver === false) {
      const isIntegrity = evt.type.startsWith('integrity.') || evt.type.startsWith('sensor.');
      const isRoad = evt.type.startsWith('road.');
      const reason = isRoad
        ? 'Excluded by §8 fairness rule: arbitrated road defect baseline'
        : isIntegrity
        ? 'Excluded: hardware sensor anomaly / integrity flag'
        : 'Excluded: not attributed to driver behavior';
      excluded.push({ event: evt, reason });
    }
  }
  return excluded;
}

/**
 * Robust cascade resolver to match telematics events to driver ID
 */
export function resolveEventDriverId(
  event: TelematicsEvent,
  driverAssignedDeviceIdMap: Record<string, string>, // driver_id -> device_id
  deviceAssignedDriverMap: Record<string, string>    // device_id -> driver_id
): string | null {
  if (event.driver_id) return event.driver_id;
  if (event.device_id && deviceAssignedDriverMap[event.device_id]) {
    return deviceAssignedDriverMap[event.device_id] || null;
  }
  if (event.device_id) {
    for (const [driverId, devId] of Object.entries(driverAssignedDeviceIdMap)) {
      if (devId === event.device_id) return driverId;
    }
  }
  return null;
}

export type StreamStatus = 'streaming' | 'intermittent' | 'idle' | 'disconnected';

/**
 * Calculates live telemetry ingress rate and active status
 */
export function evaluateStreamHealth(
  packetArrivalTimestamps: number[],
  nowTs: number = Date.now()
): { status: StreamStatus; rateHz: number; lastSeenSecAgo: number } {
  if (packetArrivalTimestamps.length === 0) {
    return { status: 'idle', rateHz: 0, lastSeenSecAgo: 999 };
  }

  const sorted = [...packetArrivalTimestamps].sort((a, b) => b - a);
  const latestTs = sorted[0] ?? nowTs;
  const lastSeenSecAgo = Math.max(0, Math.floor((nowTs - latestTs) / 1000));

  // Count packets in the last 3.0 seconds
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
 * Calculates 5-Factor Radar Scores (Longitudinal, Cornering, Speed, Road Adaptation, Fatigue/Eco)
 */
export function calculateFactorRadarScores(events: TelematicsEvent[]): FactorRadarScores {
  let longitudinalPen = 0;
  let corneringPen = 0;
  let speedPen = 0;
  let roadAdaptPen = 0;
  let fatigueEcoPen = 0;

  for (const evt of events) {
    if (evt.attributed_to_driver === false) continue;

    const basePen = (EVENT_BASE_PENALTIES[evt.type] ?? 4.0) * (SEVERITY_MULTIPLIERS[evt.severity] ?? 1.0);

    if (evt.type.includes('harsh_brake') || evt.type.includes('harsh_accel')) {
      longitudinalPen += basePen;
    } else if (evt.type.includes('corner') || evt.type.includes('swerving')) {
      corneringPen += basePen;
    } else if (evt.type.includes('speeding')) {
      speedPen += basePen;
    } else if (evt.type.includes('avoidable_impact') || evt.type.includes('pothole')) {
      roadAdaptPen += basePen;
    } else if (
      evt.type.includes('idle') ||
      evt.type.includes('continuous_driving') ||
      evt.type.includes('fatigue') ||
      evt.type.includes('pto') ||
      evt.type.includes('yard')
    ) {
      fatigueEcoPen += basePen;
    }
  }

  return {
    longitudinal: Math.max(0, Math.min(100, Math.round(100 - longitudinalPen * 1.5))),
    cornering: Math.max(0, Math.min(100, Math.round(100 - corneringPen * 1.5))),
    speedCompliance: Math.max(0, Math.min(100, Math.round(100 - speedPen * 1.5))),
    roadRiskAdaptation: Math.max(0, Math.min(100, Math.round(100 - roadAdaptPen * 1.5))),
    fatigueEco: Math.max(0, Math.min(100, Math.round(100 - fatigueEcoPen * 1.5))),
  };
}

