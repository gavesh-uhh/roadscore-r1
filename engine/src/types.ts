/**
 * Shared contracts for the whole engine.
 *
 * Everything downstream of `normalize` speaks SI units. Raw MPU6050 counts exist
 * only in `RawRow` and die at the normalizer boundary (ENGINE-PLAN §2.1).
 */

// ---------------------------------------------------------------------------
// Ingest: the shape of a `public.telemetry` row as it comes off the wire
// ---------------------------------------------------------------------------

/** One instantaneous 3-axis reading, in raw sensor counts. */
export interface RawVec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The four gravity-decomposed accelerometer aggregates over the 1 s window.
 * These — not `accel_raw` — are the actual signal (§2.3).
 */
export interface RawAccelCal {
  vertical_peak?: number | null;
  vertical_rms?: number | null;
  horizontal_peak?: number | null;
  magnitude_peak?: number | null;
}

export interface RawGyroCal {
  yaw_rate_peak?: number | null;
  pitch_rate_peak?: number | null;
  roll_rate_peak?: number | null;
}

export interface RawGps {
  fix?: boolean | null;
  lat?: number | null;
  lon?: number | null;
  alt_m?: number | null;
  altitude?: number | null;
  speed_kmh?: number | null;
  heading?: number | null;
  sats?: number | null;
  hdop?: number | null;
}

export interface RawMic {
  rms?: number | null;
  peak?: number | null;
}

export type CalibrationState = 'calibrated' | 'calibrating' | 'uncalibrated' | 'default' | string;

export interface RawCalibration {
  state?: CalibrationState | null;
  age_ms?: number | null;
  gravity_ref?: RawVec3 | null;
}

/** A row of `public.telemetry`, exactly as stored. All jsonb blocks are partial by design. */
export interface RawRow {
  id: number;
  device_id: string;
  ts: string | null;
  uptime_ms: number;
  window_ms?: number | null;
  seq: number;
  samples?: number | null;
  accel_raw?: RawVec3 | null;
  accel_cal?: RawAccelCal | null;
  gyro_raw?: RawVec3 | null;
  gyro_cal?: RawGyroCal | null;
  gps?: RawGps | null;
  mic?: RawMic | null;
  calibration?: RawCalibration | null;
  wifi_rssi?: number | null;
  /** Firmware ask #1 — self-describing scale. Absent on current firmware. */
  accel_fs_g?: number | null;
  gyro_fs_dps?: number | null;
  /** Firmware asks #4 / #6. Absent on current firmware. */
  fw_version?: string | null;
  dropped_posts?: number | null;
  server_received_at: string;
}

// ---------------------------------------------------------------------------
// Normalized domain sample — SI units, resolved time
// ---------------------------------------------------------------------------

export type TimeQuality = 'gps' | 'anchored' | 'server';

/** Bit flags packed into `DeviceRing.flags`. */
export const Flags = {
  CALIBRATED: 1 << 0,
  GPS_FIX: 1 << 1,
  GPS_USABLE: 1 << 2, // fix && sats >= 5 && hdop <= 2.5
  CLIPPED: 1 << 3,
  MOVING: 1 << 4,
  MIC_VALID: 1 << 5,
  ACCEL_VALID: 1 << 6, // accel_cal present AND calibrated
  GYRO_VALID: 1 << 7,
} as const;

export type FlagName = keyof typeof Flags;

/**
 * One telemetry row after unit conversion, time resolution and validation.
 * This is the only thing detectors ever see (via the ring).
 */
export interface Sample {
  telemetryId: number;
  deviceId: string;
  bootId: string;
  seq: number;
  uptimeMs: number;

  /** Resolved epoch seconds. Never NaN. */
  tSec: number;
  timeQuality: TimeQuality;

  /** m/s. 0 when no fix. */
  speed: number;
  /** Signed longitudinal acceleration, m/s², from d(speed)/dt. NaN when unresolvable. */
  aLong: number;
  /** rad/s, unsigned (firmware reports a peak magnitude). */
  yawRate: number;
  /** m/s². */
  vertRms: number;
  vertPeak: number;
  horizPeak: number;
  magPeak: number;
  /** Degrees, 0..360. NaN when no fix. */
  heading: number;

  lat: number | null;
  lon: number | null;
  sats: number;
  hdop: number;

  micRms: number;
  micPeak: number;

  calibrationState: CalibrationState;
  calibrationAgeMs: number;
  gravityRef: RawVec3 | null;

  samples: number;
  wifiRssi: number;
  droppedPosts: number | null;

  flags: number;

  /** Raw counts retained purely for the clipping check and sensor-stuck detection. */
  rawVertPeakCounts: number;
  rawMagPeakCounts: number;
  accelRaw: RawVec3 | null;
}

export function hasFlag(flags: number, f: number): boolean {
  return (flags & f) !== 0;
}

// ---------------------------------------------------------------------------
// Detector output
// ---------------------------------------------------------------------------

export type EventCategory = 'driver' | 'road' | 'integrity';

export type EventSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export const EVENT_TYPES = [
  'driver.harsh_brake',
  'driver.harsh_accel',
  'driver.sharp_corner',
  'driver.excessive_cornering_speed',
  'driver.swerving',
  'driver.avoidable_impact',
  'driver.speeding_relative',
  'driver.speeding_for_conditions',
  'driver.excessive_idling',
  'driver.continuous_driving',
  'driver.collision_suspected',
  'road.impact_candidate',
  'road.defect_observation',
  'integrity.data_gap',
  'integrity.device_reboot',
  'integrity.mount_shift',
  'integrity.calibration_stale',
  'integrity.sensor_degraded',
  'integrity.gps_degraded',
  'integrity.upload_loss',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * What a detector emits. Deliberately *not* a DB row — arbitration may still
 * rewrite `type`, `attributedToDriver` and `roadDefectId` before it is persisted.
 */
export interface EventCandidate {
  type: EventType;
  category: EventCategory;
  severity: EventSeverity;
  /** 0..1 */
  confidence: number;

  deviceId: string;
  bootId: string;
  /** The `seq` of the sample the event is anchored at — part of the idempotency key. */
  anchorSeq: number;

  occurredAt: number; // epoch seconds
  timeQuality: TimeQuality;

  lat: number | null;
  lon: number | null;
  h3_12: string | null;
  headingSector: number | null;
  speedKmh: number | null;

  magnitude: number | null;
  magnitudeUnit: string | null;
  severityCensored: boolean;

  attributedToDriver: boolean;
  roadDefectId: string | null;

  evidence: Record<string, unknown>;
  telemetryIds: number[];
}

/** An `EventCandidate` plus everything the writer needs. */
export interface PersistableEvent extends EventCandidate {
  eventKey: string;
  tripId: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  ruleVersion: string;
  engineVersion: string;
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export type TripStatus = 'open' | 'closed' | 'abandoned';

export interface Trip {
  id: string;
  deviceId: string;
  driverId: string | null;
  vehicleId: string | null;
  bootId: string;
  startedAt: number; // epoch seconds
  endedAt: number | null;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  distanceM: number;
  durationS: number | null;
  movingS: number;
  idleS: number;
  maxSpeedKmh: number;
  /** Running accumulators for the mean; `avgSpeedKmh` is derived at close. */
  speedSumKmh: number;
  speedSamples: number;
  avgSpeedKmh: number | null;
  telemetryFrom: number | null;
  telemetryTo: number | null;
  gpsFixRows: number;
  totalRows: number;
  gpsCoverage: number | null;
  status: TripStatus;
}

// ---------------------------------------------------------------------------
// Road map
// ---------------------------------------------------------------------------

export interface RoadCell {
  h3_12: string;
  headingSector: number;
  centroidLat: number | null;
  centroidLon: number | null;
  passCount: number;
  deviceCount: number;
  spikeCount: number;
  /** Welford state over speed-normalised vertical RMS. */
  roughMean: number;
  roughM2: number;
  roughnessIndex: number | null;
  defectConfidence: number;
  lastPassAt: number | null;
  /** Speed samples for the fleet p85 norm, kept as a bounded reservoir. */
  speedP85Kmh: number | null;
}

export interface RoadDefect {
  id: string;
  h3_12: string;
  headingSector: number;
  lat: number | null;
  lon: number | null;
  confidence: number;
  severity: EventSeverity;
  distinctDevices: number;
  spikeRate: number;
  firstSeen: number;
  lastSeen: number;
  status: 'active' | 'repaired' | 'disputed';
}

export type ArbitrationVerdict = 'road_defect' | 'driver_event' | 'undecided';

export interface ArbitrationResult {
  verdict: ArbitrationVerdict;
  distinctDevices: number;
  spikeRate: number;
  passCount: number;
  matchedCell: string | null;
  confidence: number;
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

export type PredictionType = 'road.hazard_ahead' | 'road.rough_segment_ahead';
export type PredictionOutcome = 'hit' | 'miss' | 'not_traversed' | 'pending';

export interface Prediction {
  id: string;
  deviceId: string;
  tripId: string | null;
  issuedAt: number;
  type: PredictionType;
  targetDefectId: string | null;
  targetH3_12: string;
  distanceM: number;
  etaS: number;
  confidence: number;
  outcome: PredictionOutcome;
  outcomeEventId: string | null;
  outcomeCheckedAt: number | null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type ScoreSubject = 'driver' | 'device' | 'trip';

export interface PenaltyContribution {
  eventId: string;
  eventKey: string;
  type: EventType;
  severity: EventSeverity;
  confidence: number;
  weight: number;
  severityMultiplier: number;
  penalty: number;
}

export interface Score {
  subjectType: ScoreSubject;
  subjectId: string;
  periodStart: number;
  periodEnd: number;
  score: number;
  exposureKm: number | null;
  exposureMin: number | null;
  breakdown: {
    contributions: PenaltyContribution[];
    rawPenalty: number;
    exposureKm: number;
    k: number;
    excluded: { eventKey: string; reason: string }[];
    lowConfidence: boolean;
  };
  ruleVersion: string;
}

// ---------------------------------------------------------------------------
// Device identity
// ---------------------------------------------------------------------------

export interface DeviceMeta {
  deviceId: string;
  vehicleId: string | null;
  driverId: string | null;
  /** Fallbacks for the count→SI conversion until firmware ask #1 lands. */
  accelFsG: number;
  gyroFsDps: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Sink
// ---------------------------------------------------------------------------

/** Everything the engine wants to write. The sink batches these. */
export interface WriteBatch {
  events: PersistableEvent[];
  trips: Trip[];
  roadCells: RoadCell[];
  roadDefects: RoadDefect[];
  predictions: Prediction[];
  scores: Score[];
}

export interface Sink {
  enqueueEvent(e: PersistableEvent): void;
  enqueueTrip(t: Trip): void;
  enqueueRoadCell(c: RoadCell): void;
  enqueueRoadDefect(d: RoadDefect): void;
  enqueuePrediction(p: Prediction): void;
  enqueueScore(s: Score): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** A sink that keeps everything in memory — used by the replay harness and tests. */
export interface MemorySink extends Sink {
  readonly batch: WriteBatch;
}

// ---------------------------------------------------------------------------
// Ingest source
// ---------------------------------------------------------------------------

export interface IngestSource {
  /** Async iterator of rows in arrival order. Dedupe happens inside. */
  start(onRow: (row: RawRow) => Promise<void> | void): Promise<void>;
  stop(): Promise<void>;
}

export const ENGINE_VERSION = '0.1.0';
