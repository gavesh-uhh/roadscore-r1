/**
 * Every tunable number in the engine, in SI, in one versioned object.
 *
 * ENGINE-PLAN §6: "Thresholds below are starting points for Sprint-5
 * calibration, expressed in SI so they survive a full-scale-range change."
 *
 * `RULE_VERSION` is stamped onto every event and score. Bump it whenever a
 * number below changes — re-running history then produces a comparable
 * side-by-side set instead of overwriting the old verdict (§4).
 */

export const RULE_VERSION = '2026.08.09-r1';

export interface Thresholds {
  version: string;
  /** Classroom/lab demo mode: bypasses GPS speed gating and satellite fix requirements for indoor testing. */
  demoMode?: boolean;

  /** Gating shared by every GPS-derived detector (§6.1). */
  gps: {
    minSats: number;
    maxHdop: number;
    /** m/s — below this, speed noise dominates and longitudinal events are suppressed. */
    minSpeedForDynamics: number;
    /** Degraded-GPS integrity rule (§6.7). */
    degradedHdop: number;
    degradedSustainedS: number;
  };

  longitudinal: {
    /** Samples in the centred smoothing window for d(speed)/dt. Must be odd. */
    smoothingWindow: number;
    /** horizontal_peak must contain at least |a_long| minus this slack, m/s². */
    corroborationSlack: number;
    /** rad/s — above this, the excursion is a corner bleeding in, not a brake. */
    cornerSuppressYaw: number;
    /** Fraction of the entry threshold at which an excursion is considered over. */
    hysteresisExit: number;
    brake: { low: number; medium: number; high: number };
    accel: { low: number; medium: number; high: number };
  };

  lateral: {
    /** rad/s and m/s that together define "a corner is happening". */
    cornerYaw: number;
    cornerSpeed: number;
    /** Lateral acceleration bands, m/s² (§6.2). */
    excessive: { low: number; medium: number; high: number };
    /** Tolerance between gyro yaw and GPS-heading-derived yaw, rad/s. */
    gpsYawTolerance: number;
    /** Consistency envelope against horizontal_peak, m/s². */
    consistencyLowSlack: number;
    consistencyHighSlack: number;
  };

  swerve: {
    windowS: number;
    /** rad — accumulated |yaw| over the window. */
    minIntegratedYaw: number;
    /** rad — but net heading change must stay under this. */
    maxNetHeadingChange: number;
    minSpeed: number;
    /** rad/s — what counts as one "excursion". */
    excursionYaw: number;
    minExcursions: number;
  };

  impact: {
    /** EWMA smoothing factor for the per-device vertical baseline (~50 s memory). */
    baselineAlpha: number;
    /** Candidate when vertPeak > max(baseline * mult, absoluteFloor). */
    baselineMultiplier: number;
    /** m/s² (0.40 g). */
    absoluteFloor: number;
    /** Mic peak above baseline * this adds `micConfidenceBonus`. */
    micMultiplier: number;
    micConfidenceBonus: number;
    /** Raw counts — above this the ±2 g axis is railing (§2.4). */
    clipCounts: number;
    /** Collision heuristic: clipped magnitude + speed collapse. */
    collisionSpeedCollapse: number;
  };

  speed: {
    /** A cell needs this much evidence before its p85 is usable as a norm (§6.5). */
    minPassesForNorm: number;
    minDevicesForNorm: number;
    /** Fraction above the cell p85 that counts as speeding. */
    relativeMargin: number;
    /** Bands as a fraction over p85. */
    bands: { low: number; medium: number; high: number };
  };

  duty: {
    /** m/s — below this the vehicle is considered stationary. */
    idleSpeed: number;
    idleSustainedS: number;
    idleBaseConfidence: number;
    idleMicConfidence: number;
    /** Continuous driving before a fatigue event, seconds. */
    fatigueMovingS: number;
    /** A stop this long resets the fatigue timer. */
    fatigueResetStopS: number;
    /** Each further interval escalates severity. */
    fatigueEscalationS: number;
  };

  integrity: {
    /** Resolved-time gap, seconds, that counts as a data gap. */
    gapS: number;
    /** Degrees between successive gravity_ref vectors that implies a moved mount. */
    mountShiftDeg: number;
    /** Driving seconds tolerated with a non-calibrated state. */
    calibrationStaleS: number;
    calibrationMaxAgeMs: number;
    /** `samples` below this means the 50 Hz loop is starving. */
    minSamples: number;
    /** Identical accel_raw across this many rows = stuck sensor. */
    stuckRawRows: number;
    /** dBm — correlated with seq gaps implies device-side queue shedding. */
    weakRssi: number;
  };

  trip: {
    /** Movement above this starts a trip, seconds of it. */
    startSpeed: number;
    startSustainedS: number;
    /** Stationary this long closes the trip. */
    endStationaryS: number;
    /** No data at all for this long abandons an open trip. */
    staleAbandonS: number;
    /** Trips shorter than this are discarded as noise. */
    minDistanceM: number;
    minDurationS: number;
  };

  roadmap: {
    /** H3 resolution — ~9.4 m edge, pothole scale (§7.1). */
    h3Resolution: number;
    /** Number of 45° heading sectors. */
    headingSectors: number;
    /** k-ring radius used when matching an observation to a cell. */
    kRing: number;
    /** Speed normalisation (§7.2): rms_norm = rms * (vRef / max(v, vFloor))^beta. */
    speedRefMps: number;
    speedFloorMps: number;
    beta: number;
    /** Passes slower than this carry no roughness information and are discarded. */
    minPassSpeedMps: number;
    /** Roughness index scaling: index = clamp(rms_norm / scale * 100, 0, 100). */
    roughnessScale: number;
  };

  arbitration: {
    minDistinctDevices: number;
    /** spike_rate at or above → road defect. */
    roadSpikeRate: number;
    /** spike_rate at or below → driver event. */
    driverSpikeRate: number;
    /** Undecided events are written with confidence below this and excluded from scoring. */
    undecidedMaxConfidence: number;
  };

  predict: {
    /** Look-ahead seconds; horizon = clamp(speed * this, minM, maxM). */
    horizonS: number;
    minHorizonM: number;
    maxHorizonM: number;
    /** Cone half-angle at the near and far ends, degrees (§7.4). */
    coneNearDeg: number;
    coneFarDeg: number;
    /** Path sampling step, metres. */
    stepM: number;
    /** Only defects at or above this confidence are warned about. */
    minDefectConfidence: number;
    /** Roughness percentile (0..1) above which a rough-segment warning fires. */
    roughTopFraction: number;
    /** A prediction is resolved `miss` if not traversed within this many seconds. */
    evaluationTimeoutS: number;
    /** Vehicle must come within this distance of the target cell to count as traversed. */
    traversalRadiusM: number;
  };

  scoring: {
    /** Penalty weight per event type. Only driver-attributed types appear here. */
    weights: Record<string, number>;
    severityMultipliers: Record<string, number>;
    /** Exposure divisor constant `k` in score = 100 - 100*penalty/(exposure*k). */
    k: number;
    /** Distance floor so a 100 m trip cannot be scored to zero by one event. */
    minExposureKm: number;
    /** Trips below this GPS coverage are low-confidence and excluded from rollups. */
    minGpsCoverage: number;
  };

  plausibility: {
    maxSpeedKmh: number;
    maxSamples: number;
    /** Operating bounding box — Sri Lanka, generously padded (§3, poisoned-telemetry gate). */
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
  };
}

const isDemoActive = typeof process !== 'undefined' && process.env?.DEMO_MODE === 'true';

export const THRESHOLDS: Thresholds = {
  version: RULE_VERSION,
  demoMode: isDemoActive,

  gps: {
    minSats: isDemoActive ? 0 : 5,
    maxHdop: isDemoActive ? 999 : 2.5,
    minSpeedForDynamics: isDemoActive ? 0 : 2.8, // 10 km/h (bypassed in demo mode)
    degradedHdop: 5,
    degradedSustainedS: 30,
  },

  longitudinal: {
    smoothingWindow: 3,
    corroborationSlack: isDemoActive ? 2.5 : 0.5,
    cornerSuppressYaw: 0.17, // 10 °/s
    hysteresisExit: 0.6,
    brake: isDemoActive
      ? { low: -2.0, medium: -3.5, high: -5.0 }
      : { low: -3.0, medium: -4.5, high: -6.0 },
    accel: isDemoActive
      ? { low: 1.8, medium: 2.8, high: 3.8 }
      : { low: 2.5, medium: 3.5, high: 4.5 },
  },

  lateral: {
    cornerYaw: isDemoActive ? 0.20 : 0.26, // 11.5 °/s in demo mode vs 15 °/s on road
    cornerSpeed: isDemoActive ? 0 : 5.5,
    excessive: isDemoActive
      ? { low: 2.0, medium: 3.5, high: 4.8 }
      : { low: 3.4, medium: 4.9, high: 5.9 },
    gpsYawTolerance: isDemoActive ? 999 : 0.35,
    consistencyLowSlack: 0.5,
    consistencyHighSlack: 0.8,
  },

  swerve: {
    windowS: 8,
    minIntegratedYaw: isDemoActive ? 0.5 : 1.05, // 30° in demo vs 60° on road
    maxNetHeadingChange: isDemoActive ? 999 : 0.35, // 20°
    minSpeed: isDemoActive ? 0 : 8.3, // 30 km/h
    excursionYaw: isDemoActive ? 0.14 : 0.17,
    minExcursions: isDemoActive ? 2 : 3,
  },

  impact: {
    baselineAlpha: 0.02,
    baselineMultiplier: isDemoActive ? 2.5 : 4.0,
    absoluteFloor: isDemoActive ? 2.6 : 3.9, // 0.27 g in demo mode vs 0.40 g on road
    micMultiplier: 2.5,
    micConfidenceBonus: 0.15,
    clipCounts: 13000,
    collisionSpeedCollapse: 1.5,
  },

  speed: {
    minPassesForNorm: 20,
    minDevicesForNorm: 3,
    relativeMargin: 0.1,
    bands: { low: 0.1, medium: 0.25, high: 0.4 },
  },

  duty: {
    idleSpeed: 0.56, // 2 km/h
    idleSustainedS: 180,
    idleBaseConfidence: 0.5,
    idleMicConfidence: 0.7,
    fatigueMovingS: 7200,
    fatigueResetStopS: 300,
    fatigueEscalationS: 3600,
  },

  integrity: {
    gapS: 3,
    mountShiftDeg: 15,
    calibrationStaleS: 300,
    calibrationMaxAgeMs: 3_600_000,
    minSamples: 40,
    stuckRawRows: 10,
    weakRssi: -85,
  },

  trip: {
    startSpeed: 2.8,
    startSustainedS: 5,
    endStationaryS: 90,
    staleAbandonS: 120,
    minDistanceM: 200,
    minDurationS: 60,
  },

  roadmap: {
    h3Resolution: 12,
    headingSectors: 8,
    kRing: 1,
    speedRefMps: 11.11, // 40 km/h
    speedFloorMps: 4.17, // 15 km/h
    beta: 1.0,
    minPassSpeedMps: 4.17,
    roughnessScale: 6.0,
  },

  arbitration: {
    minDistinctDevices: 3,
    roadSpikeRate: 0.6,
    driverSpikeRate: 0.25,
    undecidedMaxConfidence: 0.5,
  },

  predict: {
    horizonS: 15,
    minHorizonM: 50,
    maxHorizonM: 400,
    coneNearDeg: 10,
    coneFarDeg: 25,
    stepM: 9,
    minDefectConfidence: 0.6,
    roughTopFraction: 0.9,
    evaluationTimeoutS: 300,
    traversalRadiusM: 25,
  },

  scoring: {
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
      'driver.collision_suspected': 0,
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
  },

  plausibility: {
    maxSpeedKmh: 250,
    maxSamples: 60,
    latMin: 5.5,
    latMax: 10.2,
    lonMin: 79.4,
    lonMax: 82.1,
  },
};

/** Physical constants and conversions (§2.1). */
export const G = 9.80665;
export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
