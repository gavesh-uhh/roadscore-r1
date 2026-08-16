'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Link2, Unlink, Save, AlertCircle } from 'lucide-react';
import {
  VehicleRecord,
  DeviceRecord,
  DriverRecord,
} from '@/lib/fleet/types';

interface AssignDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  targetVehicle?: VehicleRecord | null;
  targetDevice?: DeviceRecord | null;
  targetDriver?: DriverRecord | null;
  vehicles: VehicleRecord[];
  devices: DeviceRecord[];
  drivers: DriverRecord[];
  onSave: (data: {
    vehicle_id: string;
    device_id: string;
    driver_id: string;
  }) => Promise<void>;
  onUnassign?: (vehicleId: string) => Promise<void>;
}

export function AssignDrawer({
  isOpen,
  onClose,
  targetVehicle,
  targetDevice,
  targetDriver,
  vehicles,
  devices,
  drivers,
  onSave,
  onUnassign,
}: AssignDrawerProps) {
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (targetVehicle) {
      setSelectedVehicleId(targetVehicle.id);
      setSelectedDeviceId(targetVehicle.assigned_device_id || '');
      setSelectedDriverId(targetVehicle.assigned_driver_id || '');
    } else if (targetDevice) {
      setSelectedDeviceId(targetDevice.device_id);
      setSelectedVehicleId(targetDevice.vehicle_id || '');
      setSelectedDriverId(targetDevice.driver_id || '');
    } else if (targetDriver) {
      setSelectedDriverId(targetDriver.id);
      setSelectedVehicleId(targetDriver.assigned_vehicle_id || '');
      setSelectedDeviceId(targetDriver.assigned_device_id || '');
    } else {
      setSelectedVehicleId('');
      setSelectedDeviceId('');
      setSelectedDriverId('');
    }
    setError(null);
  }, [targetVehicle, targetDevice, targetDriver, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicleId) {
      setError('Please select a vehicle to bind');
      return;
    }
    if (!selectedDeviceId) {
      setError('Please select a hardware telematics device');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onSave({
        vehicle_id: selectedVehicleId,
        device_id: selectedDeviceId,
        driver_id: selectedDriverId,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update assignment pairing');
    } finally {
      setLoading(false);
    }
  };

  const handleUnassignAll = async () => {
    if (!selectedVehicleId || !onUnassign) return;
    if (!confirm('Are you sure you want to unbind hardware and driver from this vehicle?')) return;

    try {
      setLoading(true);
      setError(null);
      await onUnassign(selectedVehicleId);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to unassign');
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
                <Link2 size={15} className="text-emerald-400" />
                <span className="font-bold text-white text-xs">
                  Fleet Hardware & Driver Assignment
                </span>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
              >
                <X size={15} />
              </button>
            </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-3 bg-rose-950/50 border border-rose-800 text-rose-300 rounded-md flex items-center gap-2 text-xs">
              <AlertCircle size={14} className="shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-3 bg-black rounded-md border border-zinc-800 space-y-1">
            <span className="text-[11px] font-semibold text-white">1-to-1 Active Pairing Engine</span>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Pairing an active telematics unit to a vehicle routes live GPS coordinates, IMU accelerations, and continuous road hazard detection directly into the assigned driver’s scorecard.
            </p>
          </div>

          {/* Target Vehicle */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              1. Fleet Vehicle <span className="text-rose-400">*</span>
            </label>
            <select
              value={selectedVehicleId}
              onChange={(e) => {
                const vId = e.target.value;
                setSelectedVehicleId(vId);
                const target = vehicles.find((v) => v.id === vId);
                if (target) {
                  setSelectedDeviceId(target.assigned_device_id || '');
                  setSelectedDriverId(target.assigned_driver_id || '');
                } else {
                  setSelectedDeviceId('');
                  setSelectedDriverId('');
                }
              }}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-zinc-600 transition-colors"
            >
              <option value="">-- Choose Target Vehicle --</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} ({v.make || 'Unknown'} {v.model || ''})
                </option>
              ))}
            </select>
          </div>

          {/* Target Hardware Device */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              2. Hardware Telematics Device <span className="text-rose-400">*</span>
            </label>
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-zinc-600 transition-colors"
            >
              <option value="">-- Choose Telematics Device --</option>
              {devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.device_id}
                  {d.vehicle_id && d.vehicle_id !== selectedVehicleId
                    ? ` [Currently on ${d.vehicle_plate || 'another vehicle'}]`
                    : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Assigned Driver */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              3. Assigned Driver
            </label>
            <select
              value={selectedDriverId}
              onChange={(e) => setSelectedDriverId(e.target.value)}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white focus:outline-none focus:border-zinc-600 transition-colors"
            >
              <option value="">-- No Driver Assigned (Unallocated) --</option>
              {drivers.map((drv) => (
                <option key={drv.id} value={drv.id}>
                  {drv.name} ({drv.licence_ref || 'No Lic Ref'})
                  {drv.assigned_vehicle_id && drv.assigned_vehicle_id !== selectedVehicleId
                    ? ` [Currently on ${drv.assigned_vehicle_plate}]`
                    : ''}
                </option>
              ))}
            </select>
          </div>
        </form>

        {/* Footer */}
        <div className="p-4 bg-black border-t border-zinc-800 flex items-center justify-between shrink-0">
          {selectedVehicleId && onUnassign ? (
            <button
              type="button"
              disabled={loading}
              onClick={handleUnassignAll}
              className="px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-rose-950 border border-zinc-800 hover:border-rose-800 text-rose-400 font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Unlink size={13} />
              <span>Unbind All</span>
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
              <span>{loading ? 'Binding...' : 'Save Pairing'}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
      )}
    </AnimatePresence>
  );
}
