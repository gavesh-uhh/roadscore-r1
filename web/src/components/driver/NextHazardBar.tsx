'use client';

/**
 * NextHazardBar — next-manoeuvre bar (UI_POLISH P0-1)
 *
 * A DOM overlay pinned to the top of the radar section showing the nearest
 * hazard: glyph, title, live distance countdown, and the advisory action.
 * Gives the single most important driving fact a screen-reader-visible,
 * glanceable home outside the canvas.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Navigation2, X } from 'lucide-react';
import type { HorizonHazard } from '@/lib/sim/demoSimulator';
import { HAZARD_ICON, HAZARD_COLOR, HAZARD_SHORT } from './hazardMeta';

export interface NextHazardBarProps {
  hazard: HorizonHazard | null;
  onDismiss?: (id: string) => void;
  className?: string;
}

export function NextHazardBar({ hazard, onDismiss, className = '' }: NextHazardBarProps) {
  return (
    <div className={`pointer-events-none w-full max-w-sm sm:max-w-md ${className}`} role="status" aria-live="polite">
      <AnimatePresence mode="wait">
        {hazard && (() => {
          const Icon = HAZARD_ICON[hazard.kind];
          const color = HAZARD_COLOR[hazard.kind];
          const distM = Math.max(0, Math.round(hazard.distanceM));

          return (
            <motion.div
              key={hazard.id}
              initial={{ opacity: 0, y: -14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="relative flex items-center gap-2.5 sm:gap-3 rounded-2xl bg-zinc-950/90 backdrop-blur-xl border border-zinc-800/80 shadow-2xl px-3 py-2 overflow-hidden"
              style={{
                borderLeftWidth: 4,
                borderLeftColor: color,
                boxShadow: `0 20px 30px -10px rgba(0, 0, 0, 0.8), 0 0 20px -5px ${color}25`,
              }}
            >
              {/* Vector Icon container */}
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors"
                style={{
                  backgroundColor: `${color}18`,
                  borderColor: `${color}40`,
                  color,
                }}
                aria-hidden
              >
                <Icon size={20} className="stroke-[2.2]" />
              </div>

              {/* Hazard details */}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate text-sm font-black tracking-tight text-white">
                      {hazard.title}
                    </span>
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-zinc-400 bg-white/5 border border-white/10">
                      {HAZARD_SHORT[hazard.kind]}
                    </span>
                  </div>

                  {/* Live distance countdown with colored unit badge */}
                  <div className="shrink-0 flex items-baseline">
                    <span
                      className="text-lg font-black tabular-nums tracking-tight"
                      style={{ color }}
                    >
                      {distM}
                    </span>
                    <span
                      className="ml-1 rounded px-1 py-0.5 text-[9.5px] font-black uppercase tracking-wider"
                      style={{
                        backgroundColor: `${color}25`,
                        color,
                      }}
                    >
                      m
                    </span>
                  </div>
                </div>

                {/* Clean Advisory Pill */}
                {hazard.advisory && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900/90 border border-zinc-700/60 px-2 py-0.5 text-[10.5px] font-semibold text-zinc-200 shadow-sm">
                      <Navigation2 size={10} className="shrink-0" style={{ color }} />
                      <span className="truncate">{hazard.advisory}</span>
                      {hazard.advisorySpeedKmh != null && (
                        <span className="ml-0.5 rounded-full border border-white/20 bg-white/10 px-1.5 py-px text-[9px] font-bold tabular-nums text-white">
                          {hazard.advisorySpeedKmh} km/h
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Dismiss Button */}
              {onDismiss && (
                <button
                  onClick={() => onDismiss(hazard.id)}
                  className="pointer-events-auto shrink-0 p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/10 transition-colors"
                  aria-label="Dismiss hazard alert"
                >
                  <X size={14} />
                </button>
              )}
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}
