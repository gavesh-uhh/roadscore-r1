'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Code, Copy, Check } from 'lucide-react';
import { RawTelemetryRow } from './RawTelemetryTable';

interface RawPayloadDrawerProps {
  selectedRow: RawTelemetryRow | null;
  onClose: () => void;
}

export function RawPayloadDrawer({ selectedRow, onClose }: RawPayloadDrawerProps) {
  const [copied, setCopied] = React.useState(false);

  const jsonString = selectedRow ? JSON.stringify(selectedRow, null, 2) : '';

  const handleCopy = () => {
    if (!jsonString) return;
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AnimatePresence>
      {selectedRow && (
        <div className="fixed inset-0 z-50 flex justify-end font-sans text-xs overflow-hidden">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={onClose}
            className="fixed inset-0 bg-black/70 backdrop-blur-xs"
          />

          {/* Drawer Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
            className="relative z-10 w-full max-w-lg bg-zinc-950 border-l border-zinc-800 h-full p-5 flex flex-col justify-between shadow-2xl"
          >
            <div className="space-y-4 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
                <div className="flex items-center gap-2">
                  <Code size={18} className="text-emerald-400" />
                  <h3 className="text-sm font-bold text-white font-mono">
                    Packet #{selectedRow.seq} Payload
                  </h3>
                </div>
                <button
                  onClick={onClose}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>
                  Device: <strong className="text-white font-mono">{selectedRow.device_id}</strong>
                </span>
                <button
                  onClick={handleCopy}
                  className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 text-[11px] flex items-center gap-1.5 transition-colors"
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  <span>{copied ? 'Copied' : 'Copy JSON'}</span>
                </button>
              </div>

              <div className="flex-1 bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-3 overflow-y-auto font-mono text-[11px] text-emerald-300">
                <pre className="whitespace-pre-wrap break-all">{jsonString}</pre>
              </div>
            </div>

            <div className="pt-4 border-t border-zinc-900 flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Close Drawer
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
