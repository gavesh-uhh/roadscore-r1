'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertOctagon,
  MapPin,
  ExternalLink,
  CheckCircle,
  Radio,
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
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="relative z-50 bg-rose-950 border-b-2 border-rose-500 shadow-2xl shadow-rose-950/80 px-4 py-3 text-white overflow-hidden"
      >
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-rose-600/20 via-transparent to-transparent animate-pulse" />

        <div className="mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3 max-w-7xl relative z-10">
          {/* Emergency Title & Status */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white shadow-lg shadow-rose-600/50 animate-bounce">
              <AlertOctagon size={22} />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                </span>
                <span className="text-xs font-mono font-black uppercase tracking-widest text-rose-300">
                  CRITICAL INCIDENT · AUTOMATED eCALL 911 SOS
                </span>
              </div>
              <h2 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                Severe Collision Detected on Vehicle{' '}
                <span className="font-mono text-rose-300 underline">{current.deviceId}</span>
              </h2>
            </div>
          </div>

          {/* Telemetry Chips & GPS */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <div className="flex items-center gap-1.5 rounded-lg bg-black/40 border border-rose-500/40 px-2.5 py-1.5 text-rose-200">
              <MapPin size={13} className="text-rose-400" />
              <span>
                {current.lat.toFixed(5)}, {current.lon.toFixed(5)}
              </span>
            </div>

            <div className="rounded-lg bg-black/40 border border-rose-500/40 px-2.5 py-1.5 text-rose-200">
              <span>Impact: {current.impactG.toFixed(1)}g</span> ·{' '}
              <span>{Math.round(current.speedBeforeImpactKmh)} km/h</span>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-emerald-950/80 border border-emerald-500/60 px-2.5 py-1.5 text-emerald-300 font-bold">
              <Ambulance size={13} />
              <span>{current.emsUnit ?? 'EMS Dispatched'}</span>
              {current.etaMinutes && <span>(~{current.etaMinutes}m ETA)</span>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end">
            <a
              href={current.liveMapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 text-xs font-mono font-bold transition-all shadow-md shadow-rose-900/50"
            >
              <span>Live Map</span>
              <ExternalLink size={12} />
            </a>

            <button
              onClick={() => resolveEmergency(current.id)}
              className="flex items-center gap-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white px-3 py-1.5 text-xs font-mono font-bold transition-all"
            >
              <CheckCircle size={13} className="text-zinc-400" />
              <span>Resolve</span>
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
