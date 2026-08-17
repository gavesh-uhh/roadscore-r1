'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertOctagon,
  ExternalLink,
  X,
  Ambulance,
} from 'lucide-react';
import type { EmergencyDispatchRecord } from '@/app/api/emergency/dispatch/route';

export function EmergencySosBanner() {
  const [emergencies, setEmergencies] = useState<EmergencyDispatchRecord[]>([]);

  const fetchEmergencies = useCallback(async () => {
    try {
      const res = await fetch('/api/emergency/dispatch');
      const data = await res.json();
      if (data.activeEmergencies) {
        setEmergencies(data.activeEmergencies);
      }
    } catch {
      // Ignore network hiccup
    }
  }, []);

  const resolveEmergency = async (id: string) => {
    try {
      await fetch(`/api/emergency/dispatch?id=${id}`, { method: 'DELETE' });
      setEmergencies((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      console.error('Failed to resolve emergency:', e);
    }
  };

  useEffect(() => {
    fetchEmergencies();
    const interval = setInterval(fetchEmergencies, 3000);
    return () => clearInterval(interval);
  }, [fetchEmergencies]);

  if (emergencies.length === 0) return null;

  const current = emergencies[0];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -20, opacity: 0 }}
        className="sticky top-2 z-50 px-2 sm:px-4 py-1"
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 rounded-2xl border border-rose-500/70 bg-rose-950/95 px-3 py-1.5 sm:py-2 text-white shadow-xl shadow-rose-950/60 backdrop-blur-xl">
          {/* Pulsing indicator & Title */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
            </span>

            <div className="flex items-center gap-1.5 truncate text-[11px] sm:text-xs font-mono">
              <span className="font-black text-rose-300 shrink-0 uppercase tracking-wider">
                🚨 SOS Crash
              </span>
              <span className="text-zinc-500 hidden sm:inline">·</span>
              <span className="font-bold text-white truncate">{current.deviceId}</span>
              <span className="text-zinc-500 hidden sm:inline">·</span>
              <span className="text-rose-200/80 hidden sm:inline text-[10px]">
                {current.lat.toFixed(4)}, {current.lon.toFixed(4)} ({current.impactG.toFixed(1)}g)
              </span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="hidden min-[480px]:flex items-center gap-1 rounded-md bg-emerald-950/80 border border-emerald-500/50 px-2 py-0.5 text-[9.5px] font-mono text-emerald-300">
              <Ambulance size={11} />
              <span>{current.emsUnit ?? 'EMS Dispatched'}</span>
            </div>

            <a
              href={current.liveMapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-2.5 py-1 text-[10px] font-mono font-bold transition-all"
            >
              <span>Map</span>
              <ExternalLink size={10} />
            </a>

            <button
              onClick={() => resolveEmergency(current.id)}
              className="p-1 rounded-md text-rose-300 hover:text-white hover:bg-rose-900/60 active:scale-95 transition-all"
              title="Resolve Incident"
              aria-label="Resolve Incident"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
