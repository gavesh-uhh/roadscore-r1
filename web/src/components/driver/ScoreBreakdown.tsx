'use client';

/**
 * ScoreBreakdown — animated sub-score bars (DRIVER_VIEW_V2_PLAN §3.7, E5)
 *
 * Four glanceable meters: Longitudinal (braking/accel smoothness), Lateral
 * (cornering), Speed Compliance, and Eco.
 */

import { motion } from 'framer-motion';
import type { ScoreBreakdown as Breakdown } from '@/lib/sim/demoSimulator';

const BARS: Array<{ key: keyof Breakdown; label: string }> = [
  { key: 'longitudinal', label: 'Braking' },
  { key: 'lateral', label: 'Cornering' },
  { key: 'speedCompliance', label: 'Speed Limit' },
  { key: 'eco', label: 'Eco' },
];

function barColor(v: number): string {
  if (v >= 90) return 'var(--drv-accent)';
  if (v >= 75) return 'var(--drv-warn)';
  return 'var(--drv-danger)';
}

export function ScoreBreakdown({ breakdown }: { breakdown: Breakdown }) {
  return (
    <div className="grid grid-cols-4 gap-2 px-3">
      {BARS.map(({ key, label }) => {
        const v = breakdown[key];
        return (
          <div key={key} className="min-w-0">
            <div className="flex items-baseline justify-between gap-1">
              <span className="truncate text-[9px] font-semibold uppercase tracking-wide text-zinc-500">
                {label}
              </span>
              <span className="text-[10px] font-bold tabular-nums text-zinc-300">{v}</span>
            </div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-zinc-900">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: barColor(v) }}
                initial={false}
                animate={{ width: `${v}%` }}
                transition={{ type: 'spring', stiffness: 80, damping: 22 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
