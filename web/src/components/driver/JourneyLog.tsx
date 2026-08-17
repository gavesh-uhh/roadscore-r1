'use client';

/**
 * JourneyLog — chronological cockpit event feed (DRIVER_VIEW_V2_PLAN §3.7, E4)
 *
 * Append-only, auto-scrolling feed of everything the co-pilot did: hazard
 * warnings, Shield exonerations, eco tips, deductions, trip start/stop.
 * Ring-buffered upstream (50 entries).
 */

import { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  ShieldCheck,
  Leaf,
  Play,
  Square,
  Navigation2,
  Info,
  Zap,
} from 'lucide-react';

export type LogTone = 'danger' | 'warn' | 'success' | 'info' | 'muted';

export interface LogEntry {
  id: string;
  ts: number;
  icon: 'hazard' | 'shield' | 'eco' | 'trip-start' | 'trip-end' | 'maneuver' | 'info';
  text: string;
  tone: LogTone;
}

const TONE_CLASS: Record<LogTone, string> = {
  danger: 'text-rose-300',
  warn: 'text-amber-300',
  success: 'text-emerald-300',
  info: 'text-sky-300',
  muted: 'text-zinc-400',
};

function LogIcon({ icon, tone }: { icon: LogEntry['icon']; tone: LogTone }) {
  const cls = TONE_CLASS[tone];
  switch (icon) {
    case 'hazard':
      return <AlertTriangle size={11} className={cls} />;
    case 'shield':
      return <ShieldCheck size={11} className={cls} />;
    case 'eco':
      return <Leaf size={11} className={cls} />;
    case 'trip-start':
      return <Play size={11} className={cls} />;
    case 'trip-end':
      return <Square size={11} className={cls} />;
    case 'maneuver':
      return <Zap size={11} className={cls} />;
    case 'info':
    default:
      return <Info size={11} className={cls} />;
  }
}

export function JourneyLog({ entries }: { entries: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to newest entry.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-3 py-1.5" aria-label="Journey log">
      {entries.length === 0 ? (
        <div className="flex h-full items-center justify-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-700">
          <Navigation2 size={11} />
          Journey events will appear here
        </div>
      ) : (
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start gap-2 text-[11px] leading-snug">
              <span className="pt-0.5 shrink-0">
                <LogIcon icon={e.icon} tone={e.tone} />
              </span>
              <span className="shrink-0 tabular-nums text-zinc-600 text-[10px] pt-px">
                {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={`min-w-0 flex-1 ${TONE_CLASS[e.tone]}`}>{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
