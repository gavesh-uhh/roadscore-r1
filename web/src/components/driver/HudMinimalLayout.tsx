'use client';

/**
 * HudMinimalLayout — Windshield HUD 2.0 (UI_POLISH §4.1)
 *
 * A dedicated minimal composition for windshield reflection at night,
 * rendered inside the cockpit's mirrored (scaleX(-1)) OLED-black wrapper:
 * only the three facts a driver may glance at — speed, next manoeuvre, score.
 * Tap anywhere to exit.
 */

import type { HorizonHazard } from '@/lib/sim/demoSimulator';
import { HAZARD_ICON, HAZARD_COLOR } from './hazardMeta';
import { ScoreRing } from './ScoreRing';

export interface HudMinimalLayoutProps {
  speedKmh: number;
  speedLimitKmh: number;
  nextHazard: HorizonHazard | null;
  score: number;
  coasting: boolean;
  onExit: () => void;
}

export function HudMinimalLayout({
  speedKmh,
  speedLimitKmh,
  nextHazard,
  score,
  coasting,
  onExit,
}: HudMinimalLayoutProps) {
  const speed = Math.max(0, Math.round(speedKmh));
  const overLimit = speed > speedLimitKmh;
  const speedColor = overLimit ? 'text-rose-400' : coasting ? 'text-emerald-300' : 'text-white';

  return (
    <button
      onClick={onExit}
      className="flex h-full w-full flex-col items-center justify-center gap-6 bg-black text-center"
      aria-label="Exit windshield HUD mode"
    >
      {/* Next manoeuvre */}
      <div className="flex min-h-[64px] items-center justify-center px-6">
        {nextHazard ? (
          (() => {
            const Icon = HAZARD_ICON[nextHazard.kind];
            return (
              <div className="flex items-center gap-3">
                <span className="shrink-0" style={{ color: HAZARD_COLOR[nextHazard.kind] }} aria-hidden>
                  <Icon size={36} />
                </span>
                <span
                  className="text-2xl font-extrabold tabular-nums"
                  style={{ color: HAZARD_COLOR[nextHazard.kind] }}
                >
                  {nextHazard.title} · {Math.max(0, Math.round(nextHazard.distanceM))}m
                </span>
                {nextHazard.advisory && (
                  <span className="text-xl font-bold text-zinc-300">{nextHazard.advisory}</span>
                )}
              </div>
            );
          })()
        ) : (
          <span className="text-xl font-bold uppercase tracking-widest text-zinc-700">
            Path Clear
          </span>
        )}
      </div>

      {/* Hero speed */}
      <div className="flex items-end gap-5">
        <span
          className={`font-black tabular-nums leading-none ${speedColor}`}
          style={{ fontSize: 'var(--drv-t-hud, 128px)' }}
        >
          {speed}
        </span>
        <div className="flex flex-col items-start gap-2 pb-4">
          <span className="text-lg font-bold uppercase tracking-widest text-zinc-500">km/h</span>
          <span
            className="flex items-center justify-center rounded-full bg-white"
            style={{ width: 56, height: 56, border: '5px solid var(--drv-danger)' }}
          >
            <span className="text-xl font-black tabular-nums text-black">{speedLimitKmh}</span>
          </span>
        </div>
      </div>

      {/* Score */}
      <ScoreRing score={score} deductions={0} protectedCount={0} size={72} />

      <span className="absolute bottom-6 text-[10px] font-semibold uppercase tracking-widest text-zinc-700">
        Tap anywhere to exit HUD
      </span>
    </button>
  );
}
