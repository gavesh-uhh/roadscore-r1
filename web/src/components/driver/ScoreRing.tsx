'use client';

/**
 * ScoreRing — TrueScore™ precision dial (UI_POLISH P0-4)
 *
 * Precision SVG arc with dynamic neon glow filter, centered large score (0–100),
 * and status protection pill beneath:
 *   - "+0 Deducted · Shield Armed" (emerald)
 *   - "−X pts Harsh" (rose)
 */

import { motion } from 'framer-motion';
import { ShieldCheck, AlertTriangle } from 'lucide-react';

export interface ScoreRingProps {
  score: number;
  deductions: number;
  protectedCount: number;
  size?: number;
  className?: string;
}

export function ScoreRing({
  score,
  deductions,
  protectedCount = 0,
  size = 96,
  className = '',
}: ScoreRingProps) {
  const stroke = Math.max(6, Math.round(size * 0.075));
  const r = (size - stroke * 2) / 2;
  const c = 2 * Math.PI * r;
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  const frac = safeScore / 100;

  const color =
    safeScore >= 90 ? '#10B981' : safeScore >= 75 ? '#F59E0B' : '#F43F5E';
  const colorClass =
    safeScore >= 90 ? 'text-emerald-400' : safeScore >= 75 ? 'text-amber-400' : 'text-rose-400';
  const glowShadow =
    safeScore >= 90
      ? 'drop-shadow(0 0 8px rgba(16,185,129,0.65))'
      : safeScore >= 75
        ? 'drop-shadow(0 0 8px rgba(245,158,11,0.65))'
        : 'drop-shadow(0 0 8px rgba(244,63,94,0.65))';

  const filterId = `score-glow-${size}`;

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90 overflow-visible">
          <defs>
            <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background Track Circle */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth={stroke}
          />

          {/* Inner subtle reference dial */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r - stroke * 0.9}
            fill="none"
            stroke="rgba(255, 255, 255, 0.03)"
            strokeWidth={1}
            strokeDasharray="2 4"
          />

          {/* Animated Neon Arc */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            initial={false}
            animate={{ strokeDashoffset: c * (1 - frac) }}
            transition={{ type: 'spring', stiffness: 50, damping: 16 }}
            style={{ filter: glowShadow }}
          />
        </svg>

        {/* Centered Large Score + / 100 label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center select-none pointer-events-none">
          <span
            className={`font-mono font-black tabular-nums leading-none tracking-tight ${colorClass}`}
            style={{ fontSize: size >= 90 ? '2rem' : '1.5rem' }}
          >
            {safeScore}
          </span>
          <span className="mt-0.5 text-[9px] font-sans font-bold uppercase tracking-wider text-zinc-400">
            / 100
          </span>
        </div>
      </div>

      {/* Status Protection Pill */}
      <div
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider shadow-md transition-colors ${
          deductions === 0
            ? 'border-emerald-500/50 bg-emerald-950/70 text-emerald-300 shadow-emerald-950/40'
            : 'border-rose-500/50 bg-rose-950/70 text-rose-300 shadow-rose-950/40'
        }`}
      >
        {deductions === 0 ? (
          <>
            <ShieldCheck size={11} className="text-emerald-400 shrink-0" />
            <span title={protectedCount > 0 ? `${protectedCount} events exonerated` : 'Shield Armed'}>
              +0 Deducted · Shield Armed
            </span>
          </>
        ) : (
          <>
            <AlertTriangle size={11} className="text-rose-400 shrink-0" />
            <span>−{deductions} pts Harsh</span>
          </>
        )}
      </div>
    </div>
  );
}
