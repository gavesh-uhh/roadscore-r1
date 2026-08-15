'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Cpu, Save, Trash2, AlertCircle } from 'lucide-react';
import {
  DeviceRecord,
  VehicleRecord,
  DriverRecord,
} from '@/lib/fleet/types';

interface DeviceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  device?: DeviceRecord | null;
  vehicles: VehicleRecord[];
  drivers: DriverRecord[];
  onSave: (data: {
    device_id: string;
    accel_fs_g: number;
    gyro_fs_dps: number;
    active: boolean;
    vehicle_id: string;
    driver_id: string;
  }) => Promise<void>;
  onDelete?: (deviceId: string) => Promise<void>;
}

export function DeviceDrawer({
  isOpen,
  onClose,
  device,
  vehicles,
  drivers,
  onSave,
  onDelete,
}: DeviceDrawerProps) {
  const [deviceId, setDeviceId] = useState('');
  const [accelFs, setAccelFs] = useState('2');
  const [gyroFs, setGyroFs] = useState('250');
  const [active, setActive] = useState(true);
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (device) {
      setDeviceId(device.device_id || '');
      setAccelFs(device.accel_fs_g?.toString() || '2');
      setGyroFs(device.gyro_fs_dps?.toString() || '250');
      setActive(device.active !== undefined ? device.active : true);
      setVehicleId(device.vehicle_id || '');
      setDriverId(device.driver_id || '');
    } else {
      setDeviceId('');
      setAccelFs('2');
      setGyroFs('250');
      setActive(true);
      setVehicleId('');
      setDriverId('');
    }
    setError(null);
  }, [device, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceId.trim()) {
      setError('Hardware Device ID is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onSave({
        device_id: deviceId.trim(),
        accel_fs_g: parseFloat(accelFs) || 2,
        gyro_fs_dps: parseFloat(gyroFs) || 250,
        active,
        vehicle_id: vehicleId,
        driver_id: driverId,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save hardware device');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!device?.device_id || !onDelete) return;
    if (!confirm(`Are you sure you want to decommission/delete device "${device.device_id}"?`)) return;

    try {
      setLoading(true);
      setError(null);
      await onDelete(device.device_id);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to decommission device');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex justify-end font-sans text-xs overflow-hidden">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
          />

          {/* Drawer Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            className="relative z-10 w-full max-w-md bg-zinc-950 border-l border-zinc-800 h-full flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="h-12 px-4 bg-black border-b border-zinc-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Cpu size={15} className="text-emerald-400" />
                <span className="font-bold text-white text-xs">
                  {device ? `Edit Device: ${device.device_id}` : 'Provision Telematics Unit'}
                </span>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
              >
                <X size={15} />
              </button>
            </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-3 bg-rose-950/50 border border-rose-800 text-rose-300 rounded-md flex items-center gap-2 text-xs">
              <AlertCircle size={14} className="shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Device ID */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              Firmware Device ID <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              disabled={!!device}
              placeholder="e.g. dev-esp32-001"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white placeholder-zinc-500 font-mono font-bold focus:outline-none focus:border-zinc-600 transition-colors disabled:opacity-60"
            />
            <p className="text-[10px] text-zinc-500">
              Must match the exact string sent by ESP32 in telemetry headers.
            </p>
          </div>

          {/* Accelerometer & Gyro Full Scale Config */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
                Accel Full Scale
              </label>
              <select
                value={accelFs}
                onChange={(e) => setAccelFs(e.target.value)}
                className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-zinc-600 transition-colors"
              >
                <option value="2">±2g (16,384 LSB/g)</option>
                <option value="4">±4g (8,192 LSB/g)</option>
                <option value="8">±8g (4,096 LSB/g)</option>
                <option value="16">±16g (2,048 LSB/g)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
                Gyro Full Scale
              </label>
              <select
                value={gyroFs}
                onChange={(e) => setGyroFs(e.target.value)}
                className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-zinc-600 transition-colors"
              >
                <option value="250">±250 dps (131 LSB/°/s)</option>
                <option value="500">±500 dps (65.5 LSB/°/s)</option>
                <option value="1000">±1000 dps (32.8 LSB/°/s)</option>
                <option value="2000">±2000 dps (16.4 LSB/°/s)</option>
              </select>
            </div>
          </div>

          {/* Active Status Toggle */}
          <div className="flex items-center justify-between p-3 bg-black rounded-md border border-zinc-800">
            <div>
              <span className="text-xs font-semibold text-white block">Active Status</span>
              <span className="text-[10px] text-zinc-500">
                Allow engine ingestion for incoming packets
              </span>
            </div>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-0 cursor-pointer"
            />
          </div>

          {/* Vehicle Assignment */}
          <div className="space-y-1.5 pt-2 border-t border-zinc-800/80">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              Installed Vehicle
            </label>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-zinc-600 transition-colors"
            >
              <option value="">-- No Vehicle Assigned (Spare Unit) --</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} ({v.make || 'Unknown'} {v.model || ''})
                  {v.assigned_device_id && v.assigned_device_id !== device?.device_id
                    ? ` [Occupied: ${v.assigned_device_id}]`
                    : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Driver Assignment */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              Assigned Driver
            </label>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white focus:outline-none focus:border-zinc-600 transition-colors"
            >
              <option value="">-- No Driver Assigned --</option>
              {drivers.map((drv) => (
                <option key={drv.id} value={drv.id}>
                  {drv.name} ({drv.licence_ref || 'No Lic Ref'})
                </option>
              ))}
            </select>
          </div>
        </form>

        {/* Footer Actions */}
        <div className="p-4 bg-black border-t border-zinc-800 flex items-center justify-between shrink-0">
          {device && onDelete ? (
            <button
              type="button"
              disabled={loading}
              onClick={handleDelete}
              className="px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-rose-950 border border-zinc-800 hover:border-rose-800 text-rose-400 font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Trash2 size={13} />
              <span>Decommission</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleSubmit}
              className="px-3.5 py-1.5 rounded-md bg-white text-black hover:bg-zinc-200 font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Save size={13} />
              <span>{loading ? 'Saving...' : device ? 'Update Device' : 'Provision Unit'}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
      )}
    </AnimatePresence>
  );
}
