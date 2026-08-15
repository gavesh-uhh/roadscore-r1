'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Activity,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import {
  calculateDriverDeductions,
  getExcludedEvents,
  TelematicsEvent,
} from '@/lib/scoring/continuousEngine';
import { formatEventType } from '@/lib/events/format';

interface ScoreAuditDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  driverName: string;
  vehiclePlate: string;
  currentScore: number;
  events: TelematicsEvent[];
}

export function ScoreAuditDrawer({
  isOpen,
  onClose,
  driverName,
  vehiclePlate,
  currentScore,
  events,
}: ScoreAuditDrawerProps) {
  if (!isOpen) return null;

  const deductions = calculateDriverDeductions(events);
  const excluded = getExcludedEvents(events);
  const totalDeductions = deductions.reduce((sum, d) => sum + d.netPenalty, 0);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
        {/* Backdrop click */}
        <div className="absolute inset-0" onClick={onClose} />

        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="relative w-full max-w-md h-full bg-zinc-950 border-l border-zinc-800 text-white flex flex-col shadow-2xl z-10 overflow-hidden"
        >
          {/* Header */}
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-400" />
              <div>
                <h3 className="font-semibold text-sm text-white">Score Deduction Audit</h3>
                <p className="text-[11px] text-zinc-400 font-mono">
                  {driverName} • {vehiclePlate}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Score Snapshot Overview */}
          <div className="p-4 border-b border-zinc-800 bg-zinc-900/20 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] text-zinc-400 uppercase tracking-wider font-mono">
                  24h Continuous Score
                </span>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span
                    className={`text-3xl font-bold font-mono ${
                      currentScore >= 90
                        ? 'text-emerald-400'
                        : currentScore >= 75
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {currentScore.toFixed(1)}
                  </span>
                  <span className="text-zinc-500 text-xs font-mono">/ 100.0</span>
                </div>
              </div>

              <div className="text-right space-y-0.5">
                <span className="text-[10px] text-zinc-500 font-mono block">Baseline: 100.0</span>
                <span className="text-[10px] text-rose-400 font-mono font-medium block">
                  Deductions: -{totalDeductions.toFixed(1)} pts
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-md bg-zinc-900/80 border border-zinc-800 text-[11px] text-zinc-300 flex items-start gap-2">
              <Zap size={14} className="text-amber-400 shrink-0 mt-0.5" />
              <p>
                Safety scores calculate in real-time with continuous 12-hour exponential half-life decay. Points recover automatically if driving remains smooth.
              </p>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* Active Deductions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="text-rose-400" />
                  Active Incident Deductions ({deductions.length})
                </h4>
                <span className="text-[10px] text-zinc-500 font-mono">Within 24 Hours</span>
              </div>

              {deductions.length === 0 ? (
                <div className="p-4 rounded-md bg-emerald-950/20 border border-emerald-900/40 text-center space-y-1">
                  <CheckCircle2 size={18} className="text-emerald-400 mx-auto" />
                  <p className="text-xs font-medium text-emerald-300">Clean Telematics Record</p>
                  <p className="text-[10px] text-zinc-400">Zero driver-attributed harsh events in the past 24 hours.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {deductions.map((d, idx) => {
                    const fmt = formatEventType(d.type);
                    return (
                      <div
                        key={`ded-${d.id}-${idx}`}
                        className="p-2.5 rounded-md bg-zinc-900/60 border border-zinc-800 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: fmt.dotColor }}
                            />
                            <span className="text-xs font-medium text-white">{fmt.label}</span>
                          </div>
                          <span className="text-xs font-mono font-bold text-rose-400">
                            -{d.netPenalty.toFixed(2)} pts
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono pt-1 border-t border-zinc-800/60">
                          <span className="flex items-center gap-1 text-zinc-500">
                            <Clock size={10} />
                            {new Date(d.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span>
                            Severity: <strong className="text-zinc-300 uppercase">{d.severity}</strong> • Decay: {Math.round(d.decayFactor * 100)}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Fairly Excluded Events (§8 Arbitrated Fairness) */}
            {excluded.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                    <ShieldCheck size={12} className="text-emerald-400" />
                    Excluded Incidents (§8 Fairness Filter)
                  </h4>
                  <span className="text-[10px] text-emerald-400 font-mono font-medium">0 pts deducted</span>
                </div>

                <div className="space-y-2">
                  {excluded.map((item, idx) => (
                    <div
                      key={`excl-${item.event.id || idx}`}
                      className="p-2 rounded-md bg-zinc-900/30 border border-zinc-800/60 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-zinc-300">{item.event.type}</span>
                        <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-1.5 py-0.2 rounded-xs border border-emerald-800/40">
                          Protected
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500">{item.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-zinc-800 bg-zinc-900/40 text-center">
            <p className="text-[10px] text-zinc-500 font-mono">
              RoadScore Engine v0.1.0 • Spec §8 Continuous Scoring Rule
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
