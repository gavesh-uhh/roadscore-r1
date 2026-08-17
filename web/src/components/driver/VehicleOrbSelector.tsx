'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Car, Check, Radio } from 'lucide-react';

export interface VehicleOrbUnit {
  deviceId: string;
  driverName: string;
  vehiclePlate: string;
  color: string;
  speedKmh?: number;
  isLive?: boolean;
}

export interface VehicleOrbSelectorProps {
  units: VehicleOrbUnit[];
  selectedDeviceId: string | null;
  onSelect: (deviceId: string) => void;
  className?: string;
}

export function VehicleOrbSelector({
  units,
  selectedDeviceId,
  onSelect,
  className = '',
}: VehicleOrbSelectorProps) {
  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between mb-3 text-[11px] font-mono uppercase tracking-wider text-zinc-400">
        <span className="flex items-center gap-1.5 font-bold text-white">
          <Car size={13} className="text-emerald-400" />
          Select Hardware / Vehicle
        </span>
        <span className="text-zinc-500 text-[10px]">
          {units.length} Units Online
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {units.map((unit) => {
          const isSelected = selectedDeviceId === unit.deviceId;
          const color = unit.color || '#10b981';

          return (
            <motion.button
              key={unit.deviceId}
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => onSelect(unit.deviceId)}
              className={`relative flex flex-col items-center p-3.5 rounded-2xl border transition-all text-left overflow-hidden cursor-pointer select-none group ${
                isSelected
                  ? 'bg-zinc-900/90 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)] ring-1 ring-emerald-400/50'
                  : 'bg-zinc-950/80 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/40'
              }`}
            >
              {/* Selected Checkmark Badge */}
              {isSelected && (
                <div
                  className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-black font-bold shadow-md z-10"
                  style={{ backgroundColor: color }}
                >
                  <Check size={12} strokeWidth={3} />
                </div>
              )}

              {/* ===== 3D GLASS ORB WITH CAR INSIDE ===== */}
              <div className="relative my-2 flex items-center justify-center">
                {/* Outer Ambient Glow Ring */}
                <div
                  className={`absolute w-20 h-20 rounded-full transition-opacity duration-300 blur-md ${
                    isSelected ? 'opacity-70 animate-pulse' : 'opacity-25 group-hover:opacity-50'
                  }`}
                  style={{
                    backgroundColor: color,
                  }}
                />

                {/* Orb Sphere Glass Body */}
                <div
                  className="relative w-16 h-16 rounded-full flex items-center justify-center border shadow-inner transition-transform duration-300 group-hover:scale-105"
                  style={{
                    background: `radial-gradient(circle at 35% 30%, ${color}44 0%, #09090b 70%, #000000 100%)`,
                    borderColor: isSelected ? color : `${color}66`,
                    boxShadow: isSelected
                      ? `0 0 15px ${color}88, inset 0 0 12px ${color}55`
                      : `0 0 8px ${color}33, inset 0 0 6px ${color}22`,
                  }}
                >
                  {/* Top Specular Glare Arc */}
                  <div className="absolute top-1 left-2.5 right-2.5 h-3 rounded-full bg-white/20 blur-[1px] pointer-events-none" />

                  {/* Car Icon inside Orb */}
                  <motion.div
                    animate={
                      unit.isLive && (unit.speedKmh ?? 0) > 0
                        ? { y: [0, -2, 0] }
                        : {}
                    }
                    transition={{
                      repeat: Infinity,
                      duration: 1.8,
                      ease: 'easeInOut',
                    }}
                    className="relative z-10 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
                  >
                    <Car
                      size={26}
                      style={{
                        color: isSelected ? '#ffffff' : color,
                        filter: `drop-shadow(0 0 6px ${color})`,
                      }}
                    />
                  </motion.div>

                  {/* Live Rotating Orbital Ping */}
                  {unit.isLive && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-black animate-ping"
                      style={{ backgroundColor: color }}
                    />
                  )}
                </div>
              </div>

              {/* Hardware Device ID */}
              <div className="w-full text-center mt-1">
                <div className="text-xs font-mono font-black text-white tracking-tight truncate flex items-center justify-center gap-1">
                  <span>{unit.deviceId}</span>
                </div>
                <div className="text-[10px] text-zinc-300 font-medium truncate mt-0.5">
                  {unit.driverName}
                </div>
                <div className="text-[9px] text-zinc-500 font-mono truncate">
                  {unit.vehiclePlate}
                </div>
              </div>

              {/* Telemetry Status Strip */}
              <div className="mt-2.5 pt-2 border-t border-zinc-800/60 w-full flex items-center justify-between text-[9px] font-mono">
                <span className="flex items-center gap-1 text-zinc-400">
                  <Radio size={9} className={unit.isLive ? 'text-emerald-400 animate-pulse' : 'text-zinc-600'} />
                  {unit.isLive ? 'STREAMING' : 'READY'}
                </span>
                {unit.isLive && unit.speedKmh != null ? (
                  <span className="font-bold text-white tabular-nums">
                    {unit.speedKmh.toFixed(0)} km/h
                  </span>
                ) : (
                  <span className="text-zinc-600">IDLE</span>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
