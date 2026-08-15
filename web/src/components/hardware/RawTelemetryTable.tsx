'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Satellite,
  Compass,
  Cpu,
  Layers,
  ArrowUpDown,
  RotateCcw,
} from 'lucide-react';

export interface RawTelemetryRow {
  id?: string | number;
  seq: number;
  device_id: string;
  uptime_ms: number;
  t_sec: number; // GPS timestamp in seconds
  accel_raw: {
    x: number;
    y: number;
    z: number;
  };
  calibrated_accel: {
    a_long: number;
    a_lat: number;
    a_vert: number;
    peak_g: number;
    rms_g: number;
  };
  yaw_rate: number; // °/s
  mic_rms: number; // acoustic RMS count
  gps: {
    speed_kmh: number;
    heading_deg: number;
    lat: number;
    lon: number;
    sats: number;
    hdop: number;
  };
  flags: {
    gps_fix: boolean;
    calibrated: boolean;
    imu_ready?: boolean;
    mic_active?: boolean;
    storage_ok?: boolean;
  };
  raw_payload?: Record<string, unknown>;
}

export interface RawTelemetryTableProps {
  rows?: RawTelemetryRow[];
  selectedRow?: RawTelemetryRow | null;
  onSelectRow: (row: RawTelemetryRow) => void;
  isLoading?: boolean;
}

export function RawTelemetryTable({
  rows = [],
  selectedRow,
  onSelectRow,
  isLoading = false,
}: RawTelemetryTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterGpsFixOnly, setFilterGpsFixOnly] = useState(false);
  const [filterCalibratedOnly, setFilterCalibratedOnly] = useState(false);
  const [sortField, setSortField] = useState<'seq' | 'uptime_ms' | 't_sec' | 'speed'>('seq');
  const [sortAsc, setSortAsc] = useState(false);

  // Filter & Sort telemetry rows
  const filteredRows = useMemo(() => {
    return rows
      .filter((row) => {
        // Search query filter (seq or device_id)
        if (searchTerm.trim()) {
          const query = searchTerm.toLowerCase().trim();
          const matchSeq = String(row.seq || '').includes(query);
          const matchDevice = String(row.device_id || '').toLowerCase().includes(query);
          if (!matchSeq && !matchDevice) return false;
        }

        // Flag checkboxes
        if (filterGpsFixOnly && !row.flags.gps_fix) return false;
        if (filterCalibratedOnly && !row.flags.calibrated) return false;

        return true;
      })
      .sort((a, b) => {
        let valA = 0;
        let valB = 0;

        switch (sortField) {
          case 'seq':
            valA = a.seq;
            valB = b.seq;
            break;
          case 'uptime_ms':
            valA = a.uptime_ms;
            valB = b.uptime_ms;
            break;
          case 't_sec':
            valA = a.t_sec;
            valB = b.t_sec;
            break;
          case 'speed':
            valA = a.gps.speed_kmh;
            valB = b.gps.speed_kmh;
            break;
        }

        return sortAsc ? valA - valB : valB - valA;
      });
  }, [rows, searchTerm, filterGpsFixOnly, filterCalibratedOnly, sortField, sortAsc]);

  const handleSortToggle = (field: 'seq' | 'uptime_ms' | 't_sec' | 'speed') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const handleResetFilters = () => {
    setSearchTerm('');
    setFilterGpsFixOnly(false);
    setFilterCalibratedOnly(false);
  };

  return (
    <div className="flex flex-col w-full bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden font-sans text-xs">
      {/* Table Toolbar Header */}
      <div className="p-2.5 bg-black border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Search input */}
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <div className="relative flex-1 max-w-sm">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search sequence # or device_id..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-zinc-950 border border-zinc-800 rounded-md text-zinc-100 placeholder-zinc-500 text-xs font-mono focus:outline-none focus:border-zinc-700 transition-colors"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <XCircle size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-900 border border-zinc-800 rounded-md text-[11px] text-zinc-400 font-mono">
            <Layers size={12} className="text-emerald-400" />
            <span>50Hz IMU / 1Hz GNSS</span>
          </div>
        </div>

        {/* Right: Flag filters & Row Counter */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 bg-zinc-950 px-3 py-1.5 border border-zinc-800 rounded-lg">
            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider flex items-center gap-1">
              <Filter size={11} className="text-zinc-400" />
              Flags:
            </span>

            {/* GPS FIX Checkbox */}
            <label className="flex items-center gap-1.5 cursor-pointer text-zinc-300 text-xs hover:text-white transition-colors">
              <input
                type="checkbox"
                checked={filterGpsFixOnly}
                onChange={(e) => setFilterGpsFixOnly(e.target.checked)}
                className="rounded bg-zinc-900 border-zinc-700 text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-emerald-500"
              />
              <span className="font-mono text-[11px] font-medium">GPS_FIX</span>
            </label>

            {/* CALIBRATED Checkbox */}
            <label className="flex items-center gap-1.5 cursor-pointer text-zinc-300 text-xs hover:text-white transition-colors">
              <input
                type="checkbox"
                checked={filterCalibratedOnly}
                onChange={(e) => setFilterCalibratedOnly(e.target.checked)}
                className="rounded bg-zinc-900 border-zinc-700 text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-emerald-500"
              />
              <span className="font-mono text-[11px] font-medium">CALIBRATED</span>
            </label>
          </div>

          {(searchTerm || filterGpsFixOnly || filterCalibratedOnly) && (
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors"
              title="Reset all filters"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
          )}

          <div className="text-[11px] text-zinc-400 font-mono px-2 py-1 bg-zinc-900/60 rounded border border-zinc-800">
            <span className="text-emerald-400 font-bold">{filteredRows.length}</span> / {rows.length} rows
          </div>
        </div>
      </div>

      {/* High-density Monospace Telemetry Table */}
      <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
        <table className="w-full text-left border-collapse font-mono text-[11px] leading-tight select-none">
          {/* Table Header */}
          <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 text-zinc-400 uppercase text-[10px] font-bold tracking-wider">
            <tr>
              <th
                onClick={() => handleSortToggle('seq')}
                className="p-2.5 cursor-pointer hover:bg-zinc-800/50 hover:text-white transition-colors border-r border-zinc-800/40"
              >
                <div className="flex items-center gap-1">
                  <span>SEQ</span>
                  <ArrowUpDown size={10} className={sortField === 'seq' ? 'text-emerald-400' : 'text-zinc-600'} />
                </div>
              </th>
              <th className="p-2.5 border-r border-zinc-800/40">DEVICE_ID</th>
              <th
                onClick={() => handleSortToggle('uptime_ms')}
                className="p-2.5 cursor-pointer hover:bg-zinc-800/50 hover:text-white transition-colors border-r border-zinc-800/40 text-right"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>UPTIME_MS</span>
                  <ArrowUpDown size={10} className={sortField === 'uptime_ms' ? 'text-emerald-400' : 'text-zinc-600'} />
                </div>
              </th>
              <th
                onClick={() => handleSortToggle('t_sec')}
                className="p-2.5 cursor-pointer hover:bg-zinc-800/50 hover:text-white transition-colors border-r border-zinc-800/40"
              >
                <div className="flex items-center gap-1">
                  <Clock size={11} className="text-sky-400" />
                  <span>T_SEC (GPS CLK)</span>
                  <ArrowUpDown size={10} className={sortField === 't_sec' ? 'text-emerald-400' : 'text-zinc-600'} />
                </div>
              </th>
              <th className="p-2.5 border-r border-zinc-800/40 text-center">
                RAW ADC (ACCEL X / Y / Z)
              </th>
              <th className="p-2.5 border-r border-zinc-800/40">
                CALIB ACCEL (G_LONG / G_LAT / G_VERT)
              </th>
              <th className="p-2.5 border-r border-zinc-800/40 text-right">PEAK/RMS</th>
              <th className="p-2.5 border-r border-zinc-800/40 text-right">YAW_RATE (°/s)</th>
              <th className="p-2.5 border-r border-zinc-800/40 text-right">MIC_RMS</th>
              <th
                onClick={() => handleSortToggle('speed')}
                className="p-2.5 cursor-pointer hover:bg-zinc-800/50 hover:text-white transition-colors border-r border-zinc-800/40 text-right"
              >
                <div className="flex items-center justify-end gap-1">
                  <span>SPEED</span>
                  <ArrowUpDown size={10} className={sortField === 'speed' ? 'text-emerald-400' : 'text-zinc-600'} />
                </div>
              </th>
              <th className="p-2.5 border-r border-zinc-800/40 text-right">HEADING</th>
              <th className="p-2.5 border-r border-zinc-800/40">LAT / LON</th>
              <th className="p-2.5 border-r border-zinc-800/40 text-center">
                <div className="flex items-center justify-center gap-1">
                  <Satellite size={11} className="text-emerald-400" />
                  <span>SATS/HDOP</span>
                </div>
              </th>
              <th className="p-2.5 text-center">BITMASK FLAGS</th>
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-zinc-900 text-zinc-300">
            {isLoading ? (
              <tr>
                <td colSpan={14} className="p-8 text-center text-zinc-500 bg-zinc-950">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <span>Streaming high-rate telematics packet log...</span>
                  </div>
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={14} className="p-12 text-center text-zinc-500 bg-zinc-950">
                  <div className="flex flex-col items-center gap-2">
                    <XCircle size={28} className="text-zinc-700" />
                    <p className="text-sm font-semibold text-zinc-400">No telemetry frames match filters</p>
                    <p className="text-xs text-zinc-600">Try adjusting your search query or flag toggles.</p>
                    <button
                      onClick={handleResetFilters}
                      className="mt-2 px-3 py-1 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded-md text-xs transition-colors"
                    >
                      Clear Filters
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              filteredRows.map((row, idx) => {
                const isSelected = selectedRow?.seq === row.seq && selectedRow?.device_id === row.device_id;

                return (
                  <tr
                    key={row.id ? `telem-${row.id}` : `${row.device_id}-${row.seq}-${row.uptime_ms}-${idx}`}
                    onClick={() => onSelectRow(row)}
                    className={`cursor-pointer transition-colors duration-150 ${
                      isSelected
                        ? 'bg-zinc-800/90 text-white font-semibold ring-1 ring-emerald-500/50'
                        : 'hover:bg-zinc-900/80 text-zinc-300'
                    }`}
                  >
                    {/* SEQ */}
                    <td className="p-2.5 border-r border-zinc-900/80 font-bold text-emerald-400">
                      #{row.seq}
                    </td>

                    {/* DEVICE_ID */}
                    <td className="p-2.5 border-r border-zinc-900/80 font-medium text-zinc-200 whitespace-nowrap">
                      {row.device_id}
                    </td>

                    {/* UPTIME_MS */}
                    <td className="p-2.5 border-r border-zinc-900/80 text-right text-zinc-400 tabular-nums">
                      {row.uptime_ms.toLocaleString()}
                    </td>

                    {/* T_SEC GPS CLOCK */}
                    <td className="p-2.5 border-r border-zinc-900/80 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-950/80 border border-sky-800/40 text-sky-300 text-[10px]">
                        <Clock size={10} className="text-sky-400 shrink-0" />
                        <span>{row.t_sec.toFixed(2)}s</span>
                      </span>
                    </td>

                    {/* RAW ADC counts */}
                    <td className="p-2.5 border-r border-zinc-900/80 text-center tabular-nums text-zinc-400 whitespace-nowrap">
                      <span className="text-zinc-300">{row.accel_raw.x}</span>
                      <span className="text-zinc-600 mx-1">/</span>
                      <span className="text-zinc-300">{row.accel_raw.y}</span>
                      <span className="text-zinc-600 mx-1">/</span>
                      <span className="text-zinc-300">{row.accel_raw.z}</span>
                    </td>

                    {/* CALIB ACCEL */}
                    <td className="p-2.5 border-r border-zinc-900/80 tabular-nums whitespace-nowrap">
                      <span className={row.calibrated_accel.a_long < 0 ? 'text-amber-400' : 'text-zinc-200'}>
                        {row.calibrated_accel.a_long >= 0 ? `+${row.calibrated_accel.a_long.toFixed(2)}` : row.calibrated_accel.a_long.toFixed(2)}
                      </span>
                      <span className="text-zinc-600 mx-1">,</span>
                      <span className={row.calibrated_accel.a_lat < 0 ? 'text-amber-400' : 'text-zinc-200'}>
                        {row.calibrated_accel.a_lat >= 0 ? `+${row.calibrated_accel.a_lat.toFixed(2)}` : row.calibrated_accel.a_lat.toFixed(2)}
                      </span>
                      <span className="text-zinc-600 mx-1">,</span>
                      <span className="text-zinc-200">{row.calibrated_accel.a_vert.toFixed(2)}g</span>
                    </td>

                    {/* PEAK / RMS */}
                    <td className="p-2.5 border-r border-zinc-900/80 text-right tabular-nums whitespace-nowrap text-zinc-400">
                      <span className="text-amber-300 font-semibold">{row.calibrated_accel.peak_g}</span>
                      <span className="text-zinc-600 mx-1">/</span>
                      <span className="text-zinc-400">{row.calibrated_accel.rms_g}</span>
                    </td>

                    {/* YAW RATE */}
                    <td className="p-2.5 border-r border-zinc-900/80 text-right tabular-nums font-medium text-zinc-200 whitespace-nowrap">
                      {row.yaw_rate > 0 ? `+${row.yaw_rate.toFixed(1)}` : row.yaw_rate.toFixed(1)}°/s
                    </td>

                    {/* MIC RMS */}
                    <td className="p-2.5 border-r border-zinc-900/80 text-right tabular-nums text-zinc-300">
                      {row.mic_rms}
                    </td>

                    {/* SPEED */}
                    <td className="p-2.5 border-r border-zinc-900/80 text-right tabular-nums font-bold whitespace-nowrap">
                      {row.flags.gps_fix ? (
                        <span className="text-white">{row.gps.speed_kmh.toFixed(1)} <span className="text-[9px] text-zinc-500 font-normal">km/h</span></span>
                      ) : (
                        <span className="text-zinc-600">0.0</span>
                      )}
                    </td>

                    {/* HEADING */}
                    <td className="p-2.5 border-r border-zinc-900/80 text-right tabular-nums text-zinc-400 whitespace-nowrap">
                      {row.flags.gps_fix ? (
                        <span className="inline-flex items-center gap-0.5">
                          <Compass size={10} className="text-zinc-500" />
                          <span>{row.gps.heading_deg}°</span>
                        </span>
                      ) : (
                        <span className="text-zinc-600">--</span>
                      )}
                    </td>

                    {/* LAT / LON */}
                    <td className="p-2.5 border-r border-zinc-900/80 text-zinc-400 tabular-nums whitespace-nowrap text-[10px]">
                      {row.flags.gps_fix ? (
                        <span>{row.gps.lat.toFixed(5)}, {row.gps.lon.toFixed(5)}</span>
                      ) : (
                        <span className="text-zinc-600">NO FIX (0, 0)</span>
                      )}
                    </td>

                    {/* SATS / HDOP */}
                    <td className="p-2.5 border-r border-zinc-900/80 text-center whitespace-nowrap">
                      {row.flags.gps_fix ? (
                        <span className="inline-flex items-center gap-1 text-[10px]">
                          <span className="px-1 py-0.2 rounded bg-emerald-950 text-emerald-400 font-bold border border-emerald-800/40">
                            {row.gps.sats}s
                          </span>
                          <span className="text-zinc-500">h:{row.gps.hdop}</span>
                        </span>
                      ) : (
                        <span className="px-1 py-0.2 rounded bg-rose-950/80 text-rose-400 text-[10px] border border-rose-900/50">
                          0 sats
                        </span>
                      )}
                    </td>

                    {/* BITMASK FLAGS */}
                    <td className="p-2.5 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5">
                        {row.flags.gps_fix ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950/90 text-emerald-400 border border-emerald-800/50">
                            <CheckCircle2 size={10} />
                            <span>GPS_FIX</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-950/80 text-rose-400 border border-rose-900/50">
                            <XCircle size={10} />
                            <span>NO_FIX</span>
                          </span>
                        )}

                        {row.flags.calibrated ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-950/90 text-sky-400 border border-sky-800/50">
                            <span>CALIBRATED</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-950/80 text-amber-400 border border-amber-900/50">
                            <span>UNCALIB</span>
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer / Instruction Bar */}
      <div className="p-2.5 bg-zinc-900/80 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
        <div className="flex items-center gap-2">
          <Cpu size={13} className="text-emerald-400" />
          <span>Click any row to open full raw binary telemetry packet payload drawer.</span>
        </div>
        <div>
          <span>Protocol: COBS Framed Binary / JSON Unpack</span>
        </div>
      </div>
    </div>
  );
}
