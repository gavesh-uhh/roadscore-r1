'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Car, Save, Trash2, AlertCircle } from 'lucide-react';
import {
  VehicleRecord,
  DriverRecord,
  DeviceRecord,
} from '@/lib/fleet/types';

interface VehicleDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  vehicle?: VehicleRecord | null;
  drivers: DriverRecord[];
  devices: DeviceRecord[];
  onSave: (data: {
    plate: string;
    make: string;
    model: string;
    year: number | undefined;
    assign_driver_id: string;
    assign_device_id: string;
  }) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export function VehicleDrawer({
  isOpen,
  onClose,
  vehicle,
  drivers,
  devices,
  onSave,
  onDelete,
}: VehicleDrawerProps) {
  const [plate, setPlate] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState<string>('');
  const [assignDriverId, setAssignDriverId] = useState('');
  const [assignDeviceId, setAssignDeviceId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (vehicle) {
      setPlate(vehicle.plate || '');
      setMake(vehicle.make || '');
      setModel(vehicle.model || '');
      setYear(vehicle.year ? vehicle.year.toString() : '');
      setAssignDriverId(vehicle.assigned_driver_id || '');
      setAssignDeviceId(vehicle.assigned_device_id || '');
    } else {
      setPlate('');
      setMake('');
      setModel('');
      setYear(new Date().getFullYear().toString());
      setAssignDriverId('');
      setAssignDeviceId('');
    }
    setError(null);
  }, [vehicle, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!plate.trim()) {
      setError('Vehicle license plate number is required');
      return;
    }

    const parsedYear = year ? parseInt(year, 10) : undefined;
    if (parsedYear !== undefined && (isNaN(parsedYear) || parsedYear < 1950 || parsedYear > 2100)) {
      setError('Year must be between 1950 and 2100');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onSave({
        plate: plate.trim().toUpperCase(),
        make: make.trim(),
        model: model.trim(),
        year: parsedYear,
        assign_driver_id: assignDriverId,
        assign_device_id: assignDeviceId,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save vehicle');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!vehicle?.id || !onDelete) return;
    if (!confirm(`Are you sure you want to delete vehicle "${vehicle.plate}"?`)) return;

    try {
      setLoading(true);
      setError(null);
      await onDelete(vehicle.id);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete vehicle');
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
            <Car size={15} className="text-emerald-400" />
            <span className="font-bold text-white text-xs">
              {vehicle ? `Edit Vehicle: ${vehicle.plate}` : 'Register Fleet Vehicle'}
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

          {/* License Plate */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              License Plate <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. DEV-0001"
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white placeholder-zinc-500 font-mono font-bold focus:outline-none focus:border-zinc-600 transition-colors uppercase"
            />
          </div>

          {/* Make & Model */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
                Make
              </label>
              <input
                type="text"
                placeholder="e.g. Toyota"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
                Model
              </label>
              <input
                type="text"
                placeholder="e.g. Corolla"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
              />
            </div>
          </div>

          {/* Year */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              Year (1950 - 2100)
            </label>
            <input
              type="number"
              min="1950"
              max="2100"
              placeholder="2024"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white placeholder-zinc-500 font-mono focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>

          {/* Hardware Device Assignment */}
          <div className="space-y-1.5 pt-2 border-t border-zinc-800/80">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              Installed Hardware Device
            </label>
            <select
              value={assignDeviceId}
              onChange={(e) => setAssignDeviceId(e.target.value)}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-zinc-600 transition-colors"
            >
              <option value="">-- No Hardware Device Installed --</option>
              {devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.device_id}
                  {d.vehicle_id && d.vehicle_id !== vehicle?.id
                    ? ` [Attached to ${d.vehicle_plate || 'another vehicle'}]`
                    : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-zinc-500">
              1-to-1 binding: Selecting an attached device will automatically reassign it to this vehicle.
            </p>
          </div>

          {/* Assigned Driver */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              Assigned Driver
            </label>
            <select
              value={assignDriverId}
              onChange={(e) => setAssignDriverId(e.target.value)}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white focus:outline-none focus:border-zinc-600 transition-colors"
            >
              <option value="">-- No Driver Assigned --</option>
              {drivers.map((drv) => (
                <option key={drv.id} value={drv.id}>
                  {drv.name} ({drv.licence_ref || 'No Lic Ref'})
                  {drv.assigned_vehicle_id && drv.assigned_vehicle_id !== vehicle?.id
                    ? ` [Driving: ${drv.assigned_vehicle_plate}]`
                    : ''}
                </option>
              ))}
            </select>
          </div>
        </form>

        {/* Footer Actions */}
        <div className="p-4 bg-black border-t border-zinc-800 flex items-center justify-between shrink-0">
          {vehicle && onDelete ? (
            <button
              type="button"
              disabled={loading}
              onClick={handleDelete}
              className="px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-rose-950 border border-zinc-800 hover:border-rose-800 text-rose-400 font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Trash2 size={13} />
              <span>Delete</span>
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
              <span>{loading ? 'Saving...' : vehicle ? 'Update Vehicle' : 'Register Vehicle'}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
      )}
    </AnimatePresence>
  );
}
