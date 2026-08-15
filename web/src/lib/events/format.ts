export interface EventMetadata {
  label: string;
  category: 'driver' | 'road' | 'integrity' | 'system';
  categoryLabel: string;
  description: string;
  badgeClass: string;
  dotColor: string;
}

export const EVENT_DEFINITIONS: Record<string, EventMetadata> = {
  // Driver Behavior Events
  'driver.harsh_brake': {
    label: 'Harsh Braking',
    category: 'driver',
    categoryLabel: 'Driver Behavior',
    description: 'Sudden deceleration exceeding safe longitudinal braking thresholds (>3.6 m/s²).',
    badgeClass: 'bg-rose-950 text-rose-400 border border-rose-800/60',
    dotColor: '#f43f5e',
  },
  'driver.harsh_accel': {
    label: 'Rapid Acceleration',
    category: 'driver',
    categoryLabel: 'Driver Behavior',
    description: 'Aggressive acceleration forward exceeding standard vehicle efficiency limits (>3.2 m/s²).',
    badgeClass: 'bg-amber-950 text-amber-400 border border-amber-800/60',
    dotColor: '#f59e0b',
  },
  'driver.sharp_corner': {
    label: 'Aggressive Cornering',
    category: 'driver',
    categoryLabel: 'Driver Behavior',
    description: 'High lateral acceleration or yaw rate while turning through a curve (>0.30 rad/s).',
    badgeClass: 'bg-amber-950 text-amber-400 border border-amber-800/60',
    dotColor: '#f59e0b',
  },
  'driver.excessive_cornering_speed': {
    label: 'Excessive Speed in Turn',
    category: 'driver',
    categoryLabel: 'Driver Behavior',
    description: 'Vehicle entering a sharp turn at a speed significantly above road geometry capacity.',
    badgeClass: 'bg-rose-950 text-rose-400 border border-rose-800/60',
    dotColor: '#f43f5e',
  },
  'driver.swerving': {
    label: 'Sudden Swerving',
    category: 'driver',
    categoryLabel: 'Driver Behavior',
    description: 'Rapid alternating lateral steering adjustments indicating distraction or erratic maneuvering.',
    badgeClass: 'bg-rose-950 text-rose-400 border border-rose-800/60',
    dotColor: '#f43f5e',
  },
  'driver.avoidable_impact': {
    label: 'Avoidable Road Impact',
    category: 'driver',
    categoryLabel: 'Driver Behavior',
    description: 'High-speed impact over a known mapped defect where braking was neglected.',
    badgeClass: 'bg-rose-950 text-rose-400 border border-rose-800/60',
    dotColor: '#f43f5e',
  },
  'driver.speeding_relative': {
    label: 'Relative Speeding',
    category: 'driver',
    categoryLabel: 'Driver Behavior',
    description: 'Vehicle speed significantly exceeds the 85th percentile fleet baseline for this road segment.',
    badgeClass: 'bg-amber-950 text-amber-400 border border-amber-800/60',
    dotColor: '#f59e0b',
  },
  'driver.speeding_for_conditions': {
    label: 'Speeding in Rough Conditions',
    category: 'driver',
    categoryLabel: 'Driver Behavior',
    description: 'Operating at high speeds over severely rough or deteriorated road surface sectors.',
    badgeClass: 'bg-amber-950 text-amber-400 border border-amber-800/60',
    dotColor: '#f59e0b',
  },
  'driver.excessive_idling': {
    label: 'Excessive Idling',
    category: 'driver',
    categoryLabel: 'Driver Behavior',
    description: 'Engine active with zero vehicle movement for an extended duration.',
    badgeClass: 'bg-zinc-800 text-zinc-300 border border-zinc-700',
    dotColor: '#a1a1aa',
  },
  'driver.continuous_driving': {
    label: 'Prolonged Driving (Fatigue Risk)',
    category: 'driver',
    categoryLabel: 'Driver Behavior',
    description: 'Continuous driving without a mandatory rest stop exceeding safety regulations.',
    badgeClass: 'bg-amber-950 text-amber-400 border border-amber-800/60',
    dotColor: '#f59e0b',
  },
  'driver.collision_suspected': {
    label: 'Suspected Collision',
    category: 'driver',
    categoryLabel: 'Driver Behavior',
    description: 'Extreme multi-axis shock spike combined with rapid speed drop indicating a potential crash.',
    badgeClass: 'bg-rose-950 text-rose-400 border border-rose-800/60 font-bold',
    dotColor: '#ef4444',
  },

  // Road Network & Defect Events
  'road.impact_candidate': {
    label: 'Road Impact Candidate',
    category: 'road',
    categoryLabel: 'Road Quality',
    description: 'Isolated vertical acceleration spike from road surface irregularity awaiting multi-pass arbitration.',
    badgeClass: 'bg-sky-950 text-sky-400 border border-sky-800/60',
    dotColor: '#38bdf8',
  },
  'road.defect_observation': {
    label: 'Confirmed Road Defect',
    category: 'road',
    categoryLabel: 'Road Quality',
    description: 'Cross-validated surface anomaly verified across multiple vehicle passes.',
    badgeClass: 'bg-indigo-950 text-indigo-400 border border-indigo-800/60',
    dotColor: '#818cf8',
  },
  'road.pothole_impact': {
    label: 'Pothole Impact',
    category: 'road',
    categoryLabel: 'Road Quality',
    description: 'Severe vertical shock paired with acoustic spike confirming road surface depression.',
    badgeClass: 'bg-sky-950 text-sky-400 border border-sky-800/60',
    dotColor: '#38bdf8',
  },
  'road.rough_segment': {
    label: 'Rough Road Segment',
    category: 'road',
    categoryLabel: 'Road Quality',
    description: 'Sustained elevated vertical RMS vibration over a continuous road section.',
    badgeClass: 'bg-sky-950 text-sky-400 border border-sky-800/60',
    dotColor: '#38bdf8',
  },

  // Hardware & Integrity Events
  'integrity.data_gap': {
    label: 'Telemetry Data Gap',
    category: 'integrity',
    categoryLabel: 'Hardware Integrity',
    description: 'Missing sequence packet or time gap (>3s) detected during transmission.',
    badgeClass: 'bg-zinc-900 text-zinc-400 border border-zinc-800',
    dotColor: '#71717a',
  },
  'integrity.device_reboot': {
    label: 'Hardware Reboot / Power Cycle',
    category: 'integrity',
    categoryLabel: 'Hardware Integrity',
    description: 'ESP32 device microcontroller experienced a reboot or power interruption.',
    badgeClass: 'bg-amber-950 text-amber-400 border border-amber-800/60',
    dotColor: '#f59e0b',
  },
  'integrity.mount_shift': {
    label: 'Mount Shift / Displaced',
    category: 'integrity',
    categoryLabel: 'Hardware Integrity',
    description: 'Persistent gravity vector orientation offset detected; hardware requires re-anchoring.',
    badgeClass: 'bg-rose-950 text-rose-400 border border-rose-800/60',
    dotColor: '#f43f5e',
  },
  'integrity.calibration_stale': {
    label: 'Stale Calibration',
    category: 'integrity',
    categoryLabel: 'Hardware Integrity',
    description: 'IMU orientation calibration matrix has aged out and needs stationary re-leveling.',
    badgeClass: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
    dotColor: '#a1a1aa',
  },
  'integrity.sensor_degraded': {
    label: 'Sensor Degradation (Clipping/Noise)',
    category: 'integrity',
    categoryLabel: 'Hardware Integrity',
    description: 'Accelerometer or gyroscope reports signal clipping, noise floor elevation, or stuck axis.',
    badgeClass: 'bg-rose-950 text-rose-400 border border-rose-800/60',
    dotColor: '#f43f5e',
  },
  'integrity.gps_degraded': {
    label: 'Degraded GPS Fix',
    category: 'integrity',
    categoryLabel: 'Hardware Integrity',
    description: 'Low satellite count (<4) or high HDOP (>2.5) degrading positional accuracy.',
    badgeClass: 'bg-amber-950 text-amber-400 border border-amber-800/60',
    dotColor: '#f59e0b',
  },
  'integrity.upload_loss': {
    label: 'Network Upload Drop',
    category: 'integrity',
    categoryLabel: 'Hardware Integrity',
    description: 'Weak cellular/WiFi signal (RSSI < -85 dBm) causing device-side queue shedding.',
    badgeClass: 'bg-zinc-900 text-zinc-400 border border-zinc-800',
    dotColor: '#71717a',
  },
};

/**
 * Format any raw event type key into a readable metadata object.
 */
export function formatEventType(type: string): EventMetadata {
  if (!type) {
    return {
      label: 'Unknown Event',
      category: 'system',
      categoryLabel: 'System',
      description: 'Unspecified telematics event.',
      badgeClass: 'bg-zinc-800 text-zinc-400 border border-zinc-700',
      dotColor: '#71717a',
    };
  }

  const normalized = type.toLowerCase().trim();
  if (EVENT_DEFINITIONS[normalized]) {
    return EVENT_DEFINITIONS[normalized];
  }

  // Smart fallback for unknown or prefixed types:
  const parts = normalized.split('.');
  const categoryKey = parts.length > 1 ? parts[0] : 'system';
  const namePart = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];

  const cleanLabel = namePart
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const categoryLabel =
    categoryKey === 'driver'
      ? 'Driver Behavior'
      : categoryKey === 'road'
      ? 'Road Quality'
      : categoryKey === 'integrity' || categoryKey === 'sensor'
      ? 'Hardware Integrity'
      : 'System Event';

  const category = (
    categoryKey === 'driver' ? 'driver' : categoryKey === 'road' ? 'road' : categoryKey === 'integrity' ? 'integrity' : 'system'
  ) as EventMetadata['category'];

  return {
    label: cleanLabel,
    category,
    categoryLabel,
    description: `Recorded ${categoryLabel.toLowerCase()} telematics event.`,
    badgeClass: 'bg-zinc-900 text-zinc-300 border border-zinc-800',
    dotColor: '#a1a1aa',
  };
}

/**
 * Quick helper returning only the human-readable event label string.
 */
export function getEventLabel(type: string): string {
  return formatEventType(type).label;
}

/**
 * Quick helper returning category display title.
 */
export function getEventCategoryLabel(categoryOrType: string): string {
  if (categoryOrType === 'driver') return 'Driver Behavior';
  if (categoryOrType === 'road') return 'Road Quality';
  if (categoryOrType === 'integrity' || categoryOrType === 'sensor') return 'Hardware Integrity';
  return formatEventType(categoryOrType).categoryLabel;
}
