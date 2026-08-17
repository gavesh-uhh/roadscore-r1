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

export interface LaunchModalProps {
  open: boolean;
  deviceId: string | null;
  feedLabel: string;
  onLaunch: () => void;
}

export function LaunchModal({ open, deviceId, feedLabel, onLaunch }: LaunchModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/95 backdrop-blur-md px-6"
        >
          <motion.div
            initial={{ scale: 0.92, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="w-full max-w-sm text-center"
          >
            <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/20 animate-live-ping" />
              <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/40">
                <ShieldCheck size={28} className="text-emerald-400" />
              </span>
            </div>

            <h1 className="text-xl font-extrabold tracking-tight text-white">
              RoadScore Co-Pilot
            </h1>
            <p className="mt-1 text-[11px] text-zinc-400">
              TrueScore™ Shield is armed and ready to defend your driving record.
            </p>

            <div className="mt-4 flex items-center justify-center gap-2 text-[9px] font-semibold">
              <span className="px-2 py-1 rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300 flex items-center gap-1">
                <Radio size={10} className="text-emerald-400" />
                {feedLabel}
              </span>
              <span className="px-2 py-1 rounded-full border border-zinc-800 bg-zinc-950 text-zinc-300 flex items-center gap-1">
                <Smartphone size={10} className="text-zinc-400" />
                {deviceId ?? 'Demo Unit'}
              </span>
            </div>

            <button
              onClick={onLaunch}
              className="group mt-6 w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 py-4 text-sm font-extrabold uppercase tracking-widest text-black shadow-[0_0_40px_-8px_rgba(16,185,129,0.7)] hover:bg-emerald-400 active:scale-[0.98]"
            >
              Launch Co-Pilot
              <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </button>

            <div className="mt-5 grid grid-cols-3 gap-2 text-[8.5px] text-zinc-500">
              <div className="flex flex-col items-center gap-1">
                <Volume2 size={13} className="text-zinc-400" />
                Acoustic Chimes
              </div>
              <div className="flex flex-col items-center gap-1">
                <Mic2 size={13} className="text-zinc-400" />
                Voice Alerts
              </div>
              <div className="flex flex-col items-center gap-1">
                <Smartphone size={13} className="text-zinc-400" />
                Screen Wake Lock
              </div>
            </div>
            <p className="mt-3 text-[9px] text-zinc-600">
              One tap enables audio, voice guidance and keeps the screen awake.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
