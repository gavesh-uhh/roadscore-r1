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
      className={`flex min-h-[46px] sm:min-h-[50px] items-center gap-2 rounded-xl border border-zinc-800/90 bg-zinc-950/80 px-2.5 sm:px-3 py-2 text-left hover:border-zinc-600 hover:bg-zinc-900 active:scale-[0.98] transition-all ${accent}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10.5px] sm:text-[11px] font-semibold text-white truncate leading-tight">
          {label}
        </span>
        <span className="block text-[9.5px] sm:text-[10px] text-zinc-400 truncate leading-tight mt-0.5">
          {sub}
        </span>
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
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 32 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={onDragEnd}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-lg"
          >
            <div className="flex max-h-[85vh] sm:max-h-[88vh] flex-col rounded-t-3xl border border-zinc-800/90 border-b-0 bg-zinc-950/95 backdrop-blur-2xl shadow-2xl shadow-black">
              {/* Grab handle / header */}
              <button
                onClick={onClose}
                className="shrink-0 w-full flex flex-col items-center pt-2.5 pb-2 text-zinc-500 hover:text-zinc-300 transition-colors"
                aria-label="Close Simulation Studio"
              >
                <span className="h-1 w-10 rounded-full bg-zinc-700" />
                <span className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
                  <FlaskConical size={13} className="text-violet-400" />
                  Simulation Studio
                  <ChevronDown size={13} />
                </span>
              </button>

              {/* Scrollable drawer body */}
              <div className="flex-1 overflow-y-auto overscroll-contain px-3.5 sm:px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1">
                {/* Auto-Drive toggle — the hands-free demo */}
                <button
                  onClick={onToggleAutoDrive}
                  disabled={liveActive}
                  className={`mb-2.5 flex w-full min-h-[44px] sm:min-h-[48px] items-center justify-center gap-2 rounded-xl border py-2.5 px-3 text-[11px] sm:text-xs font-black uppercase tracking-wider disabled:opacity-40 transition-all ${
                    autoDrive
                      ? 'border-rose-500/60 bg-rose-950/50 text-rose-200 shadow-[0_0_15px_rgba(244,63,94,0.2)]'
                      : 'border-emerald-500/50 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-950/70 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                  }`}
                >
                  {autoDrive ? <Square size={13} /> : <Play size={13} />}
                  {autoDrive ? 'Stop Auto-Drive Demo' : 'Launch Auto-Drive Demo'}
                </button>

                {/* Speed slider */}
                <div className="rounded-xl border border-zinc-800/80 bg-black/60 px-3 py-2 sm:py-2.5 mb-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      <Gauge size={12} />
                      Speed
                      {liveActive && (
                        <span className="text-[8.5px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                          LIVE
                        </span>
                      )}
                      {!liveActive && autoDrive && (
                        <span className="text-[8.5px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                          AUTO
                        </span>
                      )}
                    </span>
                    <span className="text-xs sm:text-sm font-black text-white tabular-nums">
                      {Math.round(speedKmh)}
                      <span className="text-[9.5px] font-semibold text-zinc-500 ml-1">km/h</span>
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
                    className="w-full accent-emerald-500 disabled:opacity-40 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                    aria-label="Simulated speed"
                  />
                  <div className="flex justify-between text-[9px] text-zinc-600 font-semibold mt-0.5">
                    <span>0</span>
                    <span>60</span>
                    <span>120 km/h</span>
                  </div>
                </div>

                {/* 1-click triggers */}
                <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                  <TriggerButton
                    icon={<CircleDot size={15} className="text-rose-400" />}
                    label="Pothole (60m)"
                    sub="Tier-1 voice + marker"
                    onClick={fireAndClose(props.onTriggerPothole)}
                    accent=""
                  />
                  <TriggerButton
                    icon={<AlertTriangle size={15} className="text-amber-400" />}
                    label="Speed Bump (40m)"
                    sub="Target 20 km/h prompt"
                    onClick={fireAndClose(props.onTriggerSpeedBump)}
                    accent=""
                  />
                  <TriggerButton
                    icon={<CornerUpRight size={15} className="text-violet-400" />}
                    label="Hairpin (180m)"
                    sub="Advised 35 km/h"
                    onClick={fireAndClose(props.onTriggerSharpCurve)}
                    accent=""
                  />
                  <TriggerButton
                    icon={<Waves size={15} className="text-sky-400" />}
                    label="Water Pooling (120m)"
                    sub="Reduced grip alert"
                    onClick={fireAndClose(props.onTriggerWaterPooling)}
                    accent=""
                  />
                  <TriggerButton
                    icon={<ShieldCheck size={15} className="text-emerald-400" />}
                    label="Slam & Exonerate"
                    sub="−4.5 m/s² → +0 pts"
                    onClick={fireAndClose(props.onSlamBrakes)}
                    accent="border-emerald-800/60 bg-emerald-950/40 hover:border-emerald-500"
                  />
                  <TriggerButton
                    icon={<Leaf size={15} className="text-emerald-400" />}
                    label="Eco-Glide Tip"
                    sub="Coast-to-queue coaching"
                    onClick={fireAndClose(props.onTriggerEcoGlide)}
                    accent=""
                  />
                </div>

                {/* Toggles row */}
                <div className="mt-1.5 sm:mt-2 grid grid-cols-2 gap-1.5 sm:gap-2">
                  <TriggerButton
                    icon={<Moon size={15} className="text-indigo-300" />}
                    label="Windshield HUD"
                    sub={hudMode ? 'Exit mirror mode' : 'Mirror + OLED black'}
                    onClick={onToggleHud}
                    accent={hudMode ? 'border-indigo-500/60 bg-indigo-950/50' : ''}
                  />
                  <TriggerButton
                    icon={<Vibrate size={15} className="text-zinc-300" />}
                    label="Haptics"
                    sub={hapticsOn ? 'Vibrate alerts: ON' : 'Vibrate alerts: OFF'}
                    onClick={onToggleHaptics}
                    accent={hapticsOn ? 'border-zinc-600 bg-zinc-900' : ''}
                  />
                </div>

                <p className="mt-2.5 text-center text-[9.5px] text-zinc-600">
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

