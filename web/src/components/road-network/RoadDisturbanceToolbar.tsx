'use client';

import React from 'react';
import {
  MousePointer,
  AlertTriangle,
  Paintbrush,
  Wrench,
  Layers,
  Flame,
  Droplets,
  Waves,
  CornerUpRight,
  ShieldCheck,
  Check,
  Sparkles,
} from 'lucide-react';
import type { HazardKind, HazardSeverity, Lane } from '@/lib/sim/demoSimulator';

export type PainterMode = 'inspect' | 'place_defect' | 'paint_cell' | 'repair';

export interface RoadDisturbanceToolbarProps {
  activeMode: PainterMode;
  onModeChange: (mode: PainterMode) => void;
  defectType: HazardKind;
  onDefectTypeChange: (type: HazardKind) => void;
  defectSeverity: HazardSeverity;
  onDefectSeverityChange: (severity: HazardSeverity) => void;
  defectLane: Lane;
  onDefectLaneChange: (lane: Lane) => void;
  cellRoughness: number;
  onCellRoughnessChange: (val: number) => void;
  cellSpikes: number;
  onCellSpikesChange: (spikes: number) => void;
  isSaving?: boolean;
  saveStatus?: string | null;
  stats?: {
    defectsCount: number;
    cellsCount: number;
    severeCount: number;
  };
}

export function RoadDisturbanceToolbar({
  activeMode,
  onModeChange,
  defectType,
  onDefectTypeChange,
  defectSeverity,
  onDefectSeverityChange,
  defectLane,
  onDefectLaneChange,
  cellRoughness,
  onCellRoughnessChange,
  cellSpikes,
  onCellSpikesChange,
  isSaving = false,
  saveStatus = null,
  stats,
}: RoadDisturbanceToolbarProps) {
  return (
    <div className="bg-zinc-950/95 border border-zinc-800/90 rounded-lg p-3 font-mono text-xs backdrop-blur-md shadow-2xl space-y-3">
      {/* Top Header & Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold text-white text-[12px] uppercase tracking-wider flex items-center gap-1.5">
            <Layers size={14} className="text-emerald-400" />
            Disturbance Painter
          </span>
          {isSaving && (
            <span className="text-[10px] text-amber-400 bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded animate-pulse">
              Syncing to Supabase...
            </span>
          )}
          {saveStatus && !isSaving && (
            <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded flex items-center gap-1">
              <Check size={10} />
              {saveStatus}
            </span>
          )}
        </div>

        {stats && (
          <div className="flex items-center gap-3 text-[10px] text-zinc-400">
            <span>
              Defects: <strong className="text-white">{stats.defectsCount}</strong>
            </span>
            <span>·</span>
            <span>
              H3 Cells: <strong className="text-white">{stats.cellsCount}</strong>
            </span>
            <span>·</span>
            <span>
              Severe:{' '}
              <strong className={stats.severeCount > 0 ? 'text-rose-400' : 'text-zinc-400'}>
                {stats.severeCount}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Mode Selector Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-black/60 rounded-md border border-zinc-800/80">
        <button
          type="button"
          onClick={() => onModeChange('inspect')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded transition-all text-[11px] font-bold ${
            activeMode === 'inspect'
              ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-900/50'
          }`}
        >
          <MousePointer size={12} className={activeMode === 'inspect' ? 'text-sky-400' : ''} />
          <span>Inspect</span>
        </button>

        <button
          type="button"
          onClick={() => onModeChange('place_defect')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded transition-all text-[11px] font-bold ${
            activeMode === 'place_defect'
              ? 'bg-rose-950/80 text-rose-300 border border-rose-800/80 shadow-[0_0_12px_rgba(244,63,94,0.25)]'
              : 'text-zinc-400 hover:text-rose-300 hover:bg-zinc-900/50'
          }`}
        >
          <AlertTriangle size={12} className={activeMode === 'place_defect' ? 'text-rose-400' : ''} />
          <span>Place Defect</span>
        </button>

        <button
          type="button"
          onClick={() => onModeChange('paint_cell')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded transition-all text-[11px] font-bold ${
            activeMode === 'paint_cell'
              ? 'bg-amber-950/80 text-amber-300 border border-amber-800/80 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
              : 'text-zinc-400 hover:text-amber-300 hover:bg-zinc-900/50'
          }`}
        >
          <Paintbrush size={12} className={activeMode === 'paint_cell' ? 'text-amber-400' : ''} />
          <span>Paint H3 Cell</span>
        </button>

        <button
          type="button"
          onClick={() => onModeChange('repair')}
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded transition-all text-[11px] font-bold ${
            activeMode === 'repair'
              ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
              : 'text-zinc-400 hover:text-emerald-300 hover:bg-zinc-900/50'
          }`}
        >
          <Wrench size={12} className={activeMode === 'repair' ? 'text-emerald-400' : ''} />
          <span>Erase / Repair</span>
        </button>
      </div>

      {/* Sub-Panel: Dynamic Controls per Active Mode */}
      {activeMode === 'inspect' && (
        <div className="flex items-center justify-between text-[11px] text-zinc-400 bg-zinc-900/40 p-2 rounded border border-zinc-800/60">
          <span className="flex items-center gap-1.5">
            <MousePointer size={11} className="text-sky-400" />
            Click any H3 polygon or defect marker on the map to inspect telemetry consensus & IRI metrics.
          </span>
          <span className="text-[10px] text-zinc-500 hidden sm:inline">Ready</span>
        </div>
      )}

      {activeMode === 'place_defect' && (
        <div className="space-y-2.5 bg-zinc-900/40 p-2.5 rounded border border-zinc-800/70">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-400">
            <span className="font-bold text-rose-300 uppercase">Defect Parameters</span>
            <span className="text-zinc-500">Click map to pinpoint & alert cockpit</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* Defect Type */}
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 block uppercase">Hazard Type</span>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => onDefectTypeChange('pothole')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border ${
                    defectType === 'pothole'
                      ? 'bg-rose-950 text-rose-300 border-rose-700'
                      : 'bg-black/40 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  <Flame size={10} className="text-rose-400" />
                  Pothole
                </button>
                <button
                  type="button"
                  onClick={() => onDefectTypeChange('speed_bump')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border ${
                    defectType === 'speed_bump'
                      ? 'bg-amber-950 text-amber-300 border-amber-700'
                      : 'bg-black/40 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  <Waves size={10} className="text-amber-400" />
                  Speed Bump
                </button>
                <button
                  type="button"
                  onClick={() => onDefectTypeChange('sharp_curve')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border ${
                    defectType === 'sharp_curve'
                      ? 'bg-purple-950 text-purple-300 border-purple-700'
                      : 'bg-black/40 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  <CornerUpRight size={10} className="text-purple-400" />
                  Rough / Curve
                </button>
                <button
                  type="button"
                  onClick={() => onDefectTypeChange('water_pooling')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border ${
                    defectType === 'water_pooling'
                      ? 'bg-sky-950 text-sky-300 border-sky-700'
                      : 'bg-black/40 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                >
                  <Droplets size={10} className="text-sky-400" />
                  Water Pooling
                </button>
              </div>
            </div>

            {/* Defect Severity */}
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 block uppercase">Severity Level</span>
              <div className="grid grid-cols-2 gap-1">
                {(['low', 'medium', 'high', 'critical'] as HazardSeverity[]).map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => onDefectSeverityChange(sev)}
                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase border text-center ${
                      defectSeverity === sev
                        ? sev === 'critical'
                          ? 'bg-rose-950 text-rose-300 border-rose-600'
                          : sev === 'high'
                          ? 'bg-orange-950 text-orange-300 border-orange-600'
                          : sev === 'medium'
                          ? 'bg-yellow-950 text-yellow-300 border-yellow-600'
                          : 'bg-emerald-950 text-emerald-300 border-emerald-600'
                        : 'bg-black/40 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </div>

            {/* Lane Position */}
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 block uppercase">Lane Lateral Offset</span>
              <div className="grid grid-cols-3 gap-1">
                {(['left', 'center', 'right'] as Lane[]).map((lane) => (
                  <button
                    key={lane}
                    type="button"
                    onClick={() => onDefectLaneChange(lane)}
                    className={`px-2 py-1 rounded text-[10px] font-bold uppercase border text-center ${
                      defectLane === lane
                        ? 'bg-zinc-800 text-white border-zinc-600 shadow-sm'
                        : 'bg-black/40 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                    }`}
                  >
                    {lane}
                  </button>
                ))}
              </div>
              <div className="text-[9px] text-zinc-500 text-center pt-1">
                Directional cone lookahead (0-300m)
              </div>
            </div>
          </div>
        </div>
      )}

      {activeMode === 'paint_cell' && (
        <div className="space-y-2.5 bg-zinc-900/40 p-2.5 rounded border border-zinc-800/70">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-400">
            <span className="font-bold text-amber-300 uppercase">H3-12 Grid Cell Painter</span>
            <span className="text-zinc-500">Click map polygon to set roughness & spikes</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Roughness Slider & Presets */}
            <div className="space-y-1.5 bg-black/40 p-2 rounded border border-zinc-800/80">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-400 font-semibold">Roughness Index (IRI Proxy):</span>
                <span
                  className={`font-mono font-bold text-xs ${
                    cellRoughness >= 80
                      ? 'text-rose-400'
                      : cellRoughness >= 55
                      ? 'text-orange-400'
                      : cellRoughness >= 25
                      ? 'text-yellow-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {cellRoughness} / 100
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={cellRoughness}
                onChange={(e) => onCellRoughnessChange(Number(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none"
              />
              <div className="flex items-center justify-between gap-1 pt-1 text-[9px]">
                <button
                  type="button"
                  onClick={() => onCellRoughnessChange(15)}
                  className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/50 hover:bg-emerald-900/50"
                >
                  Smooth (15)
                </button>
                <button
                  type="button"
                  onClick={() => onCellRoughnessChange(40)}
                  className="px-1.5 py-0.5 rounded bg-yellow-950/60 text-yellow-400 border border-yellow-800/50 hover:bg-yellow-900/50"
                >
                  Wear (40)
                </button>
                <button
                  type="button"
                  onClick={() => onCellRoughnessChange(65)}
                  className="px-1.5 py-0.5 rounded bg-orange-950/60 text-orange-400 border border-orange-800/50 hover:bg-orange-900/50"
                >
                  Rough (65)
                </button>
                <button
                  type="button"
                  onClick={() => onCellRoughnessChange(88)}
                  className="px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-800/50 hover:bg-rose-900/50"
                >
                  Severe (88)
                </button>
              </div>
            </div>

            {/* Spike Count Slider */}
            <div className="space-y-1.5 bg-black/40 p-2 rounded border border-zinc-800/80">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-400 font-semibold">G-Sensor Spikes Logged:</span>
                <span className="font-mono font-bold text-white text-xs">{cellSpikes} spikes</span>
              </div>
              <input
                type="range"
                min="0"
                max="25"
                step="1"
                value={cellSpikes}
                onChange={(e) => onCellSpikesChange(Number(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none"
              />
              <div className="flex items-center justify-between text-[9px] text-zinc-500 pt-1">
                <span>0 = Clean pass</span>
                <span>5 = Moderate impact</span>
                <span>15+ = Severe shock</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeMode === 'repair' && (
        <div className="flex items-center justify-between text-[11px] text-zinc-400 bg-zinc-900/40 p-2 rounded border border-zinc-800/60">
          <span className="flex items-center gap-1.5">
            <Wrench size={12} className="text-emerald-400" />
            Click on any defect marker to mark as <strong className="text-emerald-300">REPAIRED</strong> or click a damaged cell to reset its roughness to 10 (Smooth).
          </span>
          <span className="text-[10px] text-emerald-400 font-semibold hidden sm:inline">Erase Active</span>
        </div>
      )}
    </div>
  );
}
