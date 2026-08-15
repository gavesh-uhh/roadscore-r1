'use client';

import React from 'react';
import {
  Cpu,
  Wifi,
  ShieldCheck,
  Activity,
  Gauge,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Car,
  User,
  Calendar,
  Layers,
  Zap,
} from 'lucide-react';

export type CalibrationState = 'calibrated' | 'uncalibrated' | 'degraded';

export interface DeviceMetadata {
  device_id: string;
  vehicle_id: string;
  driver_id: string;
  accel_fs_g: string | number;
  gyro_fs_dps: string | number;
  installed_at: string;
  active: boolean;
  // Optional telemetry / diagnostic properties embedded in device
  free_heap_kb?: number;
  wifi_rssi_dbm?: number;
  dropped_posts?: number;
  firmware_version?: string;
  gravity_vector?: { x: number; y: number; z: number };
  mount_shift_angle_deg?: number;
  calibration_state?: CalibrationState;
}

export interface DeviceHealthHeaderProps {
  device: DeviceMetadata;
  // Optional explicit overrides for telemetry values
  freeHeapKb?: number;
  wifiRssiDbm?: number;
  droppedPosts?: number;
  firmwareVersion?: string;
  gravityVector?: { x: number; y: number; z: number };
  mountShiftAngleDeg?: number;
  calibrationState?: CalibrationState;
}

/**
 * DeviceHealthHeader displays metadata, ESP32 firmware diagnostics,
 * and 3-Axis IMU calibration & gravity lock status for a hardware unit.
 */
export const DeviceHealthHeader: React.FC<DeviceHealthHeaderProps> = ({
  device,
  freeHeapKb = device.free_heap_kb ?? 184,
  wifiRssiDbm = device.wifi_rssi_dbm ?? -62,
  droppedPosts = device.dropped_posts ?? 0,
  firmwareVersion = device.firmware_version ?? '1.0.0-mcu',
  gravityVector = device.gravity_vector ?? { x: 0, y: 0, z: 16384 },
  mountShiftAngleDeg = device.mount_shift_angle_deg ?? 0.4,
  calibrationState = device.calibration_state ?? 'calibrated',
}) => {
  // WiFi signal indicator helper
  const getWifiSignalQuality = (rssi: number) => {
    if (rssi >= -55) return { label: 'Excellent', color: 'text-emerald-400', bg: 'bg-emerald-500' };
    if (rssi >= -68) return { label: 'Good', color: 'text-emerald-400', bg: 'bg-emerald-500' };
    if (rssi >= -78) return { label: 'Fair', color: 'text-amber-400', bg: 'bg-amber-500' };
    return { label: 'Poor', color: 'text-rose-400', bg: 'bg-rose-500' };
  };

  const wifiQuality = getWifiSignalQuality(wifiRssiDbm);

  // Calibration badge styling
  const getCalibrationBadge = (state: CalibrationState) => {
    switch (state) {
      case 'calibrated':
        return {
          label: 'Calibrated',
          icon: CheckCircle2,
          containerClass: 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60',
          dotClass: 'bg-emerald-400',
        };
      case 'degraded':
        return {
          label: 'Degraded',
          icon: AlertTriangle,
          containerClass: 'bg-amber-950/80 text-amber-400 border-amber-800/60',
          dotClass: 'bg-amber-400',
        };
      case 'uncalibrated':
        return {
          label: 'Uncalibrated',
          icon: XCircle,
          containerClass: 'bg-rose-950/80 text-rose-400 border-rose-800/60',
          dotClass: 'bg-rose-400',
        };
    }
  };

  const calBadge = getCalibrationBadge(calibrationState);
  const CalIcon = calBadge.icon;

  // Format date safely
  const formattedInstallDate = React.useMemo(() => {
    try {
      const d = new Date(device.installed_at);
      if (isNaN(d.getTime())) return device.installed_at;
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return device.installed_at;
    }
  }, [device.installed_at]);

  return (
    <div className="w-full space-y-4 font-sans text-xs">
      {/* Top Banner & Device Identity Card */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          {/* Device Header Info */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-zinc-900 border border-zinc-800 text-emerald-400">
              <Cpu size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white font-mono tracking-wide">
                  {device.device_id}
                </h1>
                <span
                  className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1.5 font-mono ${
                    device.active
                      ? 'bg-zinc-900 text-emerald-400 border-zinc-800'
                      : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-sm ${
                      device.active ? 'bg-emerald-400' : 'bg-zinc-600'
                    }`}
                  />
                  {device.active ? 'Active' : 'Offline'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5 font-sans">
                ESP32 MCU Telematics Module & Real-Time IMU Streamer
              </p>
            </div>
          </div>

          {/* Quick Specs / Metadata Pill list */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/80 border border-zinc-800/60 text-zinc-300">
              <Car size={13} className="text-zinc-500" />
              <span className="text-zinc-500">Vehicle:</span>
              <span className="font-mono text-white font-medium">{device.vehicle_id}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/80 border border-zinc-800/60 text-zinc-300">
              <User size={13} className="text-zinc-500" />
              <span className="text-zinc-500">Driver:</span>
              <span className="font-mono text-white font-medium">{device.driver_id}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900/80 border border-zinc-800/60 text-zinc-300">
              <Calendar size={13} className="text-zinc-500" />
              <span className="text-zinc-500">Installed:</span>
              <span suppressHydrationWarning className="text-white font-medium">{formattedInstallDate}</span>
            </div>
          </div>
        </div>

        {/* Hardware Full Scale Configuration Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-black p-3 rounded-md border border-zinc-800">
            <span className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider flex items-center gap-1">
              <Layers size={11} className="text-zinc-400" />
              Accel Full Scale
            </span>
            <p className="text-sm font-bold text-white font-mono mt-1">
              ±{device.accel_fs_g}g
            </p>
          </div>

          <div className="bg-black p-3 rounded-md border border-zinc-800">
            <span className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider flex items-center gap-1">
              <Zap size={11} className="text-zinc-400" />
              Gyro Full Scale
            </span>
            <p className="text-sm font-bold text-white font-mono mt-1">
              ±{device.gyro_fs_dps} dps
            </p>
          </div>

          <div className="bg-black p-3 rounded-md border border-zinc-800">
            <span className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">
              Sampling Rate
            </span>
            <p className="text-sm font-bold text-emerald-400 font-mono mt-1">
              50 Hz
            </p>
          </div>

          <div className="bg-black p-3 rounded-md border border-zinc-800">
            <span className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">
              Hardware Arch
            </span>
            <p className="text-sm font-bold text-zinc-300 font-mono mt-1">
              ESP32 + MPU6050
            </p>
          </div>
        </div>
      </div>

      {/* Grid containing ESP32 Firmware Diagnostics & 3-Axis IMU Calibration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ESP32 Firmware Diagnostics Card */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <div className="flex items-center gap-2">
              <Cpu size={15} className="text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                ESP32 Firmware Diagnostics
              </h2>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 bg-black px-2 py-0.5 rounded-sm border border-zinc-800">
              MCU Health
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Free Heap Memory */}
            <div className="bg-black p-3 rounded-md border border-zinc-800 space-y-1">
              <div className="flex items-center justify-between text-zinc-400">
                <span className="text-[10px] uppercase font-semibold tracking-wide">
                  Free Heap
                </span>
                <Cpu size={13} className="text-emerald-400" />
              </div>
              <p className="text-base font-bold text-white font-mono">{freeHeapKb} KB</p>
              <p className="text-[10px] text-zinc-500">System SRAM Allocation</p>
            </div>

            {/* WiFi RSSI Signal Strength */}
            <div className="bg-black p-3 rounded-md border border-zinc-800 space-y-1">
              <div className="flex items-center justify-between text-zinc-400">
                <span className="text-[10px] uppercase font-semibold tracking-wide">
                  WiFi Signal
                </span>
                <Wifi size={13} className={wifiQuality.color} />
              </div>
              <div className="flex items-baseline gap-1.5">
                <p className="text-base font-bold text-white font-mono">{wifiRssiDbm} dBm</p>
                <span className={`text-[10px] font-semibold ${wifiQuality.color}`}>
                  ({wifiQuality.label})
                </span>
              </div>
              {/* Signal strength bar */}
              <div className="w-full bg-zinc-800 rounded-full h-1 mt-1 overflow-hidden">
                <div
                  className={`h-full ${wifiQuality.bg}`}
                  style={{
                    width: `${Math.min(100, Math.max(10, ((wifiRssiDbm + 100) / 70) * 100))}%`,
                  }}
                />
              </div>
            </div>

            {/* Dropped Posts Counter */}
            <div className="bg-black p-3 rounded-md border border-zinc-800 space-y-1">
              <div className="flex items-center justify-between text-zinc-400">
                <span className="text-[10px] uppercase font-semibold tracking-wide">
                  Dropped Posts
                </span>
                <Activity
                  size={13}
                  className={droppedPosts === 0 ? 'text-emerald-400' : 'text-amber-400'}
                />
              </div>
              <p className="text-base font-bold font-mono text-white">{droppedPosts}</p>
              <p className="text-[10px] text-zinc-500">HTTP/MQTT Telemetry Drops</p>
            </div>

            {/* Firmware Build Version */}
            <div className="bg-black p-3 rounded-md border border-zinc-800 space-y-1">
              <div className="flex items-center justify-between text-zinc-400">
                <span className="text-[10px] uppercase font-semibold tracking-wide">
                  Firmware Version
                </span>
                <Gauge size={13} className="text-emerald-400" />
              </div>
              <p className="text-base font-bold font-mono text-white">{firmwareVersion}</p>
              <p className="text-[10px] text-zinc-500">MCU Active Runtime Build</p>
            </div>
          </div>
        </div>

        {/* 3-Axis IMU Calibration & Gravity Lock Card */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                3-Axis IMU Calibration & Gravity Lock
              </h2>
            </div>
            {/* Calibration State Badge */}
            <span
              className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1.5 font-mono ${calBadge.containerClass}`}
            >
              <CalIcon size={12} />
              {calBadge.label}
            </span>
          </div>

          <div className="space-y-3">
            {/* Gravity Reference Vector */}
            <div className="bg-black p-3 rounded-md border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-semibold tracking-wide text-zinc-400">
                  Gravity Reference Vector
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">
                  1g = 16,384 LSB (±2g)
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-zinc-950 p-2 rounded-md border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 uppercase font-mono block">X Axis</span>
                  <span className="text-xs font-bold font-mono text-white">{gravityVector.x}</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded-md border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 uppercase font-mono block">Y Axis</span>
                  <span className="text-xs font-bold font-mono text-white">{gravityVector.y}</span>
                </div>
                <div className="bg-zinc-950 p-2 rounded-md border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 uppercase font-mono block">Z Axis</span>
                  <span className="text-xs font-bold font-mono text-emerald-400">
                    {gravityVector.z}
                  </span>
                </div>
              </div>
            </div>

            {/* Mount Shift Angle Displacement */}
            <div className="bg-black p-3 rounded-md border border-zinc-800 flex items-center justify-between">
              <div>
                <span className="text-[10px] uppercase font-semibold tracking-wide text-zinc-400 block">
                  Mount Shift Angle Displacement
                </span>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  Angular deviation relative to vehicle pitch/roll axis
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold font-mono text-white">
                  {mountShiftAngleDeg}°
                </p>
                <span
                  className={`text-[10px] font-semibold ${
                    mountShiftAngleDeg < 1.0
                      ? 'text-emerald-400'
                      : mountShiftAngleDeg < 3.0
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  {mountShiftAngleDeg < 1.0
                    ? 'Optimal Orientation'
                    : mountShiftAngleDeg < 3.0
                    ? 'Minor Shift'
                    : 'Recalibration Needed'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeviceHealthHeader;
