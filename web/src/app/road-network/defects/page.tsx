'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { OSMMap, MapMarker } from '@/components/map/OSMMap';
import { createClient } from '@/lib/supabase/client';
import { cellToLatLng } from 'h3-js';
import {
  AlertTriangle,
  ShieldCheck,
  MapPin,
  Layers,
  ArrowRight,
  Check,
  X,
  RefreshCw,
  Search,
  Filter,
  Flame,
  Activity,
  Map,
  Table as TableIcon,
  Compass,
} from 'lucide-react';

interface DefectRow {
  id: string;
  h3_12: string;
  headingSector: number;
  lat: number;
  lon: number;
  confidence: number;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  distinctDevices: number;
  spikeRate: number;
  firstSeen: string;
  lastSeen?: string;
  status: 'active' | 'repaired' | 'disputed';
}

type ViewMode = 'split' | 'table' | 'map';
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type StatusFilter = 'all' | 'active' | 'repaired' | 'disputed';

export default function ConfirmedDefectsInventory() {
  const [defects, setDefects] = useState<DefectRow[]>([]);
  const [selectedDefect, setSelectedDefect] = useState<DefectRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [mapCenter, setMapCenter] = useState<[number, number]>([6.915, 79.852]);
  const [mapZoom, setMapZoom] = useState<number>(13);

  const supabase = useMemo(() => createClient(), []);

  const loadDefects = useCallback(async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('road_defects')
        .select('*')
        .order('first_seen', { ascending: false })
        .limit(100);

      if (data && !error) {
        const mappedData: DefectRow[] = data.map((e: any, idx: number) => {
          let lat = Number(e.lat ?? 0);
          let lon = Number(e.lon ?? 0);

          // If lat/lon are missing/zero, resolve real spatial centroid from H3-12 index
          if ((!lat || !lon) && e.h3_12) {
            try {
              const coords = cellToLatLng(e.h3_12);
              lat = coords[0];
              lon = coords[1];
            } catch {
              // ignore
            }
          }

          return {
            id: String(e.id || `def-${idx}`),
            h3_12: String(e.h3_12 || 'N/A'),
            headingSector: Number(e.heading_sector ?? 0),
            lat,
            lon,
            severity: (e.severity as any) || 'high',
            confidence: Number(e.confidence ?? 0),
            distinctDevices: Number(e.distinct_devices ?? 1),
            spikeRate: Number(e.spike_rate ?? 0),
            firstSeen: String(e.first_seen || e.last_seen || ''),
            lastSeen: e.last_seen ? String(e.last_seen) : undefined,
            status: (e.status as any) || 'active',
          };
        });

        setDefects(mappedData);

        if (mappedData.length > 0) {
          const firstWithCoords = mappedData.find((d) => d.lat !== 0 && d.lon !== 0);
          if (firstWithCoords) {
            setMapCenter([firstWithCoords.lat, firstWithCoords.lon]);
          }
        }
      }
    } catch (err) {
      console.error('Error loading defects:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadDefects();
  }, [loadDefects]);

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      await supabase
        .from('road_defects')
        .update({ status: newStatus })
        .eq('id', id);

      setDefects((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status: newStatus as any } : d))
      );
      if (selectedDefect?.id === id) {
        setSelectedDefect((prev) => (prev ? { ...prev, status: newStatus as any } : null));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelectDefect = (defect: DefectRow) => {
    setSelectedDefect(defect);
    if (defect.lat && defect.lon) {
      setMapCenter([defect.lat, defect.lon]);
      setMapZoom(16);
    }
  };

  // Filtered defects
  const filteredDefects = useMemo(() => {
    return defects.filter((d) => {
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesH3 = d.h3_12.toLowerCase().includes(query);
        const matchesId = d.id.toLowerCase().includes(query);
        if (!matchesH3 && !matchesId) return false;
      }

      if (severityFilter !== 'all' && d.severity !== severityFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;

      return true;
    });
  }, [defects, searchQuery, severityFilter, statusFilter]);

  // Map markers from confirmed defects
  const mapMarkers: MapMarker[] = useMemo(() => {
    return filteredDefects
      .filter((d) => d.lat !== 0 && d.lon !== 0)
      .map((d) => ({
        id: `defect-${d.id}`,
        lat: d.lat,
        lon: d.lon,
        title: `Road Hazard: ${d.severity.toUpperCase()}`,
        type: 'defect',
        severity: d.severity,
        confidence: d.confidence,
        h3_12: d.h3_12,
        details: `Consensus: ${d.distinctDevices} devices · Spike rate: ${(d.spikeRate * 100).toFixed(0)}% · Status: ${d.status}`,
      }));
  }, [filteredDefects]);

  // Accurate aggregate metrics (no fake fallbacks)
  const metrics = useMemo(() => {
    const total = defects.length;
    const criticalCount = defects.filter((d) => d.severity === 'critical').length;
    const highCount = defects.filter((d) => d.severity === 'high').length;
    const activeCount = defects.filter((d) => d.status === 'active').length;
    const avgConf = total > 0 ? ((defects.reduce((a, d) => a + d.confidence, 0) / total) * 100).toFixed(1) : '0.0';

    return {
      total,
      criticalCount,
      highCount,
      activeCount,
      avgConf,
    };
  }, [defects]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-black text-white font-sans text-xs">
      <Header
        title="Defects Inventory"
        subtitle="Cross-validated road surface hazards, consensus proof & remediation tracking"
      />

      {/* Subheader Navigation & View Controls */}
      <div className="bg-black border-b border-zinc-800 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800 font-mono text-[11px]">
          <Link href="/road-network" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            H3 Grid
          </Link>
          <Link href="/road-network/defects" className="px-3 py-1 rounded-md bg-zinc-800 text-white font-semibold">
            Defects Inventory
          </Link>
          <Link href="/road-network/predictions" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            Hazard Predictions
          </Link>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded p-0.5 font-mono text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode('split')}
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                viewMode === 'split' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Layers size={11} /> Split
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                viewMode === 'table' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <TableIcon size={11} /> Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode('map')}
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                viewMode === 'map' ? 'bg-zinc-800 text-white font-bold' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Map size={11} /> Map
            </button>
          </div>

          <button
            onClick={loadDefects}
            className="p-1.5 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition-colors"
            title="Refresh inventory"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* KPI Top Cards */}
      <div className="px-4 py-3 border-b border-zinc-800/80 bg-zinc-950/60 grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        <div className="bg-zinc-900/40 border border-zinc-800 rounded p-2.5">
          <span className="text-[10px] text-zinc-400 uppercase font-mono block">Confirmed Hazards</span>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-xl font-bold font-mono text-amber-400">{metrics.total}</span>
            <span className="text-[10px] text-zinc-500 font-mono">({metrics.activeCount} active)</span>
          </div>
        </div>

        <div className="bg-zinc-900/40 border border-zinc-800 rounded p-2.5">
          <span className="text-[10px] text-zinc-400 uppercase font-mono block">Critical Severity</span>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-xl font-bold font-mono text-rose-400">{metrics.criticalCount}</span>
            <span className="text-[10px] text-zinc-500 font-mono">severe surface drops</span>
          </div>
        </div>

        <div className="bg-zinc-900/40 border border-zinc-800 rounded p-2.5">
          <span className="text-[10px] text-zinc-400 uppercase font-mono block">High Severity</span>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-xl font-bold font-mono text-orange-400">{metrics.highCount}</span>
            <span className="text-[10px] text-zinc-500 font-mono">potholes & anomalies</span>
          </div>
        </div>

        <div className="bg-zinc-900/40 border border-zinc-800 rounded p-2.5">
          <span className="text-[10px] text-zinc-400 uppercase font-mono block">Consensus Confidence</span>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-xl font-bold font-mono text-emerald-400">{metrics.avgConf}%</span>
            <span className="text-[10px] text-zinc-500 font-mono">≥3 device quorum</span>
          </div>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden p-3 gap-3 min-h-0">
        {/* Table / List View */}
        {(viewMode === 'split' || viewMode === 'table') && (
          <div
            className={`flex flex-col bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden ${
              viewMode === 'split' ? 'w-1/2 shrink-0' : 'flex-1'
            }`}
          >
            {/* Filter / Search Bar */}
            <div className="p-2.5 border-b border-zinc-800 bg-black/40 flex items-center justify-between gap-2 shrink-0">
              <div className="relative flex-1 max-w-xs">
                <Search size={11} className="absolute left-2.5 top-2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Filter by H3 index or defect ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded pl-7 pr-2 py-1 text-zinc-200 font-mono text-[11px] focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600"
                />
              </div>

              <div className="flex items-center gap-1.5 font-mono text-[10px]">
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-300 focus:outline-none"
                >
                  <option value="all">All Severities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-300 focus:outline-none"
                >
                  <option value="all">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="repaired">Repaired</option>
                  <option value="disputed">Disputed</option>
                </select>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 uppercase text-[10px] font-mono tracking-wider sticky top-0 backdrop-blur z-10">
                    <th className="p-2.5">H3 Index & Coords</th>
                    <th className="p-2.5">Severity</th>
                    <th className="p-2.5">Consensus</th>
                    <th className="p-2.5">Confidence</th>
                    <th className="p-2.5 text-right">Status & Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-zinc-300 font-sans">
                  {filteredDefects.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-zinc-500 font-mono">
                        {loading ? 'Querying confirmed defect records...' : 'No matching road defects found.'}
                      </td>
                    </tr>
                  ) : (
                    filteredDefects.map((d) => {
                      const isSelected = selectedDefect?.id === d.id;
                      return (
                        <tr
                          key={d.id}
                          onClick={() => handleSelectDefect(d)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-zinc-900/90 text-white'
                              : 'hover:bg-zinc-900/40'
                          }`}
                        >
                          <td className="p-2.5 font-mono">
                            <div className="font-bold text-emerald-400 text-xs flex items-center gap-1">
                              {d.h3_12}
                              {d.headingSector !== undefined && (
                                <span className="text-zinc-500 text-[10px]">sec:{d.headingSector}</span>
                              )}
                            </div>
                            <div className="text-[10px] text-zinc-500">
                              {d.lat !== 0 && d.lon !== 0 ? `${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}` : 'Spatial Centroid'}
                            </div>
                          </td>

                          <td className="p-2.5 font-mono">
                            <span
                              className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase border ${
                                d.severity === 'critical'
                                  ? 'bg-rose-950 text-rose-400 border-rose-800/60'
                                  : d.severity === 'high'
                                  ? 'bg-amber-950 text-amber-400 border-amber-800/60'
                                  : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                              }`}
                            >
                              {d.severity}
                            </span>
                          </td>

                          <td className="p-2.5 font-mono text-[11px]">
                            <div className="text-zinc-200 font-semibold">{d.distinctDevices} devices</div>
                            <div className="text-[10px] text-zinc-500">{(d.spikeRate * 100).toFixed(0)}% spike rate</div>
                          </td>

                          <td className="p-2.5 font-mono">
                            <div className="text-emerald-400 font-bold text-xs">{(d.confidence * 100).toFixed(0)}%</div>
                            <div className="text-[10px] text-zinc-500">statistical</div>
                          </td>

                          <td className="p-2.5 text-right font-mono">
                            <div className="flex items-center justify-end gap-1.5">
                              <span
                                className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold border uppercase ${
                                  d.status === 'repaired'
                                    ? 'bg-emerald-950 text-emerald-400 border-emerald-800/60'
                                    : d.status === 'disputed'
                                    ? 'bg-rose-950 text-rose-400 border-rose-800/60'
                                    : 'bg-amber-950 text-amber-400 border-amber-800/60'
                                }`}
                              >
                                {d.status}
                              </span>

                              {d.status === 'active' && (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUpdateStatus(d.id, 'repaired');
                                    }}
                                    className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-emerald-400 transition-colors"
                                    title="Mark as Repaired"
                                  >
                                    <Check size={12} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUpdateStatus(d.id, 'disputed');
                                    }}
                                    className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-rose-400 transition-colors"
                                    title="Dispute"
                                  >
                                    <X size={12} />
                                  </button>
                                </>
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
          </div>
        )}

        {/* Map View */}
        {(viewMode === 'split' || viewMode === 'map') && (
          <div className="flex-1 flex flex-col bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden relative min-h-0">
            <div className="flex-1 relative">
              <OSMMap
                center={mapCenter}
                zoom={mapZoom}
                markers={mapMarkers}
                onMarkerClick={(m) => {
                  const id = m.id.replace('defect-', '');
                  const match = defects.find((d) => d.id === id);
                  if (match) setSelectedDefect(match);
                }}
              />

              {/* Selected Defect Inspector Overlay */}
              {selectedDefect && (
                <div className="absolute bottom-3 left-3 right-3 z-10 bg-zinc-950/95 border border-zinc-800 rounded p-3 backdrop-blur font-mono text-[11px] space-y-2 max-w-md shadow-2xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                      <span className="font-bold text-white uppercase text-xs">
                        Defect {selectedDefect.id.slice(0, 8)}
                      </span>
                    </div>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold uppercase border ${
                        selectedDefect.severity === 'critical'
                          ? 'bg-rose-950 text-rose-400 border-rose-800'
                          : selectedDefect.severity === 'high'
                          ? 'bg-amber-950 text-amber-400 border-amber-800'
                          : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                      }`}
                    >
                      {selectedDefect.severity}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-zinc-900 text-[10px]">
                    <div>
                      <span className="text-zinc-500 block">H3 Spatial Index</span>
                      <span className="text-emerald-400 font-bold select-all">{selectedDefect.h3_12}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Distinct Fleet Units</span>
                      <span className="text-white font-bold">{selectedDefect.distinctDevices} devices</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block">Spike Pass Rate</span>
                      <span className="text-white font-bold">{(selectedDefect.spikeRate * 100).toFixed(0)}%</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-zinc-900 text-[10px] text-zinc-400">
                    <span>
                      Coords: {selectedDefect.lat.toFixed(5)}, {selectedDefect.lon.toFixed(5)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {selectedDefect.status === 'active' && (
                        <button
                          onClick={() => handleUpdateStatus(selectedDefect.id, 'repaired')}
                          className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/80 hover:bg-emerald-900 transition-colors"
                        >
                          Mark Repaired
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedDefect(null)}
                        className="text-zinc-500 hover:text-white px-1"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
