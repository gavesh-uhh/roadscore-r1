'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Volume2,
  VolumeX,
  AlertTriangle,
  ShieldAlert,
  Gauge,
  Navigation,
  Activity,
  Zap,
} from 'lucide-react';

export interface RadarBlip {
  id: string;
  distanceM: number;
  angleDeg: number; // -30 to +30 relative to vehicle heading
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  type: string;
  title?: string;
}

export interface CockpitAlert {
  id: string;
  type: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  distanceM: number;
  etaS: number;
  title: string;
  advisorySpeedKmh?: number;
}

export interface CockpitHUDProps {
  speedKmh?: number;
  advisorySpeedKmh?: number | null;
  heading?: number;
  gForce?: { vertical: number; lateral: number };
  activeAlert?: CockpitAlert | null;
  radarBlips?: RadarBlip[];
  isLive?: boolean;
  timestamp?: string;
  vehicleName?: string;
  driverName?: string;
  compact?: boolean;
  className?: string;
}

export function CockpitHUD({
  speedKmh = 0,
  advisorySpeedKmh = null,
  heading = 0,
  gForce = { vertical: 1.0, lateral: 0.0 },
  activeAlert = null,
  radarBlips = [],
  isLive = false,
  timestamp,
  vehicleName,
  driverName,
  compact = false,
  className = '',
}: CockpitHUDProps) {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const lastAlertIdRef = useRef<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Play synthesized Web Audio chime on new high/critical hazard
  const playHazardChime = () => {
    if (!audioEnabled) return;
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(880, now); // A5
      osc1.frequency.exponentialRampToValueAtTime(1174.66, now + 0.12); // D6

      osc2.frequency.setValueAtTime(440, now);
      osc2.frequency.exponentialRampToValueAtTime(587.33, now + 0.12);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.36);
    } catch {
      // Ignore audio synthesis errors if user hasn't interacted
    }
  };

  useEffect(() => {
    if (activeAlert && (activeAlert.severity === 'high' || activeAlert.severity === 'critical')) {
      if (activeAlert.id !== lastAlertIdRef.current) {
        lastAlertIdRef.current = activeAlert.id;
        playHazardChime();
      }
    }
  }, [activeAlert, audioEnabled]);

  const toggleAudio = () => {
    if (!audioEnabled) {
      setAudioEnabled(true);
      // Initialize AudioContext on user gesture
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!audioCtxRef.current) audioCtxRef.current = new AudioCtx();
        if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
      } catch {}
    } else {
      setAudioEnabled(false);
    }
  };

  const isSpeedExceeded =
    advisorySpeedKmh !== null &&
    advisorySpeedKmh !== undefined &&
    speedKmh > advisorySpeedKmh;

  const severityColor =
    activeAlert?.severity === 'critical'
      ? 'border-rose-500/80 bg-rose-950/40 text-rose-200'
      : activeAlert?.severity === 'high'
      ? 'border-amber-500/80 bg-amber-950/40 text-amber-200'
      : 'border-blue-500/80 bg-blue-950/40 text-blue-200';

  return (
    <div
      className={`bg-black text-white font-mono flex flex-col rounded-lg border border-zinc-800 overflow-hidden relative select-none ${className} ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      {/* Top Cockpit Telemetry Bar */}
      <div className="flex items-center justify-between border-b border-zinc-900 pb-2.5 mb-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isLive ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'
              }`}
            />
            <span className="font-bold tracking-wider uppercase text-[11px] text-zinc-300">
              {isLive ? 'LIVE COCKPIT HUD' : 'TRIP REPLAY HUD'}
            </span>
          </div>
          {(vehicleName || driverName) && (
            <span className="text-zinc-500 text-[10px] truncate">
              {vehicleName} {driverName ? `• ${driverName}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {timestamp && (
            <span className="text-[10px] text-zinc-500 hidden sm:inline-block">
              {timestamp}
            </span>
          )}
          <button
            onClick={toggleAudio}
            title={audioEnabled ? 'Mute cab audio' : 'Enable cab hazard chimes'}
            className={`p-1.5 rounded transition-colors border ${
              audioEnabled
                ? 'bg-zinc-800 text-emerald-400 border-zinc-700'
                : 'bg-zinc-950 text-zinc-500 border-zinc-800 hover:text-zinc-300'
            }`}
          >
            {audioEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
          </button>
        </div>
      </div>

      {/* Main HUD Body */}
      <div
        className={`grid ${
          compact ? 'grid-cols-1 gap-3' : 'grid-cols-1 md:grid-cols-12 gap-4'
        } flex-1 items-stretch`}
      >
        {/* LEFT / TOP: Speedometer & Dynamic Advisory Speed */}
        <div
          className={`${
            compact ? '' : 'md:col-span-4'
          } bg-zinc-950/80 border border-zinc-900 rounded-md p-3.5 flex flex-col justify-between items-center relative overflow-hidden`}
        >
          {/* Subtle background glow when over advisory speed */}
          {isSpeedExceeded && (
            <div className="absolute inset-0 bg-rose-500/10 animate-pulse pointer-events-none" />
          )}

          <div className="w-full flex items-center justify-between text-[10px] text-zinc-500 uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Gauge size={12} className="text-zinc-400" /> Ground Speed
            </span>
            <span className="flex items-center gap-1">
              <Navigation size={11} className="text-zinc-400" /> {Math.round(heading)}°
            </span>
          </div>

          {/* Big Speed Readout */}
          <div className="my-2 text-center">
            <div className="text-4xl md:text-5xl font-extrabold tracking-tighter text-white tabular-nums flex items-baseline justify-center gap-1">
              {speedKmh.toFixed(0)}
              <span className="text-xs font-normal text-zinc-500 uppercase tracking-widest">
                km/h
              </span>
            </div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {(speedKmh * 0.621371).toFixed(0)} mph
            </div>
          </div>

          {/* Advisory Safe Speed Callout */}
          <div className="w-full mt-1">
            {advisorySpeedKmh !== null && advisorySpeedKmh !== undefined ? (
              <div
                className={`w-full py-1.5 px-2 rounded text-center border text-[10px] ${
                  isSpeedExceeded
                    ? 'bg-rose-950/60 border-rose-600 text-rose-300 animate-pulse'
                    : 'bg-emerald-950/40 border-emerald-700 text-emerald-300'
                }`}
              >
                <span className="text-[9px] uppercase tracking-wider block opacity-80">
                  {isSpeedExceeded ? '⚠️ ADVISORY EXCEEDED' : '✓ SAFE APPROACH SPEED'}
                </span>
                <span className="font-bold text-xs">
                  Limit: {advisorySpeedKmh.toFixed(0)} km/h
                </span>
              </div>
            ) : (
              <div className="w-full py-1.5 px-2 rounded text-center border border-zinc-900 bg-zinc-900/30 text-[10px] text-zinc-500">
                Road Ahead Clear
              </div>
            )}
          </div>
        </div>

        {/* CENTER: Forward Lookahead Radar Arc (Dynamic Cone) */}
        <div
          className={`${
            compact ? '' : 'md:col-span-5'
          } bg-zinc-950/80 border border-zinc-900 rounded-md p-3.5 flex flex-col justify-between items-center relative min-h-[190px]`}
        >
          <div className="w-full flex items-center justify-between text-[10px] text-zinc-500 uppercase tracking-wider">
            <span className="flex items-center gap-1">
              <Zap size={11} className="text-emerald-400" /> Forward Lookahead Cone
            </span>
            <span className="text-zinc-600 text-[9px]">200m Horizon</span>
          </div>

          {/* SVG Radar Visualizer */}
          <div className="w-full h-36 relative flex items-center justify-center my-1">
            <svg
              viewBox="-120 -150 240 160"
              className="w-full h-full max-h-36 overflow-visible"
            >
              {/* Distance Rings (50m, 100m, 150m, 200m) */}
              {[50, 100, 150, 200].map((dist, i) => {
                const r = (dist / 200) * 130;
                return (
                  <g key={dist}>
                    <path
                      d={`M ${-r * 0.7} ${-r * 0.7} A ${r} ${r} 0 0 1 ${r * 0.7} ${-r * 0.7}`}
                      fill="none"
                      stroke="#27272a"
                      strokeWidth="1"
                      strokeDasharray={i === 3 ? 'none' : '3,3'}
                    />
                    <text
                      x={r * 0.72}
                      y={-r * 0.7}
                      fill="#71717a"
                      fontSize="7"
                      fontFamily="monospace"
                    >
                      {dist}m
                    </text>
                  </g>
                );
              })}

              {/* Lookahead Cone Sector (Dynamic widening cone ±10° at 50m to ±25° at 200m) */}
              <polygon
                points="0,0 -55,-130 55,-130"
                fill="rgba(16, 185, 129, 0.06)"
                stroke="rgba(16, 185, 129, 0.3)"
                strokeWidth="1"
                strokeDasharray="4,2"
              />

              {/* Central Heading Axis */}
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="-135"
                stroke="rgba(16, 185, 129, 0.5)"
                strokeWidth="1"
              />

              {/* Vehicle Origin Marker */}
              <polygon points="0,-8 -6,6 0,2 6,6" fill="#10b981" />

              {/* Radar Blips (Incoming Hazards / Potholes) */}
              {radarBlips.map((blip) => {
                // Map distance (0..200m) and angle (-30..+30 deg) to radar SVG coords
                const r = Math.min(130, Math.max(15, (blip.distanceM / 200) * 130));
                const rad = ((blip.angleDeg - 90) * Math.PI) / 180;
                const bx = r * Math.cos(rad);
                const by = r * Math.sin(rad);

                const color =
                  blip.severity === 'critical'
                    ? '#f43f5e'
                    : blip.severity === 'high'
                    ? '#f59e0b'
                    : '#38bdf8';

                return (
                  <g key={blip.id}>
                    {/* Pulsing ring around critical hazards */}
                    <circle
                      cx={bx}
                      cy={by}
                      r="7"
                      fill="none"
                      stroke={color}
                      strokeWidth="1.5"
                      className="animate-ping"
                      opacity="0.6"
                    />
                    <circle cx={bx} cy={by} r="4" fill={color} />
                    <text
                      x={bx + 6}
                      y={by + 3}
                      fill={color}
                      fontSize="8"
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      {blip.distanceM.toFixed(0)}m
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="w-full flex items-center justify-between text-[9px] text-zinc-500">
            <span>Left -25°</span>
            <span className="text-emerald-400">Heading 0°</span>
            <span>Right +25°</span>
          </div>
        </div>

        {/* RIGHT / BOTTOM: G-Force & Active Warning Status */}
        <div
          className={`${
            compact ? '' : 'md:col-span-3'
          } flex flex-col gap-2.5 justify-between`}
        >
          {/* Active Hazard Warning Badge */}
          {activeAlert ? (
            <div
              className={`p-3 rounded-md border flex-1 flex flex-col justify-between ${severityColor}`}
            >
              <div className="flex items-start justify-between gap-1">
                <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider">
                  <AlertTriangle size={14} className="shrink-0 animate-bounce" />
                  <span className="truncate">{activeAlert.title}</span>
                </div>
                <span className="text-[9px] px-1 py-0.5 rounded bg-black/50 border border-current font-bold uppercase">
                  {activeAlert.severity}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 my-2 text-xs">
                <div className="bg-black/40 rounded p-1.5 border border-white/10">
                  <span className="text-[9px] opacity-70 block uppercase">Distance</span>
                  <span className="font-extrabold text-white text-sm">
                    {activeAlert.distanceM.toFixed(0)} m
                  </span>
                </div>
                <div className="bg-black/40 rounded p-1.5 border border-white/10">
                  <span className="text-[9px] opacity-70 block uppercase">ETA</span>
                  <span className="font-extrabold text-white text-sm">
                    {activeAlert.etaS.toFixed(1)} s
                  </span>
                </div>
              </div>

              {/* Warning Progress Bar */}
              <div className="w-full bg-black/60 rounded-full h-1.5 overflow-hidden border border-white/10">
                <div
                  className="bg-current h-full transition-all duration-300"
                  style={{
                    width: `${Math.max(
                      10,
                      Math.min(100, 100 - (activeAlert.distanceM / 200) * 100)
                    )}%`,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-md border border-zinc-900 bg-zinc-950/80 flex-1 flex flex-col items-center justify-center text-zinc-500 text-center text-xs">
              <ShieldAlert size={20} className="mb-1 text-zinc-700" />
              <span className="text-[11px] font-semibold text-zinc-400">
                No Hazards in Cone
              </span>
              <span className="text-[9px] text-zinc-600 mt-0.5">
                Path clear for 200 meters
              </span>
            </div>
          )}

          {/* G-Force Telemetry Card */}
          <div className="bg-zinc-950/80 border border-zinc-900 rounded-md p-2.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <Activity size={12} className="text-zinc-500" />
              <span className="text-[10px] uppercase">G-Force</span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <div>
                <span className="text-zinc-500 text-[9px] mr-1">V:</span>
                <span
                  className={
                    Math.abs(gForce.vertical - 1.0) > 0.4
                      ? 'text-rose-400 font-bold'
                      : 'text-zinc-200'
                  }
                >
                  {gForce.vertical.toFixed(2)}g
                </span>
              </div>
              <div>
                <span className="text-zinc-500 text-[9px] mr-1">L:</span>
                <span
                  className={
                    Math.abs(gForce.lateral) > 0.25
                      ? 'text-amber-400 font-bold'
                      : 'text-zinc-200'
                  }
                >
                  {gForce.lateral >= 0 ? `+${gForce.lateral.toFixed(2)}` : gForce.lateral.toFixed(2)}g
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
