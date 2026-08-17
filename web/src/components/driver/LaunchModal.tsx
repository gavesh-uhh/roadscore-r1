'use client';

/**
 * LaunchModal — One-Tap 'Launch Co-Pilot' gate (DRIVER_VIEW_PLAN §2)
 *
 * Browsers require a user gesture before Web Audio, Speech Synthesis, and the
 * Screen Wake Lock can activate. This modal captures that single tap, primes
 * every subsystem, then hands over to the cockpit.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Volume2, Mic2, Smartphone, Radio, ChevronRight } from 'lucide-react';
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
  feedLabel,
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
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/98 backdrop-blur-2xl px-4 overflow-y-auto py-6"
        >
          <motion.div
            initial={{ scale: 0.94, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            className="w-full max-w-md sm:max-w-lg rounded-3xl border border-zinc-800/80 bg-zinc-950/90 p-5 sm:p-6 text-center shadow-2xl shadow-black my-auto"
          >
            <div className="relative mx-auto mb-3 flex h-12 w-12 items-center justify-center">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/20 animate-live-ping" />
              <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/40">
                <ShieldCheck size={22} className="text-emerald-400" />
              </span>
            </div>

            <h1 className="text-lg font-black tracking-tight text-white">
              RoadScore Co-Pilot
            </h1>
            <p className="mt-0.5 text-[10.5px] text-zinc-400">
              Select your vehicle hardware to link the active in-cabin telemetry stream.
            </p>

            {/* ===== VEHICLE ORBS WITH CARS INSIDE ===== */}
            {units.length > 0 && onSelectDevice && (
              <div className="my-4">
                <VehicleOrbSelector
                  units={units}
                  selectedDeviceId={deviceId}
                  onSelect={onSelectDevice}
                />
              </div>
            )}

            <div className="mt-3 flex items-center justify-center gap-1.5 text-[8.5px] font-mono font-bold">
              <span className="px-2 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-950/40 text-emerald-300 flex items-center gap-1">
                <Radio size={9} className="text-emerald-400" />
                {feedLabel}
              </span>
              <span className="px-2 py-0.5 rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-300 flex items-center gap-1">
                <Smartphone size={9} className="text-zinc-400" />
                {deviceId ?? 'Demo Unit'}
              </span>
            </div>

            <button
              onClick={onLaunch}
              className="group mt-5 w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 px-4 text-xs font-black uppercase tracking-wider text-black shadow-[0_0_25px_rgba(16,185,129,0.5)] hover:bg-emerald-400 active:scale-[0.98] transition-all cursor-pointer"
            >
              <span>Launch Co-Pilot</span>
              <ChevronRight size={15} className="transition-transform group-hover:translate-x-0.5" />
            </button>

            <div className="mt-4 grid grid-cols-3 gap-1.5 text-[8px] text-zinc-500">
              <div className="flex flex-col items-center gap-0.5">
                <Volume2 size={12} className="text-zinc-400" />
                Chimes
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <Mic2 size={12} className="text-zinc-400" />
                Voice
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <Smartphone size={12} className="text-zinc-400" />
                Wake Lock
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
