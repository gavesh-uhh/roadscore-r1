'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/common/Header';
import {
  AlertTriangle,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Activity,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Route,
  Sparkles,
} from 'lucide-react';

type ActionType = 'CLEAN_TRIPS' | 'RESET_SCORES' | 'PURGE_ALL_DATA';

interface ModalConfig {
  action: ActionType;
  title: string;
  description: string;
  confirmWord?: string;
  buttonText: string;
  badge: string;
  variant: 'amber' | 'emerald' | 'rose';
}

const MODAL_CONFIGS: Record<ActionType, ModalConfig> = {
  CLEAN_TRIPS: {
    action: 'CLEAN_TRIPS',
    title: 'Clean Up Trip Records?',
    description: 'This will delete all completed and active trip records. Driver profiles, hardware devices, vehicle assignments, and road defect maps will NOT be affected.',
    buttonText: 'Clean Trips',
    badge: 'Trips Only',
    variant: 'amber',
  },
  RESET_SCORES: {
    action: 'RESET_SCORES',
    title: 'Reset Safety Scores to 100?',
    description: 'This will clear all driver-attributed infractions (harsh brakes, accelerations, speeding). All drivers will immediately return to a pristine 100.0 baseline score. Trips, road hazards, and vehicle assignments are preserved.',
    buttonText: 'Reset Scores to 100',
    badge: 'Score Restoration',
    variant: 'emerald',
  },
  PURGE_ALL_DATA: {
    action: 'PURGE_ALL_DATA',
    title: 'Reset All Pipeline Data to 0?',
    description: 'This will wipe all telematics packets, trips, driving events, road cells, and defect observations for a complete clean slate. Registered vehicles, devices, and drivers will remain.',
    confirmWord: 'RESET',
    buttonText: 'Purge Everything',
    badge: 'Full Wipe',
    variant: 'rose',
  },
};

export default function EngineSettings() {
  const [activeModal, setActiveModal] = useState<ModalConfig | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const executeAction = async (action: ActionType) => {
    setIsProcessing(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/admin/purge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to execute maintenance action');
      }

      setStatusMessage({
        type: 'success',
        text: data.message || 'Action executed successfully.',
      });
      setActiveModal(null);
      setConfirmInput('');
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'An error occurred while executing the maintenance action',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header
        title="Settings"
        subtitle="Engine thresholds, system rules, and data maintenance"
      />

      <div className="p-5 space-y-6 max-w-6xl w-full mx-auto">
        {/* Status Notification Banner */}
        <AnimatePresence>
          {statusMessage && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className={`p-3.5 rounded-md border flex items-center gap-3 ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/50 border-rose-500/40 text-rose-300'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              ) : (
                <XCircle size={16} className="text-rose-400 shrink-0" />
              )}
              <div className="flex-1 text-xs">
                <span>{statusMessage.text}</span>
              </div>
              <button
                onClick={() => setStatusMessage(null)}
                className="text-zinc-400 hover:text-white text-sm px-1 cursor-pointer"
              >
                ×
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Engine Governance Header Card */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Detection & Scoring Rules</h2>
            <p className="text-zinc-400 text-[11px] mt-0.5">
              Active Canonical Rule Version: <span className="text-emerald-400 font-mono font-bold">2026.08.09-r1</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 text-[11px] font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Engine Online
            </span>
          </div>
        </div>

        {/* Detection Rules Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3">
            <h3 className="font-bold text-zinc-400 uppercase text-[10px] border-b border-zinc-800 pb-2 flex items-center gap-2">
              <Activity size={13} className="text-emerald-400" />
              Braking & Acceleration Sensitivity
            </h3>
            <div className="space-y-2 text-zinc-300 font-mono">
              <div className="flex justify-between p-2 bg-black rounded border border-zinc-800/80">
                <span className="text-zinc-400 font-sans">Harsh Brake (Low):</span>
                <strong className="text-white">-3.0 m/s²</strong>
              </div>
              <div className="flex justify-between p-2 bg-black rounded border border-zinc-800/80">
                <span className="text-zinc-400 font-sans">Harsh Brake (Medium):</span>
                <strong className="text-white">-4.5 m/s²</strong>
              </div>
              <div className="flex justify-between p-2 bg-black rounded border border-zinc-800/80">
                <span className="text-zinc-400 font-sans">Harsh Brake (High):</span>
                <strong className="text-white">-6.0 m/s²</strong>
              </div>
              <div className="flex justify-between p-2 bg-black rounded border border-zinc-800/80">
                <span className="text-zinc-400 font-sans">Harsh Acceleration:</span>
                <strong className="text-white">+2.5 m/s²</strong>
              </div>
            </div>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3">
            <h3 className="font-bold text-zinc-400 uppercase text-[10px] border-b border-zinc-800 pb-2 flex items-center gap-2">
              <MapPin size={13} className="text-amber-400" />
              Road Hazard Detection
            </h3>
            <div className="space-y-2 text-zinc-300 font-mono">
              <div className="flex justify-between p-2 bg-black rounded border border-zinc-800/80">
                <span className="text-zinc-400 font-sans">Min Distinct Vehicles:</span>
                <strong className="text-white">≥ 3 passes</strong>
              </div>
              <div className="flex justify-between p-2 bg-black rounded border border-zinc-800/80">
                <span className="text-zinc-400 font-sans">Road Defect Threshold:</span>
                <strong className="text-white">≥ 60% impact rate</strong>
              </div>
              <div className="flex justify-between p-2 bg-black rounded border border-zinc-800/80">
                <span className="text-zinc-400 font-sans">Driver Penalty Threshold:</span>
                <strong className="text-white">≤ 25% impact rate</strong>
              </div>
              <div className="flex justify-between p-2 bg-black rounded border border-zinc-800/80">
                <span className="text-zinc-400 font-sans">Grid Precision:</span>
                <strong className="text-emerald-400">3.3 meters</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Data Maintenance Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
            <div>
              <h2 className="text-sm font-bold text-white">Data Maintenance & Controls</h2>
              <p className="text-zinc-400 text-[11px]">
                Granular cleanup utilities to reset trips or restore safety scores without deleting fleet registry
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Card 1: Clean Up Trips */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 flex flex-col justify-between space-y-4 hover:border-zinc-700 transition-colors">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded bg-amber-950/50 border border-amber-800/50 text-amber-400">
                      <Route size={16} />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-white">Clean Up Trips</h3>
                      <span className="text-[10px] text-amber-400 font-mono">Trips Table Only</span>
                    </div>
                  </div>
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Remove all active and completed trip replay records. Preserves all driver profiles, vehicle registrations, hardware devices, and road quality maps.
                </p>
              </div>

              <div className="pt-2 border-t border-zinc-900 flex items-center justify-between">
                <span className="text-[10px] text-zinc-500 font-mono">Keeps events & scores</span>
                <button
                  id="btn-clean-trips"
                  type="button"
                  onClick={() => {
                    setConfirmInput('');
                    setActiveModal(MODAL_CONFIGS.CLEAN_TRIPS);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-950/70 hover:bg-amber-900/80 text-amber-300 font-medium rounded border border-amber-800/80 transition-colors cursor-pointer text-xs"
                >
                  <Route size={12} />
                  <span>Clean Up Trips</span>
                </button>
              </div>
            </div>

            {/* Card 2: Reset Score to 100 */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 flex flex-col justify-between space-y-4 hover:border-zinc-700 transition-colors">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded bg-emerald-950/50 border border-emerald-800/50 text-emerald-400">
                      <Sparkles size={16} />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-white">Reset Scores to 100</h3>
                      <span className="text-[10px] text-emerald-400 font-mono">Clear Infractions</span>
                    </div>
                  </div>
                </div>
                <p className="text-zinc-400 text-[11px] leading-relaxed">
                  Clear all recorded driver misconduct infractions (harsh brakes, cornering, speeding). Immediately restores all driver safety scores to 100.0 baseline while keeping trips and road hazards intact.
                </p>
              </div>

              <div className="pt-2 border-t border-zinc-900 flex items-center justify-between">
                <span className="text-[10px] text-zinc-500 font-mono">Keeps trips & road cells</span>
                <button
                  id="btn-reset-scores"
                  type="button"
                  onClick={() => {
                    setConfirmInput('');
                    setActiveModal(MODAL_CONFIGS.RESET_SCORES);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 font-medium rounded border border-emerald-800/80 transition-colors cursor-pointer text-xs"
                >
                  <ShieldCheck size={12} />
                  <span>Reset Scores to 100</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Danger Zone: Full Wipe */}
        <div className="border border-rose-900/40 bg-zinc-950/80 rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded bg-rose-950/60 border border-rose-900/60 text-rose-400">
                <ShieldAlert size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-300">
                  Danger Zone — Full System Purge
                </h3>
                <p className="text-zinc-400 text-[11px] mt-0.5">
                  Wipe all telematics packets, trips, driving events, road cells, and defect observations to start from 0.
                </p>
              </div>
            </div>

            <button
              id="btn-purge-all"
              type="button"
              onClick={() => {
                setConfirmInput('');
                setActiveModal(MODAL_CONFIGS.PURGE_ALL_DATA);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-900/80 hover:bg-rose-800 text-white font-medium rounded border border-rose-700/80 transition-colors cursor-pointer text-xs"
            >
              <Trash2 size={13} />
              <span>Reset Data to 0</span>
            </button>
          </div>

          <p className="text-[11px] text-zinc-500 pt-1 border-t border-zinc-900">
            Note: Registered devices, vehicles, and driver profiles will always be preserved across all maintenance operations.
          </p>
        </div>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {activeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => {
                if (!isProcessing) {
                  setActiveModal(null);
                  setConfirmInput('');
                }
              }}
              className="fixed inset-0 bg-black/80 backdrop-blur-xs"
            />

            {/* Dialog Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="relative z-10 bg-zinc-950 border border-zinc-800 rounded-lg max-w-md w-full p-5 space-y-4 shadow-2xl"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`p-2.5 rounded-full border ${
                    activeModal.variant === 'rose'
                      ? 'bg-rose-950/80 border-rose-800/80 text-rose-400'
                      : activeModal.variant === 'amber'
                      ? 'bg-amber-950/80 border-amber-800/80 text-amber-400'
                      : 'bg-emerald-950/80 border-emerald-800/80 text-emerald-400'
                  }`}
                >
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{activeModal.title}</h3>
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-mono mt-0.5 ${
                      activeModal.variant === 'rose'
                        ? 'bg-rose-950 text-rose-400 border border-rose-800/50'
                        : activeModal.variant === 'amber'
                        ? 'bg-amber-950 text-amber-400 border border-amber-800/50'
                        : 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                    }`}
                  >
                    {activeModal.badge}
                  </span>
                </div>
              </div>

              <p className="text-zinc-300 text-xs leading-relaxed">{activeModal.description}</p>

              {activeModal.confirmWord && (
                <div className="p-3 bg-black rounded border border-zinc-800 space-y-2 text-xs">
                  <p className="text-zinc-300">
                    Type <span className="text-rose-400 font-bold font-mono">{activeModal.confirmWord}</span> to confirm:
                  </p>
                  <input
                    type="text"
                    value={confirmInput}
                    onChange={(e) => setConfirmInput(e.target.value)}
                    placeholder={activeModal.confirmWord}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-rose-500"
                    autoFocus
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setActiveModal(null);
                    setConfirmInput('');
                  }}
                  disabled={isProcessing}
                  className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 transition-colors text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={() => executeAction(activeModal.action)}
                  disabled={
                    (activeModal.confirmWord && confirmInput.trim().toUpperCase() !== activeModal.confirmWord) ||
                    isProcessing
                  }
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-medium text-white transition-colors cursor-pointer ${
                    activeModal.variant === 'rose'
                      ? confirmInput.trim().toUpperCase() === activeModal.confirmWord && !isProcessing
                        ? 'bg-rose-600 hover:bg-rose-500'
                        : 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                      : activeModal.variant === 'amber'
                      ? 'bg-amber-600 hover:bg-amber-500'
                      : 'bg-emerald-600 hover:bg-emerald-500'
                  }`}
                >
                  {isProcessing ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      <span>Executing...</span>
                    </>
                  ) : (
                    <>
                      {activeModal.variant === 'rose' ? (
                        <Trash2 size={12} />
                      ) : activeModal.variant === 'amber' ? (
                        <Route size={12} />
                      ) : (
                        <Sparkles size={12} />
                      )}
                      <span>{activeModal.buttonText}</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
