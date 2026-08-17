'use client';

/**
 * DevicePairModal — Fast 1-Tap Vehicle Switcher
 *
 * Allows switching the active vehicle/driver unit during flight
 * by simply tapping one of the vehicle glass orbs.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Car, X } from 'lucide-react';
import { VehicleOrbSelector, type VehicleOrbUnit } from './VehicleOrbSelector';

export interface DevicePairModalProps {
  open: boolean;
  currentDevice: string | null;
  units?: VehicleOrbUnit[];
  onPair: (deviceId: string) => void;
  onClose: () => void;
}

export function DevicePairModal({
  open,
  currentDevice,
  units = [],
  onPair,
  onClose,
}: DevicePairModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-md px-4 py-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-zinc-800/90 bg-zinc-950/95 p-5 sm:p-6 shadow-2xl shadow-black my-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  <Car size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white tracking-tight">
                    Switch Vehicle
                  </h2>
                  <p className="text-[10px] text-zinc-400">
                    Tap any vehicle unit to link live telemetry.
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* 1-Tap Vehicle Orbs */}
            {units && units.length > 0 && (
              <div className="mt-4">
                <VehicleOrbSelector
                  units={units}
                  selectedDeviceId={currentDevice}
                  onSelect={(dId) => {
                    onPair(dId);
                  }}
                />
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
