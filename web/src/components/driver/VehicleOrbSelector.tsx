'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Car, Check } from 'lucide-react';

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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {units.map((unit) => {
          const isSelected = selectedDeviceId === unit.deviceId;
          const color = unit.color || '#10b981';

          return (
            <motion.button
              key={unit.deviceId}
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelect(unit.deviceId)}
              className={`relative flex flex-col items-center p-3 rounded-2xl border transition-all text-center overflow-hidden cursor-pointer select-none group ${
                isSelected
                  ? 'bg-zinc-900/90 border-emerald-500 shadow-[0_0_18px_rgba(16,185,129,0.25)] ring-1 ring-emerald-500/40'
                  : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/40'
              }`}
            >
              {/* Selected Checkmark Badge */}
              {isSelected && (
                <div
                  className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center text-black font-black shadow z-10"
                  style={{ backgroundColor: color }}
                >
                  <Check size={10} strokeWidth={3.5} />
                </div>
              )}

              {/* 3D Glass Orb with Car Inside */}
              <div className="relative my-1.5 flex items-center justify-center">
                {/* Ambient Glow */}
                <div
                  className={`absolute w-14 h-14 rounded-full transition-opacity duration-300 blur-md ${
                    isSelected ? 'opacity-60' : 'opacity-20 group-hover:opacity-40'
                  }`}
                  style={{ backgroundColor: color }}
                />

                {/* Orb Glass Body */}
                <div
                  className="relative w-13 h-13 rounded-full flex items-center justify-center border transition-transform duration-300 group-hover:scale-105"
                  style={{
                    background: `radial-gradient(circle at 35% 30%, ${color}35 0%, #09090b 75%, #000000 100%)`,
                    borderColor: isSelected ? color : `${color}55`,
                    boxShadow: isSelected
                      ? `0 0 12px ${color}66, inset 0 0 10px ${color}44`
                      : `0 0 6px ${color}22, inset 0 0 4px ${color}22`,
                  }}
                >
                  {/* Glass Highlight Arc */}
                  <div className="absolute top-1 left-2 right-2 h-2.5 rounded-full bg-white/25 blur-[0.5px] pointer-events-none" />

                  {/* Floating Car */}
                  <Car
                    size={20}
                    style={{
                      color: isSelected ? '#ffffff' : color,
                      filter: `drop-shadow(0 0 5px ${color})`,
                    }}
                  />

                  {/* Live Ping Dot */}
                  {unit.isLive && (
                    <span
                      className="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border border-black animate-ping"
                      style={{ backgroundColor: color }}
                    />
                  )}
                </div>
              </div>

              {/* Driver & Vehicle Metadata */}
              <div className="w-full mt-1">
                <div className="text-[11.5px] font-bold text-white tracking-tight truncate">
                  {unit.driverName}
                </div>
                <div className="text-[9px] font-mono text-zinc-400 truncate mt-0.5">
                  {unit.vehiclePlate}
                </div>
              </div>

              {/* Status Pill */}
              <div className="mt-2 flex items-center gap-1 text-[9px] font-mono">
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    unit.isLive ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
                  }`}
                />
                <span className={unit.isLive ? 'text-emerald-400 font-semibold' : 'text-zinc-500'}>
                  {unit.isLive ? `${unit.speedKmh ? Math.round(unit.speedKmh) : 0} km/h` : 'Ready'}
                </span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
