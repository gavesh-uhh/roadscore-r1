'use client';

/**
 * TrueScoreCards — floating single-alert notification banner (DRIVER_VIEW_PLAN §4.1)
 *
 * Renders the single active co-pilot alert/warning card docked above the action bar:
 *  - TrueScore™ Shield exonerations (ShieldCheck vector icon, emerald)
 *  - Eco-Glide coasting advisories (Leaf vector icon, emerald)
 *  - Harsh maneuver deductions (AlertTriangle vector icon, rose)
 *  - Generic system notices (Info vector icon, sky/zinc)
 *
 * Guaranteed ZERO emojis, strict AnimatePresence mode="wait", and an animated
 * time-to-dismiss progress bar.
 */

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Leaf, AlertTriangle, Info, X } from 'lucide-react';

export type AssistCardKind = 'exoneration' | 'eco' | 'deduction' | 'info';

export interface AssistCard {
  id: string;
  kind: AssistCardKind;
  title: string;
  message: string;
  createdAt: number;
  ttlMs?: number;
}

const KIND_STYLE: Record<
  AssistCardKind,
  {
    border: string;
    bg: string;
    iconColor: string;
    iconBg: string;
    chip: string;
    progressColor: string;
  }
> = {
  exoneration: {
    border: 'border-emerald-500/70',
    bg: 'bg-emerald-950/95',
    iconColor: 'text-emerald-400',
    iconBg: 'bg-emerald-500/20 border-emerald-500/40',
    chip: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/50',
    progressColor: 'bg-emerald-400',
  },
  eco: {
    border: 'border-emerald-600/70',
    bg: 'bg-emerald-950/90',
    iconColor: 'text-emerald-300',
    iconBg: 'bg-emerald-500/15 border-emerald-500/30',
    chip: 'bg-emerald-500/15 text-emerald-200 border-emerald-600/50',
    progressColor: 'bg-emerald-400',
  },
  deduction: {
    border: 'border-rose-500/70',
    bg: 'bg-rose-950/95',
    iconColor: 'text-rose-400',
    iconBg: 'bg-rose-500/20 border-rose-500/40',
    chip: 'bg-rose-500/20 text-rose-200 border-rose-500/50',
    progressColor: 'bg-rose-500',
  },
  info: {
    border: 'border-zinc-700/80',
    bg: 'bg-zinc-900/95',
    iconColor: 'text-sky-400',
    iconBg: 'bg-sky-500/15 border-sky-500/30',
    chip: 'bg-zinc-800 text-zinc-200 border-zinc-600/50',
    progressColor: 'bg-sky-400',
  },
};

function CardIcon({ kind }: { kind: AssistCardKind }) {
  const style = KIND_STYLE[kind];
  if (kind === 'exoneration') {
    return (
      <div className={`relative flex h-8 w-8 items-center justify-center rounded-lg border ${style.iconBg}`}>
        <ShieldCheck size={18} className={style.iconColor} />
      </div>
    );
  }
  if (kind === 'eco') {
    return (
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${style.iconBg}`}>
        <Leaf size={18} className={style.iconColor} />
      </div>
    );
  }
  if (kind === 'deduction') {
    return (
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${style.iconBg}`}>
        <AlertTriangle size={18} className={style.iconColor} />
      </div>
    );
  }
  return (
    <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${style.iconBg}`}>
      <Info size={18} className={style.iconColor} />
    </div>
  );
}

export interface TrueScoreCardsProps {
  cards: AssistCard[];
  onDismiss: (id: string) => void;
  className?: string;
}

export function TrueScoreCards({ cards, onDismiss, className = '' }: TrueScoreCardsProps) {
  // Strictly display only the single latest active card
  const activeCard = cards[cards.length - 1];

  // Fail-safe auto-dismiss timer
  useEffect(() => {
    if (!activeCard) return;
    const ttl = activeCard.ttlMs || 6000;
    const timer = setTimeout(() => {
      onDismiss(activeCard.id);
    }, ttl);
    return () => clearTimeout(timer);
  }, [activeCard?.id, activeCard?.ttlMs, onDismiss]);

  return (
    <div
      className={`pointer-events-none flex flex-col items-center w-full max-w-md mx-auto ${className}`}
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        {activeCard && (
          <motion.div
            key={activeCard.id}
            initial={{ opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 440, damping: 30 }}
            className={`pointer-events-auto relative w-full rounded-2xl border ${KIND_STYLE[activeCard.kind].border} ${KIND_STYLE[activeCard.kind].bg} backdrop-blur-xl shadow-2xl shadow-black/95 overflow-hidden`}
          >
            <div className="flex items-center gap-3 px-3.5 py-3">
              <div className="shrink-0">
                <CardIcon kind={activeCard.kind} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider border ${KIND_STYLE[activeCard.kind].chip}`}
                  >
                    {activeCard.title}
                  </span>
                </div>
                <p className="mt-0.5 text-xs font-semibold leading-snug text-zinc-100">
                  {activeCard.message}
                </p>
              </div>

              <button
                onClick={() => onDismiss(activeCard.id)}
                className="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
                aria-label="Dismiss notification"
              >
                <X size={15} />
              </button>
            </div>

            {/* Animated subtle progress bar indicating remaining TTL before auto-dismiss */}
            <div className="h-0.5 w-full bg-white/10 overflow-hidden">
              <motion.div
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{
                  duration: (activeCard.ttlMs || 5000) / 1000,
                  ease: 'linear',
                }}
                className={`h-full origin-left ${KIND_STYLE[activeCard.kind].progressColor}`}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
