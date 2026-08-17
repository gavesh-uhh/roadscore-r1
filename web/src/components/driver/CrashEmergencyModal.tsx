'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertOctagon,
  PhoneCall,
  X,
  MapPin,
  Ambulance,
  CheckCircle2,
  Radio,
} from 'lucide-react';
import { emergencyAudio } from '@/lib/audio/emergencyAudio';

export interface CrashEmergencyModalProps {
  open: boolean;
  lat: number;
  lon: number;
  speedBeforeImpactKmh?: number;
  impactG?: number;
  deviceId?: string;
  tripId?: string | null;
  onClose: () => void;
  onDispatched?: (dispatchId: string) => void;
}

export function CrashEmergencyModal({
  open,
  lat,
  lon,
  speedBeforeImpactKmh = 62,
  impactG = 6.8,
  deviceId = 'RS-DEV-DEMO',
  tripId = null,
  onClose,
  onDispatched,
}: CrashEmergencyModalProps) {
  const [countdown, setCountdown] = useState<number>(10);
  const [dispatched, setDispatched] = useState<boolean>(false);
  const [dispatchId, setDispatchId] = useState<string | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number>(4);

  // Trigger dispatch call
  const triggerDispatch = useCallback(
    async (manual: boolean = false) => {
      try {
        const res = await fetch('/api/emergency/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId,
            tripId,
            lat,
            lon,
            speedBeforeImpactKmh,
            impactG,
            status: 'confirmed_dispatch',
          }),
        });
        const data = await res.json();
        if (data.success && data.dispatch) {
          setDispatchId(data.dispatch.id);
          if (data.dispatch.etaMinutes) setEtaMinutes(data.dispatch.etaMinutes);
          onDispatched?.(data.dispatch.id);
        }
      } catch (e) {
        console.error('Failed to trigger emergency dispatch:', e);
      } finally {
        setDispatched(true);
        emergencyAudio.stopSiren();
        emergencyAudio.speakEmergency(
          manual
            ? 'Emergency services have been notified. Paramedics dispatched to your coordinates.'
            : 'Countdown expired. Emergency services and 911 dispatched to your location.'
        );
      }
    },
    [deviceId, tripId, lat, lon, speedBeforeImpactKmh, impactG, onDispatched]
  );

  // Handle cancel (False alarm / I'm OK)
  const handleCancel = useCallback(async () => {
    emergencyAudio.stopSiren();
    emergencyAudio.speakEmergency('Emergency dispatch cancelled.');
    try {
      if (dispatchId) {
        await fetch('/api/emergency/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: dispatchId,
            deviceId,
            status: 'cancelled_by_driver',
          }),
        });
      }
    } catch (e) {
      console.error('Failed to cancel emergency dispatch:', e);
    }
    setDispatched(false);
    onClose();
  }, [dispatchId, deviceId, onClose]);

  // Lifecycle when modal opens
  useEffect(() => {
    if (!open) {
      emergencyAudio.stopSiren();
      setCountdown(10);
      setDispatched(false);
      return;
    }

    setCountdown(10);
    setDispatched(false);

    // Start siren and audio warning
    emergencyAudio.startSiren();
    emergencyAudio.speakEmergency(
      'Severe collision detected. Contacting emergency services in 10 seconds. Press cancel if you are okay.'
    );

    // Initial pre-alert to API
    fetch('/api/emergency/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        tripId,
        lat,
        lon,
        speedBeforeImpactKmh,
        impactG,
        status: 'pre_alert',
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.dispatch?.id) setDispatchId(d.dispatch.id);
      })
      .catch(() => {});

    // Countdown interval
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          triggerDispatch(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
      emergencyAudio.stopSiren();
    };
  }, [open, deviceId, tripId, lat, lon, speedBeforeImpactKmh, impactG, triggerDispatch]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/90 backdrop-blur-2xl p-3 sm:p-4 select-none pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          {/* Subtle perimeter alert glow */}
          <div className="pointer-events-none absolute inset-0 border-2 sm:border-4 border-rose-600/70 animate-pulse shadow-[inset_0_0_60px_rgba(244,63,94,0.3)]" />

          <motion.div
            initial={{ scale: 0.94, y: 14 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 14 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className="relative w-full max-w-[340px] sm:max-w-sm rounded-2xl border border-rose-500/80 bg-zinc-950/95 p-4 sm:p-5 text-center shadow-2xl shadow-black overflow-hidden"
          >
            {!dispatched ? (
              <>
                {/* Compact Header: Integrated Warning Icon & Live Countdown Pill */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-600/20 border border-rose-500/60 shadow-[0_0_12px_rgba(244,63,94,0.4)]">
                      <AlertOctagon size={18} className="text-rose-500 animate-pulse" />
                    </span>
                    <div className="text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                        </span>
                        <span className="text-[10px] font-mono font-black uppercase tracking-wider text-rose-300">
                          Severe Impact
                        </span>
                      </div>
                      <h2 className="text-sm font-black uppercase tracking-tight text-white">
                        Contacting 911
                      </h2>
                    </div>
                  </div>

                  {/* 10s Countdown Badge */}
                  <div className="flex items-center justify-center rounded-xl border border-rose-500/50 bg-rose-950/70 px-2.5 py-1 shadow-inner">
                    <span className="text-lg font-mono font-black text-rose-400 tabular-nums">
                      {countdown}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-rose-400/80 ml-0.5">s</span>
                  </div>
                </div>

                {/* 1-Line Minimal GPS & Impact Chip */}
                <div className="my-3 flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 text-[10px] font-mono">
                  <div className="flex items-center gap-1 text-zinc-300">
                    <MapPin size={11} className="text-rose-400 shrink-0" />
                    <span className="truncate">
                      {lat.toFixed(4)}, {lon.toFixed(4)}
                    </span>
                  </div>
                  <span className="shrink-0 text-zinc-400 border-l border-zinc-700/80 pl-2">
                    {impactG.toFixed(1)}g · {Math.round(speedBeforeImpactKmh)} km/h
                  </span>
                </div>

                {/* Side-by-Side Touch Buttons */}
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    onClick={() => triggerDispatch(true)}
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3 py-2.5 text-[11px] font-mono font-black uppercase tracking-wider text-white shadow-lg shadow-rose-900/50 hover:bg-rose-500 active:scale-95 transition-all"
                  >
                    <PhoneCall size={13} />
                    <span>Call 911</span>
                  </button>

                  <button
                    onClick={handleCancel}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-900/90 px-3 py-2.5 text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 hover:text-white active:scale-95 transition-all"
                  >
                    <X size={13} />
                    <span>I Am OK</span>
                  </button>
                </div>
              </>
            ) : (
              /* Dispatched Confirmation State (Compact) */
              <>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.4)]">
                    <Ambulance size={18} className="text-emerald-400" />
                  </span>
                  <div className="text-left">
                    <span className="text-[10px] font-mono font-black uppercase tracking-wider text-emerald-300 flex items-center gap-1">
                      <CheckCircle2 size={11} />
                      911 Dispatched
                    </span>
                    <h2 className="text-sm font-black uppercase tracking-tight text-white">
                      Help Is On The Way
                    </h2>
                  </div>
                </div>

                <div className="my-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-2.5 text-left text-[10.5px] font-mono">
                  <div className="flex items-center justify-between text-emerald-300 font-bold">
                    <span>Unit: EMS-PARAMEDIC-09</span>
                    <span>ETA ~{etaMinutes}m</span>
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-400 leading-normal">
                    First responders have your live location. Stay inside the vehicle if safe.
                  </p>
                </div>

                <button
                  onClick={handleCancel}
                  className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-[10.5px] font-mono font-bold uppercase tracking-wider text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all"
                >
                  <X size={12} />
                  <span>Dismiss</span>
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
