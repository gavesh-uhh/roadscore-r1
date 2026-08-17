'use client';

/**
 * DevicePairModal — zero-friction pairing (DRIVER_VIEW_PLAN §2, item 1)
 *
 * Pairs the cockpit with a vehicle's RoadScore ESP32 unit:
 *  - Auto-pairs instantly when the page is opened via a QR-encoded URL
 *    (`/driver?device=rs-device-01`) — handled by the page.
 *  - Live QR scanning via the built-in BarcodeDetector API when available
 *    (Chrome / Android), with graceful fallback to manual device ID entry.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { QrCode, X, Video, VideoOff, Loader2 } from 'lucide-react';
import { VehicleOrbSelector, type VehicleOrbUnit } from './VehicleOrbSelector';

export interface DevicePairModalProps {
  open: boolean;
  currentDevice: string | null;
  units?: VehicleOrbUnit[];
  onPair: (deviceId: string) => void;
  onClose: () => void;
}

/** Extract a device id from scanned text — accepts raw ids or pairing URLs. */
export function extractDeviceId(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    const param = url.searchParams.get('device');
    if (param) return param;
  } catch {
    // Not a URL — treat as a raw device id.
  }
  return /^[\w:-]{3,64}$/.test(text) ? text : null;
}

export function DevicePairModal({
  open,
  currentDevice,
  units = [],
  onPair,
  onClose,
}: DevicePairModalProps) {
  const [manualId, setManualId] = useState(currentDevice ?? '');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  const supportsQr =
    typeof window !== 'undefined' && 'BarcodeDetector' in (window as unknown as object);

  const stopScan = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  // Every close path funnels through here so the camera never leaks.
  const handleClose = () => {
    stopScan();
    onClose();
  };

  // Camera teardown on unmount (refs only — no state updates).
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    },
    [],
  );

  const startScan = async () => {
    setScanError(null);
    try {
      const Detector = (
        window as unknown as {
          BarcodeDetector?: new (opts?: { formats?: string[] }) => {
            detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
          };
        }
      ).BarcodeDetector;
      if (!Detector) {
        setScanError('QR scanning is not supported in this browser — enter the device ID manually.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setScanning(true);

      // Wait a beat for the <video> element to mount.
      await new Promise((r) => setTimeout(r, 60));
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const detector = new Detector({ formats: ['qr_code'] });
      const loop = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            const id = extractDeviceId(codes[0].rawValue);
            if (id) {
              stopScan();
              onPair(id);
              return;
            }
          }
        } catch {
          // Detection hiccup — keep scanning.
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch {
      setScanError('Camera access denied. Allow camera permission or enter the device ID manually.');
      stopScan();
    }
  };

  const submitManual = () => {
    const id = extractDeviceId(manualId);
    if (id) onPair(id);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                <QrCode size={16} className="text-emerald-400" />
                Pair Vehicle Unit
              </h2>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-md text-zinc-500 hover:text-white hover:bg-zinc-900"
                aria-label="Close pairing"
              >
                <X size={14} />
              </button>
            </div>

            {units && units.length > 0 && (
              <div className="mb-4">
                <VehicleOrbSelector
                  units={units}
                  selectedDeviceId={currentDevice}
                  onSelect={(dId) => {
                    onPair(dId);
                    handleClose();
                  }}
                />
              </div>
            )}

            {scanning ? (
              <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-black aspect-square mb-3">
                <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
                <div className="absolute inset-6 border-2 border-emerald-500/60 rounded-lg pointer-events-none" />
                <button
                  onClick={stopScan}
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/80 border border-zinc-700 px-3 py-1.5 text-[10px] font-semibold text-white"
                >
                  <VideoOff size={11} />
                  Stop Scan
                </button>
              </div>
            ) : (
              <button
                onClick={startScan}
                disabled={!supportsQr}
                className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-emerald-950/30 py-3 text-[11px] font-bold text-emerald-300 hover:bg-emerald-950/60 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Video size={14} />
                {supportsQr ? 'Scan Pairing QR Code' : 'QR Scan Unsupported Here'}
              </button>
            )}

            {scanError && (
              <p className="mb-3 rounded-md border border-amber-800/50 bg-amber-950/40 px-2.5 py-2 text-[10px] text-amber-300">
                {scanError}
              </p>
            )}

            <div className="flex items-center gap-2">
              <input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitManual()}
                placeholder="rs-device-01"
                className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-black px-3 py-2.5 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-emerald-600"
                aria-label="Device ID"
              />
              <button
                onClick={submitManual}
                disabled={!extractDeviceId(manualId)}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-black hover:bg-emerald-400 disabled:opacity-40"
              >
                Pair
              </button>
            </div>

            <p className="mt-3 flex items-center gap-1.5 text-[9px] text-zinc-600">
              <Loader2 size={10} className="shrink-0" />
              Tip: open this page as /driver?device=rs-device-01 to pair instantly.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

