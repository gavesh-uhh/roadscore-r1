/**
 * RoadScore Simulator — Type Definitions
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface PlacePreset {
  id: string;
  name: string;
  lat: number;
  lon: number;
  description?: string;
}

export interface RoutePoint extends LatLon {
  distanceFromStartM: number;
  segmentHeadingDeg: number;
}

export interface SimulationRoute {
  id: string;
  name: string;
  originName: string;
  destinationName: string;
  origin: LatLon;
  destination: LatLon;
  coordinates: [number, number][]; // [lon, lat] per GeoJSON
  points: RoutePoint[];
  totalDistanceM: number;
  estimatedDurationS: number;
  isCached: boolean;
  fetchedAt?: number;
}

export type DriverStatus = 'RUNNING' | 'PAUSED' | 'IDLE' | 'COMPLETED' | 'EVENT';

export type SpeedProfile = 'normal' | 'aggressive' | 'cautious' | 'worst' | 'erratic';

export type SimEventType =
  | 'normal'
  | 'rough_road'
  | 'hard_brake'
  | 'hard_accel'
  | 'sharp_turn'
  | 'swerve'
  | 'impact'
  | 'pothole';

export interface ActiveEvent {
  type: SimEventType;
  label: string;
  remainingTicks: number;
  magnitude: number;
  startedAt: number;
}

export interface PhysicalTelemetry {
  lat: number;
  lon: number;
  speedKmh: number;
  heading: number;
  gpsFix: boolean;
  sats: number;
  hdop: number;
  verticalAccelMps2: number;
  horizontalPeakMps2: number;
  magnitudePeakMps2: number;
  yawRateRadps: number;
  pitchRateRadps: number;
  rollRateRadps: number;
  micRms: number;
  micPeak: number;
  samplesCount: number;
  wifiRssi: number;
  h3Cell: string;
  eventTag?: string;
}

export interface RawVec3 {
  x: number;
  y: number;
  z: number;
}

export interface RawAccelCal {
  vertical_peak: number;
  vertical_rms: number;
  horizontal_peak: number;
  magnitude_peak: number;
}

export interface RawGyroCal {
  yaw_rate_peak: number;
  pitch_rate_peak: number;
  roll_rate_peak: number;
}

export interface RawGps {
  fix: boolean;
  lat: number | null;
  lon: number | null;
  speed_kmh: number | null;
  heading: number | null;
  altitude?: number | null;
  sats: number;
  hdop: number;
}

export interface RawMic {
  rms: number;
  peak: number;
}

export interface RawCalibration {
  state: 'calibrated' | 'uncalibrated' | 'calibrating';
  age_ms: number;
  gravity_ref: RawVec3;
}

/** Exact shape expected by Supabase public.telemetry table */
export interface TelemetryRow {
  id?: number;
  device_id: string;
  seq: number;
  ts: string | null;
  uptime_ms: number;
  window_ms: number;
  samples: number;
  calibration: RawCalibration;
  accel_raw: RawVec3;
  gyro_raw: RawVec3;
  accel_cal: RawAccelCal;
  gyro_cal: RawGyroCal;
  mic: RawMic;
  gps: RawGps;
  wifi_rssi: number;
  accel_fs_g: number;
  gyro_fs_dps: number;
  fw_version: string;
  dropped_posts: number;
  server_received_at?: string;
  source?: string;
}

export interface DriverState {
  driverId: string;
  vehicleId: string;
  tripId: string;
  route: SimulationRoute;
  status: DriverStatus;
  speedProfile: SpeedProfile;
  currentDistanceM: number;
  progressPercent: number;
  currentSpeedKmh: number;
  targetSpeedKmh: number;
  currentPosition: LatLon;
  currentHeading: number;
  currentH3Cell: string;
  currentRouteIndex: number;
  activeEvent: ActiveEvent | null;
  lastTelemetry: PhysicalTelemetry | null;
  pointsSentCount: number;
  eventsTriggeredCount: number;
  loopOnComplete: boolean;
  isPaused: boolean;
}

export interface SimulatorStats {
  pointsSent: number;
  activeVehicles: number;
  totalVehicles: number;
  h3CellsObserved: Set<string>;
  eventsTriggered: number;
  routingStatus: 'OK' | 'OFFLINE' | 'FETCHING' | 'CACHED';
  supabaseStatus: 'OK' | 'OFFLINE' | 'SENDING' | 'CONNECTING';
  simSpeedMultiplier: number;
  isPaused: boolean;
  uptimeSeconds: number;
  lastError?: string;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  drivers: {
    driverId: string;
    vehicleId: string;
    origin: string | LatLon;
    destination: string | LatLon;
    speedProfile: SpeedProfile;
    initialDelayS?: number;
    loopOnComplete?: boolean;
    initialEvents?: {
      triggerAfterDistanceM: number;
      event: SimEventType;
      magnitude?: number;
      durationS?: number;
    }[];
  }[];
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'event' | 'telemetry';
  message: string;
}

export type TuiView =
  | 'dashboard'
  | 'drivers'
  | 'driver_detail'
  | 'add_driver'
  | 'trigger_event'
  | 'scenarios'
  | 'telemetry'
  | 'routes'
  | 'logs'
  | 'help';
