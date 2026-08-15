'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UserPlus, Save, Trash2, AlertCircle } from 'lucide-react';
import { DriverRecord, VehicleRecord } from '@/lib/fleet/types';

interface DriverDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  driver?: DriverRecord | null;
  vehicles: VehicleRecord[];
  onSave: (data: {
    name: string;
    licence_ref: string;
    assign_vehicle_id: string;
  }) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export function DriverDrawer({
  isOpen,
  onClose,
  driver,
  vehicles,
  onSave,
  onDelete,
}: DriverDrawerProps) {
  const [name, setName] = useState('');
  const [licenceRef, setLicenceRef] = useState('');
  const [assignVehicleId, setAssignVehicleId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (driver) {
      setName(driver.name || '');
      setLicenceRef(driver.licence_ref || '');
      setAssignVehicleId(driver.assigned_vehicle_id || '');
    } else {
      setName('');
      setLicenceRef('');
      setAssignVehicleId('');
    }
    setError(null);
  }, [driver, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Driver full name is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onSave({
        name: name.trim(),
        licence_ref: licenceRef.trim(),
        assign_vehicle_id: assignVehicleId,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save driver');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!driver?.id || !onDelete) return;
    if (!confirm(`Are you sure you want to delete driver "${driver.name}"?`)) return;

    try {
      setLoading(true);
      setError(null);
      await onDelete(driver.id);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete driver');
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
                <UserPlus size={15} className="text-emerald-400" />
                <span className="font-bold text-white text-xs">
                  {driver ? `Edit Driver: ${driver.name}` : 'Register Driver'}
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

          {/* Full Name */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              Full Name <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Liam Vance"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>

          {/* License Reference */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              Driver License Reference
            </label>
            <input
              type="text"
              placeholder="e.g. DEV-LIC-0001"
              value={licenceRef}
              onChange={(e) => setLicenceRef(e.target.value)}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white placeholder-zinc-500 font-mono focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>

          {/* Vehicle Assignment */}
          <div className="space-y-1.5 pt-2 border-t border-zinc-800/80">
            <label className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider block font-mono">
              Assigned Vehicle
            </label>
            <select
              value={assignVehicleId}
              onChange={(e) => setAssignVehicleId(e.target.value)}
              className="w-full px-3 py-1.5 bg-black border border-zinc-800 rounded-md text-white font-mono focus:outline-none focus:border-zinc-600 transition-colors"
            >
              <option value="">-- No Vehicle Assigned --</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} ({v.make || 'Unknown'} {v.model || ''})
                  {v.assigned_driver_id && v.assigned_driver_id !== driver?.id
                    ? ` [Occupied: ${v.assigned_driver_name}]`
                    : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-zinc-500">
              Assigning a vehicle binds the driver to that vehicle&apos;s active telematics hardware unit.
            </p>
          </div>
        </form>

        {/* Footer Actions */}
        <div className="p-4 bg-black border-t border-zinc-800 flex items-center justify-between shrink-0">
          {driver && onDelete ? (
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
              <span>{loading ? 'Saving...' : driver ? 'Update Driver' : 'Register Driver'}</span>
            </button>
          </div>
        </div>
      </motion.div>
    </div>
      )}
    </AnimatePresence>
  );
}
