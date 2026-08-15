/**
 * Hardware Device Emulator — ENGINE-PLAN §2, §3, §10.
 *
 * Accurately emulates an ESP32 micro-controller board running firmware
 * (`roadscore-mcu.ino`) with:
 *   - MPU6050 accelerometer / gyroscope (raw 16-bit counts)
 *   - NEO-6M GPS module (NMEA fix state, HDOP, satellites, lat/lon, speed_kmh)
 *   - Analog ADC microphone (unitless relative sound level 0..4095)
 *   - WiFi RSSI signal strength & dropped posts queue
 *   - Boot / power-cycle sequence & stateful gravity self-calibration
 */

import { COUNTS_FULL_SCALE } from '../domain/normalize.js';
import { DEG2RAD, G } from '../config/thresholds.js';
import type { RawRow } from '../types.js';

export interface PhysicalState {
  /** Latitude in decimal degrees (e.g. 6.9271) */
  lat: number | null;
  /** Longitude in decimal degrees (e.g. 79.8612) */
  lon: number | null;
  /** Speed in km/h */
  speedKmh: number | null;
  /** GPS Heading in degrees (0..360) */
  heading: number | null;
  /** GPS Fix state */
  gpsFix: boolean;
  /** Satellites in view */
  sats: number;
  /** HDOP horizontal dilution of precision */
  hdop: number;

  /** Vertical acceleration in m/s² (gravity = ~9.81) */
  verticalAccelMps2: number;
  /** Horizontal peak acceleration in m/s² */
  horizontalPeakMps2: number;
  /** Total magnitude peak in m/s² */
  magnitudePeakMps2: number;

  /** Yaw rate peak in rad/s */
  yawRateRadps: number;
  /** Pitch rate peak in rad/s */
  pitchRateRadps: number;
  /** Roll rate peak in rad/s */
  rollRateRadps: number;

  /** Mic RMS energy (0..4095) */
  micRms: number;
  /** Mic Peak energy (0..4095) */
  micPeak: number;

  /** Samples collected by 50 Hz loop in 1s window (normally ~50) */
  samplesCount: number;
  /** WiFi RSSI in dBm (e.g. -65) */
  wifiRssi: number;
}

export interface DeviceSimOptions {
  deviceId: string;
  fwVersion?: string;
  accelFsG?: number;
  gyroFsDps?: number;
  /** Initial calibration delay in seconds before state transitions to 'calibrated' */
  calibrationWarmupSec?: number;
  /** Initial mount orientation roll angle in degrees */
  mountRollDeg?: number;
  /** Initial mount orientation pitch angle in degrees */
  mountPitchDeg?: number;
}

export class HardwareDevice {
  readonly deviceId: string;
  readonly fwVersion: string;
  readonly accelFsG: number;
  readonly gyroFsDps: number;

  private seq = 0;
  private uptimeMs = 0;
  private droppedPosts = 0;
  private bootCount = 1;
  private telemetryIdCounter = Math.floor(Math.random() * 1_000_000) + 1;

  private calibrationState: 'uncalibrated' | 'calibrated' = 'uncalibrated';
  private calibrationAgeMs = 0;
  private calibrationWarmupSec: number;

  private mountRollDeg: number;
  private mountPitchDeg: number;

  constructor(options: DeviceSimOptions) {
    this.deviceId = options.deviceId;
    this.fwVersion = options.fwVersion ?? '1.0.0-mcu';
    this.accelFsG = options.accelFsG ?? 2;
    this.gyroFsDps = options.gyroFsDps ?? 250;
    this.calibrationWarmupSec = options.calibrationWarmupSec ?? 5;
    this.mountRollDeg = options.mountRollDeg ?? 0;
    this.mountPitchDeg = options.mountPitchDeg ?? 0;
  }

  /** Reset hardware power state (simulating ESP32 brownout / reboot) */
  reboot(): void {
    this.seq = 0;
    this.uptimeMs = 0;
    this.bootCount++;
    this.calibrationState = 'uncalibrated';
    this.calibrationAgeMs = 0;
  }

  /** Simulate physical mount shifting mid-drive (e.g. phone/sensor knocked by deltaDeg) */
  shiftMount(deltaRollDeg: number, deltaPitchDeg: number): void {
    this.mountRollDeg += deltaRollDeg;
    this.mountPitchDeg += deltaPitchDeg;
  }

  /** Increment dropped posts counter (e.g. WiFi connection dropped payload) */
  recordDroppedPost(): void {
    this.droppedPosts++;
  }

  /** Compute current unit gravity vector based on device mount orientation */
  private getGravityRef(): { x: number; y: number; z: number } {
    const roll = this.mountRollDeg * DEG2RAD;
    const pitch = this.mountPitchDeg * DEG2RAD;

    // Unit gravity vector components
    const gx = Math.sin(pitch);
    const gy = -Math.sin(roll) * Math.cos(pitch);
    const gz = Math.cos(roll) * Math.cos(pitch);

    const mag = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    return {
      x: Number((gx / mag).toFixed(4)),
      y: Number((gy / mag).toFixed(4)),
      z: Number((gz / mag).toFixed(4)),
    };
  }

  /** Physical m/s² -> MPU6050 raw counts */
  private accelToCounts(mps2: number): number {
    const countsPerG = COUNTS_FULL_SCALE / this.accelFsG;
    const g = mps2 / G;
    return Math.round(g * countsPerG);
  }

  /** Physical rad/s -> MPU6050 gyro counts */
  private gyroToCounts(radps: number): number {
    const countsPerDps = COUNTS_FULL_SCALE / this.gyroFsDps;
    const dps = radps / DEG2RAD;
    return Math.round(dps * countsPerDps);
  }

  /**
   * Step the hardware simulator forward by `deltaSec` (default 1.0s) and emit
   * a raw JSON telemetry row matching MCU firmware payload format.
   */
  step(state: PhysicalState, timestamp: Date = new Date(), deltaSec = 1.0): RawRow {
    this.seq++;
    this.uptimeMs += Math.round(deltaSec * 1000);
    this.telemetryIdCounter++;

    // Update calibration age
    this.calibrationAgeMs += Math.round(deltaSec * 1000);
    if (
      this.calibrationState === 'uncalibrated' &&
      this.calibrationAgeMs >= this.calibrationWarmupSec * 1000
    ) {
      this.calibrationState = 'calibrated';
    }

    const vertPeakCounts = this.accelToCounts(state.verticalAccelMps2);
    const horizPeakCounts = this.accelToCounts(state.horizontalPeakMps2);
    const magPeakCounts = this.accelToCounts(state.magnitudePeakMps2);

    const yawRateCounts = this.gyroToCounts(state.yawRateRadps);
    const pitchRateCounts = this.gyroToCounts(state.pitchRateRadps);
    const rollRateCounts = this.gyroToCounts(state.rollRateRadps);

    const gravityRef = this.getGravityRef();

    const row: RawRow = {
      id: this.telemetryIdCounter,
      device_id: this.deviceId,
      ts: state.gpsFix && timestamp ? timestamp.toISOString() : null,
      uptime_ms: this.uptimeMs,
      window_ms: 1000,
      seq: this.seq,
      samples: state.samplesCount,

      accel_raw: {
        x: Math.round(gravityRef.x * (COUNTS_FULL_SCALE / this.accelFsG)),
        y: Math.round(gravityRef.y * (COUNTS_FULL_SCALE / this.accelFsG)),
        z: vertPeakCounts,
      },

      accel_cal: {
        vertical_peak: vertPeakCounts,
        vertical_rms: Math.round(vertPeakCounts * 0.707),
        horizontal_peak: horizPeakCounts,
        magnitude_peak: magPeakCounts,
      },

      gyro_raw: {
        x: rollRateCounts,
        y: pitchRateCounts,
        z: yawRateCounts,
      },

      gyro_cal: {
        yaw_rate_peak: yawRateCounts,
        pitch_rate_peak: pitchRateCounts,
        roll_rate_peak: rollRateCounts,
      },

      gps: state.gpsFix
        ? {
            fix: true,
            lat: state.lat,
            lon: state.lon,
            speed_kmh: state.speedKmh,
            heading: state.heading,
            sats: state.sats,
            hdop: state.hdop,
          }
        : {
            fix: false,
            lat: null,
            lon: null,
            speed_kmh: null,
            heading: null,
            sats: state.sats,
            hdop: state.hdop,
          },

      mic: {
        rms: Math.min(4095, Math.max(0, Math.round(state.micRms))),
        peak: Math.min(4095, Math.max(0, Math.round(state.micPeak))),
      },

      calibration: {
        state: this.calibrationState,
        age_ms: this.calibrationAgeMs,
        gravity_ref: gravityRef,
      },

      wifi_rssi: state.wifiRssi,
      accel_fs_g: this.accelFsG,
      gyro_fs_dps: this.gyroFsDps,
      fw_version: this.fwVersion,
      dropped_posts: this.droppedPosts,
      server_received_at: timestamp.toISOString(),
    };

    return row;
  }
}
