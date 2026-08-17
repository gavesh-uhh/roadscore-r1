'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertOctagon,
  PhoneCall,
  XCircle,
  MapPin,
  Activity,
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
          className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/95 backdrop-blur-3xl px-4 select-none"
        >
          {/* Animated pulsing red perimeter alert */}
          <div className="pointer-events-none absolute inset-0 border-4 sm:border-8 border-rose-600/80 animate-pulse shadow-[inset_0_0_80px_rgba(244,63,94,0.4)]" />

          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="relative w-full max-w-md rounded-3xl border-2 border-rose-500/80 bg-zinc-950/95 p-5 sm:p-7 text-center shadow-[0_0_80px_rgba(244,63,94,0.35)]"
          >
            {!dispatched ? (
              <>
                {/* Emergency Header */}
                <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-rose-500/30 animate-ping" />
                  <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-600/20 border border-rose-500/60 shadow-[0_0_20px_rgba(244,63,94,0.5)]">
                    <AlertOctagon size={32} className="text-rose-500 animate-pulse" />
                  </span>
                </div>

                <div className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-950/60 px-3 py-1 text-[10px] font-mono font-black uppercase tracking-wider text-rose-300">
                  <Radio size={12} className="animate-pulse text-rose-400" />
                  Severe Impact Detected · eCall SOS
                </div>

                <h1 className="mt-2.5 text-2xl sm:text-3xl font-black uppercase tracking-tight text-white">
                  Contacting 911
                </h1>
                <p className="mt-1 text-xs font-semibold text-rose-200">
                  Automated emergency response dispatches in:
                </p>

                {/* Big Countdown Timer Dial */}
                <div className="relative my-4 flex items-center justify-center">
                  <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-rose-500/40 bg-rose-950/50 shadow-[0_0_30px_rgba(244,63,94,0.3)]">
                    <span className="text-4xl font-mono font-black tracking-tight text-rose-400">
                      {countdown}
                    </span>
                    <span className="text-xs font-mono font-bold text-rose-400 ml-0.5">s</span>
                  </div>
                </div>

                {/* Live Telemetry & GPS Badge */}
                <div className="mb-5 rounded-2xl border border-zinc-800 bg-zinc-900/80 p-3 text-left">
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-300">
                    <div className="flex items-center gap-1.5 text-rose-400 font-bold">
                      <MapPin size={13} />
                      <span>GPS Coordinates</span>
                    </div>
                    <span className="font-bold text-white">
                      {lat.toFixed(5)}, {lon.toFixed(5)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-zinc-400 border-t border-zinc-800/80 pt-1.5">
                    <div className="flex items-center gap-1">
                      <Activity size={11} className="text-rose-400" />
                      <span>Impact: {impactG.toFixed(1)}g</span>
                    </div>
                    <span>Speed: {Math.round(speedBeforeImpactKmh)} km/h</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <button
                    onClick={() => triggerDispatch(true)}
                    className="flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3.5 text-xs font-mono font-black uppercase tracking-wider text-white shadow-[0_0_25px_rgba(244,63,94,0.6)] hover:bg-rose-500 active:scale-95 transition-all"
                  >
                    <PhoneCall size={16} />
                    <span>Call 911 Now</span>
                  </button>

                  <button
                    onClick={handleCancel}
                    className="flex items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3.5 text-xs font-mono font-bold uppercase tracking-wider text-zinc-300 hover:bg-zinc-800 hover:text-white active:scale-95 transition-all"
                  >
                    <XCircle size={16} />
                    <span>I Am OK (Cancel)</span>
                  </button>
                </div>
              </>
            ) : (
              /* Dispatched Confirmation State */
              <>
                <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center">
                  <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 border border-emerald-500/60 shadow-[0_0_25px_rgba(16,185,129,0.5)]">
                    <Ambulance size={32} className="text-emerald-400" />
                  </span>
                </div>

                <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/60 px-3 py-1 text-[10px] font-mono font-black uppercase tracking-wider text-emerald-300">
                  <CheckCircle2 size={12} className="text-emerald-400" />
                  911 & EMS Units Dispatched
                </div>

                <h1 className="mt-3 text-2xl font-black uppercase tracking-tight text-white">
                  Help Is On The Way
                </h1>
                <p className="mt-1 text-xs font-semibold text-zinc-300">
                  Emergency responders have your exact live location.
                </p>

                <div className="my-4 rounded-2xl border border-emerald-800/60 bg-emerald-950/30 p-3.5 text-left">
                  <div className="flex items-center justify-between text-xs font-mono text-emerald-300 font-bold">
                    <span>Assigned Unit: EMS-PARAMEDIC-09</span>
                    <span>ETA ~{etaMinutes} min</span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-400 leading-relaxed">
                    Stay inside the vehicle if safe. Keep phone lines clear. First responders are en route.
                  </p>
                </div>

                <button
                  onClick={handleCancel}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 px-4 py-3 text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 hover:bg-zinc-800 hover:text-white transition-all"
                >
                  <XCircle size={15} />
                  <span>Dismiss Emergency Screen</span>
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
