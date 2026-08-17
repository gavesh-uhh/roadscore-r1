'use client';

/**
 * SpeedHero — dominant cockpit speed readout (UI_POLISH P0-2)
 *
 * Features:
 *  - 72px–84px rolling speed digits with high-contrast tabular mono font
 *  - Vienna-convention regulatory circular speed limit sign (white circle, vivid red border, black speed text)
 *    with pulsating over-limit alert animation when speed > limit
 *  - Delta-v (Δv) speed differential badge
 *  - Eco-Glide coasting indicator
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Leaf } from 'lucide-react';

function RollingDigit({ digit }: { digit: string }) {
  return (
    <span className="relative inline-block h-[0.92em] w-[0.62em] overflow-hidden align-baseline">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={digit}
          initial={{ y: '60%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={{ y: '-60%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 36 }}
          className="absolute inset-0 flex items-center justify-center font-mono font-black"
        >
          {digit}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export interface SpeedHeroProps {
  speedKmh: number;
  speedLimitKmh: number;
  coasting: boolean;
  deltaV?: number;
  className?: string;
}

export function SpeedHero({
  speedKmh,
  speedLimitKmh,
  coasting,
  deltaV: explicitDeltaV,
  className = '',
}: SpeedHeroProps) {
  const speed = Math.max(0, Math.round(speedKmh));
  const limit = Math.max(0, Math.round(speedLimitKmh));
  const overLimit = speed > limit;
  const deltaV = explicitDeltaV !== undefined ? explicitDeltaV : speed - limit;
  const digits = String(speed).padStart(2, '0').split('');

  const digitColor = overLimit
    ? 'text-rose-400 drop-shadow-[0_0_16px_rgba(244,63,94,0.4)]'
    : coasting
      ? 'text-emerald-300 drop-shadow-[0_0_16px_rgba(16,185,129,0.35)]'
      : 'text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]';

  return (
    <div className={`pointer-events-none flex items-end gap-3.5 select-none ${className}`}>
      {/* 56px–80px High-Contrast Tabular Mono Rolling Speed Digits */}
      <div
        className={`flex items-baseline leading-none font-mono font-black tabular-nums tracking-tighter transition-colors duration-300 ${digitColor}`}
        style={{ fontSize: 'clamp(56px, 7.5vw, 80px)', lineHeight: 0.88 }}
        aria-label={`Current speed ${speed} kilometers per hour`}
      >
        {digits.map((d, i) => (
          <RollingDigit key={`${i}-${digits.length}`} digit={d} />
        ))}
      </div>

      {/* Auxiliary Telemetry Cluster (Unit, Vienna Sign, Delta-v, Eco-Glide) */}
      <div className="flex flex-col items-start gap-1.5 pb-1">
        <div className="flex items-center gap-2">
          {/* Unit */}
          <span
            className={`text-[11px] font-mono font-bold uppercase tracking-widest ${
              coasting ? 'text-emerald-400' : 'text-zinc-400'
            }`}
          >
            km/h
          </span>

          {/* Delta-v Badge */}
          <span
            className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-tight border transition-colors ${
              overLimit
                ? 'border-rose-500/60 bg-rose-950/80 text-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                : deltaV === 0
                  ? 'border-emerald-500/50 bg-emerald-950/70 text-emerald-300'
                  : 'border-zinc-700/60 bg-zinc-900/80 text-zinc-300'
            }`}
            title="Speed differential to limit"
          >
            <span>Δv</span>
            <span>{deltaV > 0 ? `+${deltaV}` : `${deltaV}`}</span>
          </span>
        </div>

        {/* Vienna-convention Regulatory Circular Speed Limit Sign */}
        <div className="relative flex items-center">
          <motion.div
            animate={
              overLimit
                ? {
                    scale: [1, 1.08, 1],
                    boxShadow: [
                      '0 0 0px rgba(220,38,38,0.4)',
                      '0 0 18px rgba(220,38,38,0.85), 0 0 30px rgba(220,38,38,0.4)',
                      '0 0 0px rgba(220,38,38,0.4)',
                    ],
                  }
                : {
                    scale: 1,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
                  }
            }
            transition={
              overLimit
                ? { repeat: Infinity, duration: 1.1, ease: 'easeInOut' }
                : { duration: 0.2 }
            }
            className="flex items-center justify-center rounded-full bg-white border-[4.5px] border-[#DC2626] shadow-xl"
            style={{ width: 44, height: 44 }}
            aria-label={`Regulatory speed limit ${limit} km/h`}
          >
            <span className="text-[16px] font-sans font-black tabular-nums text-black leading-none tracking-tight">
              {limit}
            </span>
          </motion.div>
        </div>

        {/* Eco-Glide Coasting Indicator */}
        <AnimatePresence>
          {coasting && (
            <motion.div
              initial={{ opacity: 0, scale: 0.85, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.85, y: 4 }}
              transition={{ type: 'spring', stiffness: 450, damping: 28 }}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-400/60 bg-emerald-950/90 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.45)]"
            >
              <Leaf size={10} className="text-emerald-400 animate-pulse" />
              <span>Eco-Glide</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
