'use client';

/**
 * SimulationStudioDrawer — presenter control panel (DRIVER_VIEW_PLAN §5,
 * UI_POLISH §4.5, V2 §3.6)
 *
 * Collapsible bottom sheet with 1-click scenario triggers. V2/UI upgrades:
 *  - Auto-closes 350 ms after any trigger so the cockpit reaction (radar
 *    marker, orb, banner) is immediately visible — fixes "clicked Pothole
 *    and nothing appeared" (the sheet was covering the view).
 *  - Drag-to-dismiss + scrim tap-to-close.
 *  - Auto-Drive scripted demo toggle (hands-free end-to-end demo).
 *  - Haptics toggle (Tier-1 alerts vibrate on supported phones).
 */

import { useRef } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import {
  FlaskConical,
  ChevronDown,
  Gauge,
  ShieldCheck,
  Leaf,
  Moon,
  AlertTriangle,
  CornerUpRight,
  Waves,
  CircleDot,
  Play,
  Square,
  Vibrate,
} from 'lucide-react';

export interface SimulationStudioDrawerProps {
  open: boolean;
  onClose: () => void;
  speedKmh: number;
  onSpeedChange: (kmh: number) => void;
  onTriggerPothole: () => void;
  onTriggerSpeedBump: () => void;
  onTriggerSharpCurve: () => void;
  onTriggerWaterPooling: () => void;
  onSlamBrakes: () => void;
  onTriggerEcoGlide: () => void;
  hudMode: boolean;
  onToggleHud: () => void;
  liveActive: boolean;
  autoDrive: boolean;
  onToggleAutoDrive: () => void;
  hapticsOn: boolean;
  onToggleHaptics: () => void;
}

function TriggerButton({
  icon,
  label,
  sub,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
  accent: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-[52px] items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-left hover:border-zinc-600 hover:bg-zinc-900 active:scale-[0.98] ${accent}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold text-white truncate">{label}</span>
        <span className="block text-[10px] text-zinc-500 truncate">{sub}</span>
      </span>
    </button>
  );
}

export function SimulationStudioDrawer(props: SimulationStudioDrawerProps) {
  const {
    open,
    onClose,
    speedKmh,
    onSpeedChange,
    hudMode,
    onToggleHud,
    liveActive,
    autoDrive,
    onToggleAutoDrive,
    hapticsOn,
    onToggleHaptics,
  } = props;

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Fire the scenario, then auto-dismiss the sheet so the presenter (and
   * audience) instantly sees the cockpit react.
   */
  const fireAndClose = (fn: () => void) => () => {
    fn();
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(onClose, 350);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 500) onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/50"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md touch-none"
          >
            <div className="rounded-t-2xl border border-zinc-800 border-b-0 bg-zinc-950/95 backdrop-blur-xl shadow-2xl shadow-black/80">
              {/* Grab handle / header */}
              <button
                onClick={onClose}
                className="w-full flex flex-col items-center pt-2 pb-1.5 text-zinc-500 hover:text-zinc-300"
                aria-label="Close Simulation Studio"
              >
                <span className="h-1 w-9 rounded-full bg-zinc-700" />
                <span className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
                  <FlaskConical size={12} className="text-violet-400" />
                  Simulation Studio
                  <ChevronDown size={12} />
                </span>
              </button>

              <div className="px-4 pb-5">
                {/* Auto-Drive toggle — the hands-free demo (V2 §3.6) */}
                <button
                  onClick={onToggleAutoDrive}
                  disabled={liveActive}
                  className={`mb-3 flex w-full min-h-[52px] items-center justify-center gap-2 rounded-lg border py-3 text-xs font-extrabold uppercase tracking-widest disabled:opacity-40 ${
                    autoDrive
                      ? 'border-rose-500/60 bg-rose-950/40 text-rose-200'
                      : 'border-emerald-600/60 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-950/70'
                  }`}
                >
                  {autoDrive ? <Square size={14} /> : <Play size={14} />}
                  {autoDrive ? 'Stop Auto-Drive Demo' : 'Launch Auto-Drive Demo'}
                </button>

                {/* Speed slider */}
                <div className="rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 mb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      <Gauge size={12} />
                      Speed
                      {liveActive && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40 font-bold">
                          LIVE OVERRIDE
                        </span>
                      )}
                      {!liveActive && autoDrive && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 font-bold">
                          AUTO
                        </span>
                      )}
                    </span>
                    <span className="text-sm font-extrabold text-white tabular-nums">
                      {Math.round(speedKmh)}
                      <span className="text-[10px] font-semibold text-zinc-500 ml-1">km/h</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={120}
                    step={1}
                    value={Math.round(speedKmh)}
                    disabled={liveActive || autoDrive}
                    onChange={(e) => onSpeedChange(Number(e.target.value))}
                    className="w-full accent-emerald-500 disabled:opacity-40"
                    aria-label="Simulated speed"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-600 font-semibold">
                    <span>0</span>
                    <span>60</span>
                    <span>120 km/h</span>
                  </div>
                </div>


                {/* 1-click triggers (auto-close so the cockpit is visible) */}
                <div className="grid grid-cols-2 gap-2">
                  <TriggerButton
                    icon={<CircleDot size={16} className="text-rose-400" />}
                    label="Pothole (60m)"
                    sub="Tier-1 voice + horizon marker"
                    onClick={fireAndClose(props.onTriggerPothole)}
                    accent=""
                  />
                  <TriggerButton
                    icon={<AlertTriangle size={16} className="text-amber-400" />}
                    label="Speed Bump (40m)"
                    sub="Target 20 km/h prompt"
                    onClick={fireAndClose(props.onTriggerSpeedBump)}
                    accent=""
                  />
                  <TriggerButton
                    icon={<CornerUpRight size={16} className="text-violet-400" />}
                    label="Hairpin (180m)"
                    sub="Advised 35 km/h prompt"
                    onClick={fireAndClose(props.onTriggerSharpCurve)}
                    accent=""
                  />
                  <TriggerButton
                    icon={<Waves size={16} className="text-sky-400" />}
                    label="Water Pooling (120m)"
                    sub="Reduced grip advisory"
                    onClick={fireAndClose(props.onTriggerWaterPooling)}
                    accent=""
                  />
                  <TriggerButton
                    icon={<ShieldCheck size={16} className="text-emerald-400" />}
                    label="Slam Brakes & Exonerate"
                    sub="−4.5 m/s² → Shield +0 pts"
                    onClick={fireAndClose(props.onSlamBrakes)}
                    accent="border-emerald-800/60 bg-emerald-950/30 hover:border-emerald-600"
                  />
                  <TriggerButton
                    icon={<Leaf size={16} className="text-emerald-400" />}
                    label="Eco-Glide Tip"
                    sub="Coast-to-queue coaching"
                    onClick={fireAndClose(props.onTriggerEcoGlide)}
                    accent=""
                  />
                </div>

                {/* Toggles row */}
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <TriggerButton
                    icon={<Moon size={16} className="text-indigo-300" />}
                    label="Windshield HUD"
                    sub={hudMode ? 'Exit mirror mode' : 'Mirror + OLED black'}
                    onClick={onToggleHud}
                    accent={hudMode ? 'border-indigo-500/60 bg-indigo-950/40' : ''}
                  />
                  <TriggerButton
                    icon={<Vibrate size={16} className="text-zinc-300" />}
                    label="Haptics"
                    sub={hapticsOn ? 'Vibrate on alerts: ON' : 'Vibrate on alerts: OFF'}
                    onClick={onToggleHaptics}
                    accent={hapticsOn ? 'border-zinc-600 bg-zinc-900' : ''}
                  />
                </div>

                <p className="mt-3 text-center text-[10px] text-zinc-600">
                  Demo controls inject scenarios into the cockpit pipeline — no vehicle required.
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

