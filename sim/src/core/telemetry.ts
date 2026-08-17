/**
 * Physical Sensor Simulation & H3 Observation Engine
 */

import { latLngToCell } from 'h3-js';
import type {
  ActiveEvent,
  PhysicalTelemetry,
  RawAccelCal,
  RawCalibration,
  RawGps,
  RawGyroCal,
  RawMic,
  RawVec3,
  SpeedProfile,
  TelemetryRow,
} from '../types.js';

export const G = 9.80665;
export const DEG2RAD = Math.PI / 180;
export const COUNTS_FULL_SCALE = 32768;

export interface TelemetryGeneratorConfig {
  deviceId: string;
  accelFsG?: number;
  gyroFsDps?: number;
  h3Resolution?: number;
  fwVersion?: string;
}

export class TelemetryGenerator {
  readonly deviceId: string;
  readonly accelFsG: number;
  readonly gyroFsDps: number;
  readonly h3Resolution: number;
  readonly fwVersion: string;

  private seq = 0;
  private uptimeMs = 0;
  private calibrationAgeMs = 0;
  private droppedPosts = 0;

  constructor(config: TelemetryGeneratorConfig) {
    this.deviceId = config.deviceId;
    this.accelFsG = config.accelFsG ?? 2;
    this.gyroFsDps = config.gyroFsDps ?? 250;
    this.h3Resolution = config.h3Resolution ?? 12;
    this.fwVersion = config.fwVersion ?? '1.0.0-sim';
  }

  private accelToCounts(mps2: number): number {
    const countsPerG = COUNTS_FULL_SCALE / this.accelFsG;
    const gVal = mps2 / G;
    return Math.round(gVal * countsPerG);
  }

  private gyroToCounts(radps: number): number {
    const countsPerDps = COUNTS_FULL_SCALE / this.gyroFsDps;
    const dps = radps / DEG2RAD;
    return Math.round(dps * countsPerDps);
  }

  /**
   * Generates realistic physics and sensor measurements based on actual vehicle dynamics,
   * road geometry, heading change, and injected event states.
   */
  generatePhysics(
    lat: number,
    lon: number,
    speedKmh: number,
    previousSpeedKmh: number,
    headingDeg: number,
    previousHeadingDeg: number,
    speedProfile: SpeedProfile,
    activeEvent: ActiveEvent | null,
    deltaSec = 1.0,
  ): PhysicalTelemetry {
    // 1. Calculate longitudinal acceleration: a_long = (v2 - v1) / dt (in m/s²)
    const speedMps = (speedKmh * 1000) / 3600;
    const prevSpeedMps = (previousSpeedKmh * 1000) / 3600;
    let aLong = (speedMps - prevSpeedMps) / deltaSec;

    // 2. Calculate angular yaw rate from heading change along road
    let dHeading = headingDeg - previousHeadingDeg;
    while (dHeading > 180) dHeading -= 360;
    while (dHeading < -180) dHeading += 360;
    const yawRateDps = Math.abs(dHeading) / deltaSec;
    let yawRateRadps = yawRateDps * DEG2RAD;

    // 3. Lateral centripetal acceleration: a_lat = v * yawRate
    let aLat = speedMps * yawRateRadps;

    // Normal driving comfort bounds (when no explicit event is active)
    if (!activeEvent) {
      if (speedProfile === 'normal' || speedProfile === 'cautious') {
        aLat = Math.min(1.8, aLat);
        yawRateRadps = Math.min(0.09, yawRateRadps); // < 5.2 deg/sec
        aLong = Math.max(-1.5, Math.min(1.5, aLong));
      } else if (speedProfile === 'erratic') {
        aLat = Math.min(2.8, aLat);
        yawRateRadps = Math.min(0.18, yawRateRadps);
        aLong = Math.max(-2.4, Math.min(2.4, aLong));
      }
    }

    // 4. Baseline road vibration / noise (depends on speed and profile)
    let baselineVibration = 0.4 + (speedKmh / 100) * 0.3 + (Math.random() - 0.5) * 0.15;
    let horizontalPeak = Math.max(0.15, Math.sqrt(aLong * aLong + aLat * aLat) + (Math.random() - 0.5) * 0.1);
    if (!activeEvent && (speedProfile === 'normal' || speedProfile === 'cautious')) {
      horizontalPeak = Math.min(2.0, horizontalPeak);
    }
    let verticalAccel = baselineVibration;
    let micRms = 110 + speedKmh * 3.5 + Math.random() * 30;
    let micPeak = micRms * (1.8 + Math.random() * 0.4);
    let eventTag = '';

    // Apply speed profile characteristics
    if (speedProfile === 'aggressive' || speedProfile === 'worst') {
      baselineVibration += 0.2;
      micRms += 40;
    }

    // 5. Apply Injected Events
    if (activeEvent) {
      switch (activeEvent.type) {
        case 'rough_road':
        case 'pothole': {
          const mag = activeEvent.magnitude || 3.8;
          verticalAccel = mag + (Math.random() - 0.5) * 1.2;
          micRms = 850 + Math.random() * 200;
          micPeak = micRms * 2.8;
          eventTag = activeEvent.type === 'pothole' ? '💥 [POTHOLE SPIKE]' : '〰️ [ROUGH ROAD]';
          break;
        }
        case 'hard_brake': {
          aLong = -Math.abs(activeEvent.magnitude || 5.8);
          horizontalPeak = Math.abs(aLong) + 0.4;
          micRms += 150;
          eventTag = '🛑 [HARSH BRAKE]';
          break;
        }
        case 'hard_accel': {
          aLong = Math.abs(activeEvent.magnitude || 4.5);
          horizontalPeak = aLong + 0.3;
          micRms += 200;
          eventTag = '🚀 [HARSH ACCEL]';
          break;
        }
        case 'sharp_turn': {
          yawRateRadps = (activeEvent.magnitude || 24) * DEG2RAD;
          aLat = speedMps * yawRateRadps;
          horizontalPeak = Math.max(5.0, aLat);
          eventTag = '↩️ [SHARP TURN]';
          break;
        }
        case 'swerve': {
          yawRateRadps = 0.38;
          horizontalPeak = 6.2;
          eventTag = '〰️ [SWERVING]';
          break;
        }
        case 'impact': {
          verticalAccel = 6.5 + Math.random() * 2.0;
          horizontalPeak = 7.0;
          micRms = 1800;
          micPeak = 3900;
          eventTag = '⚠️ [IMPACT EVENT]';
          break;
        }
        default:
          break;
      }
    }

    // 6. Calculate total magnitude peak
    const magnitudePeak = Math.sqrt(G * G + verticalAccel * verticalAccel + horizontalPeak * horizontalPeak);

    // 7. Calculate H3 Cell resolution 12
    let h3Cell = '';
    try {
      h3Cell = latLngToCell(lat, lon, this.h3Resolution);
    } catch {
      h3Cell = '8c28308280fffff';
    }

    return {
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      speedKmh: Number(speedKmh.toFixed(1)),
      heading: Math.round(headingDeg),
      gpsFix: true,
      sats: 10 + Math.floor(Math.random() * 3),
      hdop: Number((0.8 + Math.random() * 0.3).toFixed(2)),
      verticalAccelMps2: Number(verticalAccel.toFixed(2)),
      horizontalPeakMps2: Number(horizontalPeak.toFixed(2)),
      magnitudePeakMps2: Number(magnitudePeak.toFixed(2)),
      yawRateRadps: Number(yawRateRadps.toFixed(3)),
      pitchRateRadps: Number((0.01 * (Math.random() - 0.5)).toFixed(3)),
      rollRateRadps: Number((0.01 * (Math.random() - 0.5)).toFixed(3)),
      micRms: Math.round(micRms),
      micPeak: Math.round(micPeak),
      samplesCount: 50,
      wifiRssi: -58 - Math.floor(Math.random() * 10),
      h3Cell,
      eventTag,
    };
  }

  /**
   * Formats physical telemetry into exact Supabase `public.telemetry` schema row.
   */
  formatRow(telemetry: PhysicalTelemetry, timestamp: Date = new Date(), deltaSec = 1.0): TelemetryRow {
    this.seq++;
    this.uptimeMs += Math.round(deltaSec * 1000);
    this.calibrationAgeMs += Math.round(deltaSec * 1000);

    const vertPeakCounts = this.accelToCounts(telemetry.verticalAccelMps2);
    const horizPeakCounts = this.accelToCounts(telemetry.horizontalPeakMps2);
    const magPeakCounts = this.accelToCounts(telemetry.magnitudePeakMps2);

    const yawRateCounts = this.gyroToCounts(telemetry.yawRateRadps);
    const pitchRateCounts = this.gyroToCounts(telemetry.pitchRateRadps);
    const rollRateCounts = this.gyroToCounts(telemetry.rollRateRadps);

    // Standard leveled gravity reference vector [0, 0, 1]
    const gravityRef: RawVec3 = { x: 0, y: 0, z: 1 };

    const accelRaw: RawVec3 = {
      x: Math.round(Math.random() * 20 - 10),
      y: Math.round(Math.random() * 20 - 10),
      z: vertPeakCounts,
    };

    const gyroRaw: RawVec3 = {
      x: rollRateCounts,
      y: pitchRateCounts,
      z: yawRateCounts,
    };

    const accelCal: RawAccelCal = {
      vertical_peak: vertPeakCounts,
      vertical_rms: Math.round(vertPeakCounts * 0.707),
      horizontal_peak: horizPeakCounts,
      magnitude_peak: magPeakCounts,
    };

    const gyroCal: RawGyroCal = {
      yaw_rate_peak: yawRateCounts,
      pitch_rate_peak: pitchRateCounts,
      roll_rate_peak: rollRateCounts,
    };

    const mic: RawMic = {
      rms: telemetry.micRms,
      peak: telemetry.micPeak,
    };

    const gps: RawGps = {
      fix: telemetry.gpsFix,
      lat: telemetry.lat,
      lon: telemetry.lon,
      speed_kmh: telemetry.speedKmh,
      heading: telemetry.heading,
      altitude: 15,
      sats: telemetry.sats,
      hdop: telemetry.hdop,
    };

    const calibration: RawCalibration = {
      state: 'calibrated',
      age_ms: this.calibrationAgeMs,
      gravity_ref: gravityRef,
    };

    return {
      device_id: this.deviceId,
      seq: this.seq,
      ts: timestamp.toISOString(),
      uptime_ms: this.uptimeMs,
      window_ms: 1000,
      samples: telemetry.samplesCount,
      calibration,
      accel_raw: accelRaw,
      gyro_raw: gyroRaw,
      accel_cal: accelCal,
      gyro_cal: gyroCal,
      mic,
      gps,
      wifi_rssi: telemetry.wifiRssi,
      accel_fs_g: this.accelFsG,
      gyro_fs_dps: this.gyroFsDps,
      fw_version: this.fwVersion,
      dropped_posts: this.droppedPosts,
      server_received_at: timestamp.toISOString(),
      source: 'simulator',
    };
  }
}
