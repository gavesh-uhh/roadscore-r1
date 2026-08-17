'use client';

/**
 * LaunchModal — Streamlined One-Tap 'Launch Co-Pilot' gate
 *
 * Captures user gesture for audio/speech/wakelock, lets the driver
 * pick their vehicle orb, and launches the driving interface.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, ChevronRight } from 'lucide-react';
import { VehicleOrbSelector, type VehicleOrbUnit } from './VehicleOrbSelector';

export interface LaunchModalProps {
  open: boolean;
  deviceId: string | null;
  feedLabel: string;
  units?: VehicleOrbUnit[];
  onSelectDevice?: (deviceId: string) => void;
  onLaunch: () => void;
}

export function LaunchModal({
  open,
  deviceId,
  units = [],
  onSelectDevice,
  onLaunch,
}: LaunchModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-xl px-4 py-6"
        >
          <motion.div
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-md rounded-3xl border border-zinc-800/90 bg-zinc-950/95 p-6 text-center shadow-2xl shadow-black my-auto"
          >
            {/* Emerald Shield Badge */}
            <div className="relative mx-auto mb-3 flex h-12 w-12 items-center justify-center">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/20 animate-live-ping" />
              <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/40">
                <ShieldCheck size={22} className="text-emerald-400" />
              </span>
            </div>

            <h1 className="text-lg font-black tracking-tight text-white">
              RoadScore Co-Pilot
            </h1>
            <p className="mt-1 text-xs text-zinc-400">
              Select your vehicle unit to begin your trip.
            </p>

            {/* Vehicle Orb Selector */}
            {units.length > 0 && onSelectDevice && (
              <div className="my-5">
                <VehicleOrbSelector
                  units={units}
                  selectedDeviceId={deviceId}
                  onSelect={onSelectDevice}
                />
              </div>
            )}

            {/* Clean Launch CTA Button */}
            <button
              onClick={onLaunch}
              className="group w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 px-4 text-xs font-black uppercase tracking-wider text-black shadow-[0_0_25px_rgba(16,185,129,0.4)] hover:bg-emerald-400 active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>Launch Co-Pilot</span>
              <ChevronRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
