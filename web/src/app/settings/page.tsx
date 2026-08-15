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
} from 'lucide-react';

export default function EngineSettings() {
  const [showModal, setShowModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [isPurging, setIsPurging] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handlePurge = async () => {
    setIsPurging(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/admin/purge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirmation: 'PURGE_ALL_DATA',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to clear data');
      }

      setStatusMessage({
        type: 'success',
        text: 'All driving data, trips, and scores have been reset to 0.',
      });
      setShowModal(false);
      setConfirmInput('');
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.message || 'An error occurred while clearing data',
      });
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header
        title="Settings"
        subtitle="Engine thresholds, system rules, and data management"
      />

      <div className="p-5 space-y-6 w-full">
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
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
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
              Active Rule Version: <span className="text-emerald-400 font-mono font-bold">2026.08.09-r1</span>
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

        {/* Danger Zone */}
        <div className="border border-rose-900/40 bg-zinc-950/80 rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded bg-rose-950/60 border border-rose-900/60 text-rose-400">
                <ShieldAlert size={18} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-rose-300">
                  Danger Zone
                </h3>
                <p className="text-zinc-400 text-[11px] mt-0.5">
                  Clear all driving data, trips, and scores to start testing from 0.
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setConfirmInput('');
                setShowModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-900/80 hover:bg-rose-800 text-white font-medium rounded border border-rose-700/80 transition-colors cursor-pointer text-xs"
            >
              <Trash2 size={13} />
              <span>Reset Data to 0</span>
            </button>
          </div>

          <p className="text-[11px] text-zinc-500 pt-1 border-t border-zinc-900">
            Note: Your registered devices, vehicles, and driver profiles will not be deleted.
          </p>
        </div>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => {
                if (!isPurging) {
                  setShowModal(false);
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
                <div className="p-2.5 rounded-full bg-rose-950/80 border border-rose-800/80 text-rose-400">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Reset All Driving Data?
                  </h3>
                  <p className="text-zinc-400 text-[11px] mt-0.5">
                    This will delete all trips, driving events, and scores so you can test from a clean slate.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-black rounded border border-zinc-800 space-y-2 text-xs">
                <p className="text-zinc-300">
                  Type <span className="text-rose-400 font-bold font-mono">RESET</span> to confirm:
                </p>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder="RESET"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-rose-500"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setConfirmInput('');
                  }}
                  disabled={isPurging}
                  className="px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 transition-colors text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handlePurge}
                  disabled={confirmInput.trim().toUpperCase() !== 'RESET' || isPurging}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-medium text-white transition-colors ${
                    confirmInput.trim().toUpperCase() === 'RESET' && !isPurging
                      ? 'bg-rose-600 hover:bg-rose-500 cursor-pointer'
                      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                  }`}
                >
                  {isPurging ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      <span>Resetting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={12} />
                      <span>Confirm Reset</span>
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
