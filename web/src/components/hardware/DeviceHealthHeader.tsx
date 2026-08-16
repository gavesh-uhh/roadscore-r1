'use client';

import React from 'react';
import {
  Cpu,
  Wifi,
  ShieldCheck,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Car,
  User,
  Calendar,
  Layers,
  Zap,
  Radio,
} from 'lucide-react';

export type CalibrationState = 'calibrated' | 'calibrating' | 'recalibrating' | 'degraded' | 'uncalibrated' | string;

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
  vehicle?: { id: string; plate?: string | null; make?: string | null; model?: string | null; year?: number | null } | null;
  driver?: { id: string; name: string; licence_ref?: string | null } | null;
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
 * Modernized, decluttered DeviceHealthHeader.
 * Replaces nested border boxes with a sleek, unified telemetry health ribbon
 * and humanized vehicle/driver identifiers.
 */
export const DeviceHealthHeader: React.FC<DeviceHealthHeaderProps> = ({
  device,
  vehicle,
  driver,
  freeHeapKb = device.free_heap_kb ?? 184,
  wifiRssiDbm = device.wifi_rssi_dbm ?? -62,
  droppedPosts = device.dropped_posts ?? 0,
  firmwareVersion = device.firmware_version ?? '1.0.0-mcu',
  gravityVector = device.gravity_vector ?? { x: 0, y: 0, z: 16384 },
  mountShiftAngleDeg,
  calibrationState = device.calibration_state ?? 'calibrated',
}) => {
  // Compute dynamic mount shift angle
  const computedMountShift = React.useMemo(() => {
    if (typeof mountShiftAngleDeg === 'number') return mountShiftAngleDeg;
    if (device.mount_shift_angle_deg != null) return device.mount_shift_angle_deg;
    if (gravityVector && (gravityVector.x !== 0 || gravityVector.y !== 0 || gravityVector.z !== 0)) {
      const horiz = Math.hypot(gravityVector.x, gravityVector.y);
      const vert = Math.abs(gravityVector.z) || 1;
      const deg = Math.atan2(horiz, vert) * (180 / Math.PI);
      return parseFloat(deg.toFixed(1));
    }
    return 0.0;
  }, [mountShiftAngleDeg, device.mount_shift_angle_deg, gravityVector]);

  // WiFi signal indicator helper
  const getWifiSignalQuality = (rssi: number) => {
    if (rssi <= -95 || rssi === -99) return { label: 'Offline', color: 'text-zinc-500', barColor: 'bg-zinc-600', bars: 1 };
    if (rssi >= -55) return { label: 'Excellent', color: 'text-emerald-400', barColor: 'bg-emerald-400', bars: 4 };
    if (rssi >= -68) return { label: 'Good', color: 'text-emerald-400', barColor: 'bg-emerald-400', bars: 3 };
    if (rssi >= -78) return { label: 'Fair', color: 'text-amber-400', barColor: 'bg-amber-400', bars: 2 };
    return { label: 'Weak', color: 'text-rose-400', barColor: 'bg-rose-400', bars: 1 };
  };

  const wifiQuality = getWifiSignalQuality(wifiRssiDbm);

  // Calibration badge styling
  const getCalibrationBadge = (state?: CalibrationState) => {
    const s = String(state || '').toLowerCase().trim();
    switch (s) {
      case 'calibrated':
        return {
          label: 'Calibrated',
          icon: CheckCircle2,
          color: 'text-emerald-400',
          bg: 'bg-emerald-950/70 border-emerald-800/60',
          dot: 'bg-emerald-400',
        };
      case 'calibrating':
        return {
          label: 'Calibrating...',
          icon: Activity,
          color: 'text-sky-400',
          bg: 'bg-sky-950/70 border-sky-800/60 animate-pulse',
          dot: 'bg-sky-400',
        };
      case 'recalibrating':
        return {
          label: 'Recalibrating...',
          icon: Activity,
          color: 'text-amber-400',
          bg: 'bg-amber-950/70 border-amber-800/60 animate-pulse',
          dot: 'bg-amber-400',
        };
      case 'degraded':
        return {
          label: 'Degraded',
          icon: AlertTriangle,
          color: 'text-amber-400',
          bg: 'bg-amber-950/70 border-amber-800/60',
          dot: 'bg-amber-400',
        };
      case 'uncalibrated':
        return {
          label: 'Uncalibrated',
          icon: XCircle,
          color: 'text-rose-400',
          bg: 'bg-rose-950/70 border-rose-800/60',
          dot: 'bg-rose-400',
        };
      default:
        return {
          label: state ? String(state) : 'Uncalibrated',
          icon: s ? Activity : XCircle,
          color: 'text-zinc-300',
          bg: 'bg-zinc-900 border-zinc-700',
          dot: 'bg-zinc-400',
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

  // Humanized labels for Vehicle and Driver
  const vehicleLabel = vehicle
    ? `${vehicle.make ? `${vehicle.make} ` : ''}${vehicle.model || ''} (${vehicle.plate || 'No Plate'})`.trim()
    : (device.vehicle_id ? (device.vehicle_id.length > 12 ? `Vehicle #${device.vehicle_id.slice(0, 8)}` : device.vehicle_id) : 'Unassigned');

  const driverLabel = driver
    ? driver.name
    : (device.driver_id ? (device.driver_id.length > 12 ? `Driver #${device.driver_id.slice(0, 8)}` : device.driver_id) : 'Unassigned');

  return (
    <div className="w-full space-y-3 font-sans text-xs">
      {/* Sleek Identity & Configuration Bar (Zero Nested Boxes) */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-md px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left: Device Identity & Architecture Meta */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded bg-zinc-900 border border-zinc-800 text-emerald-400 flex-shrink-0">
            <Cpu size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold text-white font-mono tracking-wide">
                {device.device_id}
              </h1>
              <span className={`px-2 py-0.5 rounded-sm text-[10px] font-bold uppercase font-mono flex items-center gap-1.5 border ${
                device.active
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40'
                  : 'bg-zinc-900 text-zinc-500 border-zinc-800'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${device.active ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                {device.active ? 'Active' : 'Offline'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
              ESP32 + MPU6050 &bull; &plusmn;{device.accel_fs_g || 2}g / &plusmn;{device.gyro_fs_dps || 250}&deg;/s &bull; 50 Hz &bull; v{firmwareVersion}
            </p>
          </div>
        </div>

        {/* Right: Humanized Vehicle, Driver, and Installation Chips */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800/80 text-zinc-300">
            <Car size={13} className="text-zinc-500" />
            <span className="text-zinc-500">Vehicle:</span>
            <span className="font-semibold text-white">{vehicleLabel}</span>
          </div>

          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800/80 text-zinc-300">
            <User size={13} className="text-zinc-500" />
            <span className="text-zinc-500">Driver:</span>
            <span className="font-semibold text-white">{driverLabel}</span>
          </div>

          {formattedInstallDate && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800/80 text-zinc-400">
              <Calendar size={13} className="text-zinc-500" />
              <span>{formattedInstallDate}</span>
            </div>
          )}
        </div>
      </div>

      {/* Unified Real-Time Telematics Ribbon (Single Container, Subtle Column Dividers) */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-0 md:divide-x md:divide-zinc-800/80 text-xs">
        {/* 1. WiFi Signal */}
        <div className="md:px-3 flex flex-col justify-between space-y-1">
          <div className="flex items-center justify-between text-zinc-500 text-[10px] uppercase font-mono tracking-wider">
            <span>WiFi Signal</span>
            <Wifi size={12} className={wifiQuality.color} />
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-sm font-bold text-white">{wifiRssiDbm} dBm</span>
            <span className={`text-[10px] font-semibold ${wifiQuality.color}`}>({wifiQuality.label})</span>
          </div>
        </div>

        {/* 2. Free SRAM Heap */}
        <div className="md:px-3 flex flex-col justify-between space-y-1">
          <div className="flex items-center justify-between text-zinc-500 text-[10px] uppercase font-mono tracking-wider">
            <span>Free Heap</span>
            <Radio size={12} className="text-zinc-500" />
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="text-sm font-bold text-white">{freeHeapKb} KB</span>
            <span className="text-[10px] text-zinc-500">SRAM</span>
          </div>
        </div>

        {/* 3. Ingestion Reliability / Drops */}
        <div className="md:px-3 flex flex-col justify-between space-y-1">
          <div className="flex items-center justify-between text-zinc-500 text-[10px] uppercase font-mono tracking-wider">
            <span>Dropped Packets</span>
            <Activity size={12} className={droppedPosts === 0 ? 'text-emerald-400' : 'text-amber-400'} />
          </div>
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className={`text-sm font-bold ${droppedPosts === 0 ? 'text-white' : 'text-amber-400'}`}>
              {droppedPosts}
            </span>
            <span className="text-[10px] text-zinc-500">drops</span>
          </div>
        </div>

        {/* 4. Gravity Vector Reference */}
        <div className="md:px-3 flex flex-col justify-between space-y-1">
          <div className="flex items-center justify-between text-zinc-500 text-[10px] uppercase font-mono tracking-wider">
            <span>Gravity Vector &bull; [X, Y, Z]</span>
            <span className="text-[9px] text-zinc-500 font-mono">LSB</span>
          </div>
          <div className="font-mono text-xs text-zinc-300 font-bold tracking-tight">
            [{gravityVector.x}, {gravityVector.y}, <span className="text-emerald-400">{gravityVector.z}</span>]
          </div>
        </div>

        {/* 5. Mount Shift & Calibration Lock */}
        <div className="md:px-3 flex flex-col justify-between space-y-1 col-span-2 md:col-span-1">
          <div className="flex items-center justify-between text-zinc-500 text-[10px] uppercase font-mono tracking-wider">
            <span>Mount Alignment</span>
            <span className={`px-1.5 py-0.2 rounded-sm text-[9px] font-bold border font-mono ${calBadge.bg} ${calBadge.color}`}>
              {calBadge.label}
            </span>
          </div>
          <div className="flex items-center justify-between font-mono">
            <span className="text-sm font-bold text-white">{computedMountShift}&deg;</span>
            <span className={`text-[10px] font-semibold ${
              computedMountShift < 1.5
                ? 'text-emerald-400'
                : computedMountShift < 3.0
                ? 'text-amber-400'
                : 'text-rose-400'
            }`}>
              {computedMountShift < 1.5 ? 'Optimal' : computedMountShift < 3.0 ? 'Minor Shift' : 'Shift Warning'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeviceHealthHeader;
