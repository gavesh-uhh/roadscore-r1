'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { MapHexagon, MapMarker, OSMMap } from '@/components/map/OSMMap';
import {
  RoadDisturbanceToolbar,
  type PainterMode,
} from '@/components/road-network/RoadDisturbanceToolbar';
import { createClient } from '@/lib/supabase/client';
import { cellToBoundary, cellToLatLng, latLngToCell } from 'h3-js';
import type { HazardKind, HazardSeverity, Lane } from '@/lib/sim/demoSimulator';
import {
  Layers,
  Activity,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  Search,
  Filter,
  Navigation,
  Compass,
  Gauge,
  TrendingUp,
  MapPin,
  Wrench,
  Flame,
} from 'lucide-react';

interface RoadCellRow {
  h3_12: string;
  heading_sector?: number;
  centroid_lat?: number;
  centroid_lon?: number;
  roughness_index: number;
  pass_count: number;
  device_count?: number;
  spike_count: number;
  speed_p85_kmh: number;
  defect_confidence: number;
  rough_mean?: number;
  last_pass_at?: string;
  updated_at?: string;
}

interface DefectItem {
  id: string;
  h3_12: string;
  heading_sector: number;
  lat: number;
  lon: number;
  severity: HazardSeverity;
  confidence: number;
  distinct_devices: number;
  spike_rate: number;
  status: 'active' | 'repaired' | 'disputed';
  defect_type?: HazardKind;
  lane?: Lane;
  first_seen?: string;
  last_seen?: string;
}

type RoughnessFilter = 'all' | 'severe' | 'rough' | 'wear' | 'smooth';

export default function RoadNetworkQuality() {
  const [roadCells, setRoadCells] = useState<RoadCellRow[]>([]);
  const [defects, setDefects] = useState<DefectItem[]>([]);
  const [selectedCell, setSelectedCell] = useState<RoadCellRow | null>(null);
  const [selectedDefect, setSelectedDefect] = useState<DefectItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roughnessFilter, setRoughnessFilter] = useState<RoughnessFilter>('all');
  const [mapCenter, setMapCenter] = useState<[number, number]>([6.915, 79.852]);
  const [mapZoom, setMapZoom] = useState<number>(14);

  // Disturbance Painter State
  const [activeMode, setActiveMode] = useState<PainterMode>('inspect');
  const [defectType, setDefectType] = useState<HazardKind>('pothole');
  const [defectSeverity, setDefectSeverity] = useState<HazardSeverity>('high');
  const [defectLane, setDefectLane] = useState<Lane>('left');
  const [cellRoughness, setCellRoughness] = useState<number>(85);
  const [cellSpikes, setCellSpikes] = useState<number>(8);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);

  // Fetch both Road Cells and Confirmed Road Defects
  const loadNetworkData = useCallback(async () => {
    try {
      setLoading(true);

      const [cellsRes, defectsRes] = await Promise.all([
        supabase
          .from('road_cells')
          .select('*')
          .order('roughness_index', { ascending: false })
          .limit(300),
        supabase
          .from('road_defects')
          .select('*')
          .order('first_seen', { ascending: false })
          .limit(200),
      ]);

      if (cellsRes.data && !cellsRes.error) {
        const mappedCells: RoadCellRow[] = cellsRes.data.map((c: any) => {
          let lat = c.centroid_lat ? Number(c.centroid_lat) : undefined;
          let lon = c.centroid_lon ? Number(c.centroid_lon) : undefined;
          if ((lat === undefined || lon === undefined) && c.h3_12) {
            try {
              const coords = cellToLatLng(c.h3_12);
              lat = coords[0];
              lon = coords[1];
            } catch {
              // ignore
            }
          }

          return {
            h3_12: String(c.h3_12 || ''),
            heading_sector:
              c.heading_sector !== null && c.heading_sector !== undefined
                ? Number(c.heading_sector)
                : undefined,
            centroid_lat: lat,
            centroid_lon: lon,
            roughness_index: Number(c.roughness_index ?? 0),
            pass_count: Number(c.pass_count ?? 0),
            device_count:
              c.device_count !== null && c.device_count !== undefined
                ? Number(c.device_count)
                : undefined,
            spike_count: Number(c.spike_count ?? 0),
            speed_p85_kmh: Number(c.speed_p85_kmh ?? 0),
            defect_confidence: Number(c.defect_confidence ?? 0),
            rough_mean:
              c.rough_mean !== null && c.rough_mean !== undefined
                ? Number(c.rough_mean)
                : undefined,
            last_pass_at: c.last_pass_at ? String(c.last_pass_at) : undefined,
            updated_at: c.updated_at ? String(c.updated_at) : undefined,
          };
        });

        setRoadCells(mappedCells);

        if (mappedCells.length > 0 && !selectedCell) {
          setSelectedCell(mappedCells[0]);
          if (mappedCells[0].centroid_lat && mappedCells[0].centroid_lon) {
            setMapCenter([mappedCells[0].centroid_lat, mappedCells[0].centroid_lon]);
          }
        }
      }

      if (defectsRes.data && !defectsRes.error) {
        const mappedDefects: DefectItem[] = defectsRes.data.map((d: any, idx: number) => {
          let lat = Number(d.lat ?? 0);
          let lon = Number(d.lon ?? 0);
          if ((!lat || !lon) && d.h3_12) {
            try {
              const coords = cellToLatLng(d.h3_12);
              lat = coords[0];
              lon = coords[1];
            } catch {
              // ignore
            }
          }

          return {
            id: String(d.id || `def-${idx}`),
            h3_12: String(d.h3_12 || ''),
            heading_sector: Number(d.heading_sector ?? 0),
            lat,
            lon,
            severity: (d.severity as any) || 'high',
            confidence: Number(d.confidence ?? 0.85),
            distinct_devices: Number(d.distinct_devices ?? 3),
            spike_rate: Number(d.spike_rate ?? 0.8),
            status: (d.status as any) || 'active',
            first_seen: d.first_seen ? String(d.first_seen) : undefined,
            last_seen: d.last_seen ? String(d.last_seen) : undefined,
          };
        });

        setDefects(mappedDefects);
      }
    } catch (err) {
      console.error('Error loading road network data:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedCell]);

  useEffect(() => {
    loadNetworkData();
  }, [loadNetworkData]);

  // Handle cell selection
  const handleSelectCell = (cell: RoadCellRow) => {
    setSelectedCell(cell);
    if (cell.centroid_lat && cell.centroid_lon) {
      setMapCenter([cell.centroid_lat, cell.centroid_lon]);
      setMapZoom(16);
    } else {
      try {
        const [lat, lon] = cellToLatLng(cell.h3_12);
        setMapCenter([lat, lon]);
        setMapZoom(16);
      } catch {
        // ignore
      }
    }
  };

  // Handle Map Click based on Active Tool Mode
  const handleMapClick = async (coords: [number, number]) => {
    const [lat, lon] = coords;
    let h3_12: string;
    try {
      h3_12 = latLngToCell(lat, lon, 12);
    } catch (e) {
      console.error('Failed to compute H3 res 12 cell for coords:', e);
      return;
    }

    if (activeMode === 'inspect') {
      // Find matching cell
      const matched = roadCells.find((c) => c.h3_12 === h3_12);
      if (matched) {
        handleSelectCell(matched);
      } else {
        // Create virtual preview cell
        const virtualCell: RoadCellRow = {
          h3_12,
          centroid_lat: lat,
          centroid_lon: lon,
          roughness_index: 10,
          pass_count: 0,
          spike_count: 0,
          speed_p85_kmh: 0,
          defect_confidence: 0,
        };
        setSelectedCell(virtualCell);
      }
      return;
    }

    if (activeMode === 'place_defect') {
      setIsSaving(true);
      const newDefectId = `def_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const nowIso = new Date().toISOString();

      const defectPayload = {
        h3_12,
        heading_sector: 0,
        lat,
        lon,
        severity: defectSeverity,
        confidence:
          defectSeverity === 'critical'
            ? 0.95
            : defectSeverity === 'high'
            ? 0.88
            : defectSeverity === 'medium'
            ? 0.75
            : 0.6,
        distinct_devices: 3,
        spike_rate:
          defectSeverity === 'critical' ? 0.9 : defectSeverity === 'high' ? 0.75 : 0.5,
        status: 'active',
        first_seen: nowIso,
        last_seen: nowIso,
      };

      const newDefectItem: DefectItem = {
        id: newDefectId,
        h3_12,
        heading_sector: 0,
        lat,
        lon,
        severity: defectSeverity,
        confidence: defectPayload.confidence,
        distinct_devices: 3,
        spike_rate: defectPayload.spike_rate,
        status: 'active',
        defect_type: defectType,
        lane: defectLane,
        first_seen: nowIso,
        last_seen: nowIso,
      };

      // Also compute paired cell roughness
      const defaultCellRoughness =
        defectSeverity === 'critical' ? 92 : defectSeverity === 'high' ? 82 : defectSeverity === 'medium' ? 62 : 38;
      const cellPayload = {
        h3_12,
        heading_sector: 0,
        centroid_lat: lat,
        centroid_lon: lon,
        roughness_index: defaultCellRoughness,
        pass_count: 14,
        device_count: 3,
        spike_count: defectSeverity === 'critical' ? 12 : 7,
        speed_p85_kmh: 42,
        defect_confidence: 0.9,
        updated_at: nowIso,
      };

      // Optimistic local update
      setDefects((prev) => [newDefectItem, ...prev.filter((d) => d.h3_12 !== h3_12)]);
      setRoadCells((prev) => {
        const exists = prev.find((c) => c.h3_12 === h3_12);
        if (exists) {
          return prev.map((c) =>
            c.h3_12 === h3_12
              ? {
                  ...c,
                  roughness_index: defaultCellRoughness,
                  spike_count: Math.max(c.spike_count, 6),
                  updated_at: nowIso,
                }
              : c
          );
        }
        return [cellPayload, ...prev];
      });
      setSelectedDefect(newDefectItem);

      try {
        await Promise.allSettled([
          supabase
            .from('road_defects')
            .upsert(defectPayload, { onConflict: 'h3_12,heading_sector' }),
          supabase
            .from('road_cells')
            .upsert(cellPayload, { onConflict: 'h3_12,heading_sector' }),
        ]);
        setSaveStatus(`Placed ${defectSeverity.toUpperCase()} ${defectType.replace('_', ' ')}`);
      } catch (err) {
        console.warn('Database write fell back to local state:', err);
        setSaveStatus(`Placed locally (${h3_12.slice(0, 8)}...)`);
      } finally {
        setIsSaving(false);
        setTimeout(() => setSaveStatus(null), 3500);
      }
      return;
    }

    if (activeMode === 'paint_cell') {
      setIsSaving(true);
      const nowIso = new Date().toISOString();
      const cellPayload = {
        h3_12,
        heading_sector: 0,
        centroid_lat: lat,
        centroid_lon: lon,
        roughness_index: cellRoughness,
        pass_count: Math.max(cellSpikes + 6, 12),
        device_count: 3,
        spike_count: cellSpikes,
        speed_p85_kmh: 45,
        defect_confidence: cellRoughness >= 60 ? 0.85 : 0.2,
        updated_at: nowIso,
      };

      // Optimistic local update
      setRoadCells((prev) => {
        const exists = prev.find((c) => c.h3_12 === h3_12);
        if (exists) {
          return prev.map((c) =>
            c.h3_12 === h3_12
              ? {
                  ...c,
                  roughness_index: cellRoughness,
                  spike_count: cellSpikes,
                  updated_at: nowIso,
                }
              : c
          );
        }
        return [cellPayload, ...prev];
      });

      try {
        await supabase
          .from('road_cells')
          .upsert(cellPayload, { onConflict: 'h3_12,heading_sector' });
        setSaveStatus(`Painted Cell: ${cellRoughness} IRI`);
      } catch (err) {
        console.warn('Database write fell back to local state:', err);
        setSaveStatus(`Painted locally (${cellRoughness} IRI)`);
      } finally {
        setIsSaving(false);
        setTimeout(() => setSaveStatus(null), 3500);
      }
      return;
    }

    if (activeMode === 'repair') {
      setIsSaving(true);
      const nowIso = new Date().toISOString();

      // Mark defects on this cell as repaired
      setDefects((prev) =>
        prev.map((d) => (d.h3_12 === h3_12 ? { ...d, status: 'repaired' } : d))
      );

      // Smooth cell
      setRoadCells((prev) =>
        prev.map((c) =>
          c.h3_12 === h3_12
            ? {
                ...c,
                roughness_index: 10,
                spike_count: 0,
                defect_confidence: 0,
                updated_at: nowIso,
              }
            : c
        )
      );

      try {
        await Promise.allSettled([
          supabase
            .from('road_defects')
            .update({ status: 'repaired', last_seen: nowIso })
            .eq('h3_12', h3_12),
          supabase
            .from('road_cells')
            .update({ roughness_index: 10, spike_count: 0, defect_confidence: 0, updated_at: nowIso })
            .eq('h3_12', h3_12),
        ]);
        setSaveStatus('Marked Repaired & Smoothed Cell');
      } catch (err) {
        console.warn('Repair write fallback:', err);
        setSaveStatus('Marked repaired locally');
      } finally {
        setIsSaving(false);
        setTimeout(() => setSaveStatus(null), 3500);
      }
      return;
    }
  };

  // Filtered cells list
  const filteredCells = useMemo(() => {
    return roadCells.filter((c) => {
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        if (!c.h3_12.toLowerCase().includes(query)) return false;
      }

      if (roughnessFilter === 'severe') return c.roughness_index >= 80;
      if (roughnessFilter === 'rough') return c.roughness_index >= 55 && c.roughness_index < 80;
      if (roughnessFilter === 'wear') return c.roughness_index >= 25 && c.roughness_index < 55;
      if (roughnessFilter === 'smooth') return c.roughness_index < 25;

      return true;
    });
  }, [roadCells, searchQuery, roughnessFilter]);

  // Map hexagons with genuine H3 boundary polygons
  const mapHexagons: MapHexagon[] = useMemo(() => {
    const list: MapHexagon[] = [];

    for (let idx = 0; idx < filteredCells.length; idx++) {
      const cell = filteredCells[idx];
      if (!cell.h3_12) continue;
      let boundary: [number, number][] = [];
      try {
        boundary = cellToBoundary(cell.h3_12);
      } catch {
        continue;
      }
      if (!boundary || boundary.length === 0) continue;

      let color = '#22c55e';
      if (cell.roughness_index >= 80) color = '#ef4444';
      else if (cell.roughness_index >= 55) color = '#f97316';
      else if (cell.roughness_index >= 25) color = '#eab308';

      const isSelected =
        selectedCell?.h3_12 === cell.h3_12 &&
        (selectedCell?.heading_sector === undefined || selectedCell?.heading_sector === cell.heading_sector);

      const hexId = cell.heading_sector !== undefined ? `${cell.h3_12}_${cell.heading_sector}` : `${cell.h3_12}_${idx}`;

      list.push({
        id: hexId,
        boundary,
        color: isSelected ? '#38bdf8' : color,
        fillOpacity: isSelected ? 0.75 : 0.45,
        roughnessIndex: cell.roughness_index,
        passCount: cell.pass_count,
        spikeCount: cell.spike_count,
        speedP85: cell.speed_p85_kmh,
        defectConfidence: cell.defect_confidence,
        tooltipText: `H3: ${cell.h3_12}${cell.heading_sector !== undefined ? ` (Sector ${cell.heading_sector})` : ''} | Roughness: ${cell.roughness_index.toFixed(1)}/100 | Passes: ${cell.pass_count}`,
      });
    }

    return list;
  }, [filteredCells, selectedCell]);

  // Map Markers for Pinpoint Defects
  const mapDefectMarkers = useMemo<MapMarker[]>(() => {
    return defects
      .filter((d) => d.status === 'active' && Number.isFinite(d.lat) && Number.isFinite(d.lon))
      .map((d) => {
        let color = '#ef4444';
        if (d.severity === 'high') color = '#f97316';
        else if (d.severity === 'medium') color = '#eab308';
        else if (d.severity === 'low') color = '#38bdf8';

        return {
          id: d.id,
          lat: d.lat,
          lon: d.lon,
          title: `Defect: ${d.severity.toUpperCase()}`,
          type: 'defect',
          severity: d.severity,
          color,
          details: `H3: ${d.h3_12} · Spikes: ${(d.spike_rate * 100).toFixed(0)}% · Status: ${d.status}`,
          confidence: d.confidence,
        };
      });
  }, [defects]);

  // Roughness stats summary
  const stats = useMemo(() => {
    const total = roadCells.length;
    if (total === 0)
      return { severe: 0, rough: 0, wear: 0, smooth: 0, avgIri: '0.0', defectsCount: defects.length };
    const severe = roadCells.filter((c) => c.roughness_index >= 80).length;
    const rough = roadCells.filter((c) => c.roughness_index >= 55 && c.roughness_index < 80).length;
    const wear = roadCells.filter((c) => c.roughness_index >= 25 && c.roughness_index < 55).length;
    const smooth = roadCells.filter((c) => c.roughness_index < 25).length;
    const avgIri = (roadCells.reduce((a, b) => a + b.roughness_index, 0) / total).toFixed(1);
    const activeDefects = defects.filter((d) => d.status === 'active').length;
    return { severe, rough, wear, smooth, avgIri, defectsCount: activeDefects };
  }, [roadCells, defects]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-black text-white font-sans text-xs">
      <Header
        title="Road Quality Map & Disturbance Painter"
        subtitle="H3 grid spatial surface quality heatmap, disturbance painter & real-time cockpit lookahead"
      />

      {/* Navigation Subheader & Color Legend */}
      <div className="bg-black border-b border-zinc-800 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800 font-mono text-[11px]">
          <Link href="/road-network" className="px-3 py-1 rounded-md bg-zinc-800 text-white font-semibold">
            H3 Grid & Painter
          </Link>
          <Link
            href="/road-network/defects"
            className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors"
          >
            Defects Inventory
          </Link>
          <Link
            href="/road-network/predictions"
            className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors"
          >
            Hazard Predictions
          </Link>
        </div>

        <div className="flex items-center gap-4 font-mono text-[11px] text-zinc-400">
          <button
            type="button"
            onClick={() => setRoughnessFilter(roughnessFilter === 'smooth' ? 'all' : 'smooth')}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${
              roughnessFilter === 'smooth'
                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                : 'hover:text-zinc-200'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span>
              Smooth (0-25) <span className="text-zinc-500">[{stats.smooth}]</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setRoughnessFilter(roughnessFilter === 'wear' ? 'all' : 'wear')}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${
              roughnessFilter === 'wear'
                ? 'bg-yellow-950 text-yellow-400 border border-yellow-800'
                : 'hover:text-zinc-200'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 inline-block" />
            <span>
              Wear (26-55) <span className="text-zinc-500">[{stats.wear}]</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setRoughnessFilter(roughnessFilter === 'rough' ? 'all' : 'rough')}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${
              roughnessFilter === 'rough'
                ? 'bg-orange-950 text-orange-400 border border-orange-800'
                : 'hover:text-zinc-200'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" />
            <span>
              Rough (56-80) <span className="text-zinc-500">[{stats.rough}]</span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => setRoughnessFilter(roughnessFilter === 'severe' ? 'all' : 'severe')}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors ${
              roughnessFilter === 'severe'
                ? 'bg-rose-950 text-rose-400 border border-rose-800'
                : 'hover:text-zinc-200'
            }`}
          >
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
            <span className="text-white font-bold">
              Severe (&gt;80) <span className="text-rose-300">[{stats.severe}]</span>
            </span>
          </button>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden p-3 gap-3 min-h-0">
        {/* Left / Center Map Section */}
        <div className="flex-1 flex flex-col gap-2 min-h-0">
          {/* Disturbance Painter Toolbar */}
          <RoadDisturbanceToolbar
            activeMode={activeMode}
            onModeChange={setActiveMode}
            defectType={defectType}
            onDefectTypeChange={setDefectType}
            defectSeverity={defectSeverity}
            onDefectSeverityChange={setDefectSeverity}
            defectLane={defectLane}
            onDefectLaneChange={setDefectLane}
            cellRoughness={cellRoughness}
            onCellRoughnessChange={setCellRoughness}
            cellSpikes={cellSpikes}
            onCellSpikesChange={setCellSpikes}
            isSaving={isSaving}
            saveStatus={saveStatus}
            stats={{
              defectsCount: stats.defectsCount,
              cellsCount: roadCells.length,
              severeCount: stats.severe,
            }}
          />

          {/* Map Canvas */}
          <div className="flex-1 rounded-md border border-zinc-800 overflow-hidden bg-zinc-950 relative min-h-[360px]">
            <OSMMap
              center={mapCenter}
              zoom={mapZoom}
              hexagons={mapHexagons}
              markers={mapDefectMarkers}
              onMapClick={handleMapClick}
              onHexagonClick={(hex) => {
                const matched = roadCells.find((c) => {
                  const hexId =
                    c.heading_sector !== undefined ? `${c.h3_12}_${c.heading_sector}` : c.h3_12;
                  return hexId === hex.id || c.h3_12 === hex.id;
                });
                if (matched) {
                  if (activeMode === 'inspect') {
                    handleSelectCell(matched);
                  } else if (matched.centroid_lat && matched.centroid_lon) {
                    handleMapClick([matched.centroid_lat, matched.centroid_lon]);
                  }
                }
              }}
              onMarkerClick={(marker) => {
                const matched = defects.find((d) => d.id === marker.id);
                if (matched) {
                  if (activeMode === 'repair') {
                    handleMapClick([matched.lat, matched.lon]);
                  } else {
                    setSelectedDefect(matched);
                  }
                }
              }}
            />

            {/* Quick Floating Map Overlay */}
            <div className="absolute top-3 left-3 z-10 bg-zinc-950/90 border border-zinc-800 rounded px-3 py-2 text-[11px] font-mono backdrop-blur flex items-center gap-3">
              <span className="text-zinc-400">Mean Fleet IRI Index:</span>
              <span className="font-bold text-emerald-400 text-xs">{stats.avgIri} / 100</span>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-400">Resolution:</span>
              <span className="text-zinc-200">H3 Res-12 (~9.4m)</span>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-400">Active Defects:</span>
              <span className="text-rose-400 font-bold">{stats.defectsCount}</span>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Cell Browser & Inspector */}
        <div className="w-full lg:w-84 bg-zinc-950 border border-zinc-800 rounded-md flex flex-col overflow-hidden shrink-0">
          {/* Header & Controls */}
          <div className="p-3 border-b border-zinc-800 flex items-center justify-between font-mono text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold text-zinc-300 uppercase tracking-wider">
              <Layers size={13} className="text-emerald-400" />
              Spatial Grid Inspector
            </span>
            <button
              onClick={loadNetworkData}
              className="text-zinc-500 hover:text-white transition-colors p-1"
              title="Refresh road cells and defects"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Search & Filter Bar */}
          <div className="p-2.5 border-b border-zinc-800/80 bg-black/40 space-y-2">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search H3-12 cell index..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded pl-7 pr-2.5 py-1 text-zinc-200 font-mono text-[11px] focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600"
              />
            </div>

            <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
              <span>
                Showing {filteredCells.length} of {roadCells.length} cells
              </span>
              {roughnessFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setRoughnessFilter('all')}
                  className="text-emerald-400 hover:underline"
                >
                  Clear filter
                </button>
              )}
            </div>
          </div>

          {/* Active Cell / Defect Inspector */}
          <div className="p-3 border-b border-zinc-800 bg-zinc-900/30 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-zinc-400 text-[10px] uppercase font-mono font-semibold">
                Active Selection
              </span>
              {selectedCell && (
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                    selectedCell.roughness_index >= 80
                      ? 'bg-rose-950 text-rose-400 border border-rose-800'
                      : selectedCell.roughness_index >= 55
                      ? 'bg-orange-950 text-orange-400 border border-orange-800'
                      : selectedCell.roughness_index >= 25
                      ? 'bg-yellow-950 text-yellow-400 border border-yellow-800'
                      : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  }`}
                >
                  {selectedCell.roughness_index >= 80
                    ? 'SEVERE DAMAGE'
                    : selectedCell.roughness_index >= 55
                    ? 'ROUGH'
                    : selectedCell.roughness_index >= 25
                    ? 'MODERATE WEAR'
                    : 'SMOOTH'}
                </span>
              )}
            </div>

            {selectedCell ? (
              <div className="bg-black p-2.5 rounded border border-zinc-800 space-y-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-emerald-400 truncate select-all">
                      {selectedCell.h3_12}
                    </span>
                    {selectedCell.heading_sector !== undefined && (
                      <span className="text-[10px] text-zinc-500 font-mono flex items-center gap-1">
                        <Compass size={10} /> Sec {selectedCell.heading_sector}
                      </span>
                    )}
                  </div>
                  {selectedCell.centroid_lat && selectedCell.centroid_lon && (
                    <span className="text-[10px] text-zinc-500 font-mono block">
                      {selectedCell.centroid_lat.toFixed(5)}, {selectedCell.centroid_lon.toFixed(5)}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-900 text-[10px] font-mono">
                  <div>
                    <span className="text-zinc-500 block">Roughness Index</span>
                    <span className="text-white font-bold text-xs">
                      {selectedCell.roughness_index.toFixed(1)} / 100
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Fleet Passes</span>
                    <span className="text-white font-bold text-xs">{selectedCell.pass_count}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Distinct Devices</span>
                    <span className="text-white font-bold">{selectedCell.device_count ?? 1}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Spikes Logged</span>
                    <span
                      className={
                        selectedCell.spike_count > 0 ? 'text-rose-400 font-bold' : 'text-zinc-400'
                      }
                    >
                      {selectedCell.spike_count}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">P85 Speed</span>
                    <span className="text-zinc-200 font-bold">
                      {selectedCell.speed_p85_kmh.toFixed(1)} km/h
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Defect Prob</span>
                    <span className="text-zinc-200 font-bold">
                      {(selectedCell.defect_confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {selectedCell.last_pass_at && (
                  <div className="pt-1.5 border-t border-zinc-900 text-[9px] text-zinc-500 font-mono">
                    Last Pass: {new Date(selectedCell.last_pass_at).toLocaleString()}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 bg-black rounded border border-zinc-800 text-center text-zinc-500 text-[11px]">
                {loading ? 'Ingesting spatial grid...' : 'No road cells registered.'}
              </div>
            )}
          </div>

          {/* Cell List Browser */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
            <div className="px-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider font-semibold">
              Spatial Grid Cells
            </div>

            {filteredCells.length === 0 ? (
              <div className="p-4 text-center text-zinc-600 font-mono text-[11px]">
                No matching cells found.
              </div>
            ) : (
              filteredCells.map((cell, idx) => {
                const isSelected =
                  selectedCell?.h3_12 === cell.h3_12 &&
                  (selectedCell?.heading_sector === undefined ||
                    selectedCell?.heading_sector === cell.heading_sector);
                const cellKey =
                  cell.heading_sector !== undefined
                    ? `cell-${cell.h3_12}-s${cell.heading_sector}-${idx}`
                    : `cell-${cell.h3_12}-${idx}`;

                return (
                  <div
                    key={cellKey}
                    onClick={() => handleSelectCell(cell)}
                    className={`p-2 rounded border cursor-pointer transition-colors font-mono text-[11px] flex items-center justify-between ${
                      isSelected
                        ? 'bg-zinc-900 border-emerald-500/80 text-white shadow-sm'
                        : 'bg-zinc-950/60 border-zinc-800/80 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/40'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-semibold text-zinc-200 text-xs truncate flex items-center gap-1.5">
                        <span>{cell.h3_12}</span>
                        {cell.heading_sector !== undefined && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 font-normal">
                            sec {cell.heading_sector}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500 flex items-center gap-2 pt-0.5">
                        <span>{cell.pass_count} passes</span>
                        <span>·</span>
                        <span>{cell.spike_count} spikes</span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div
                        className={`text-xs font-bold ${
                          cell.roughness_index >= 80
                            ? 'text-rose-400'
                            : cell.roughness_index >= 55
                            ? 'text-orange-400'
                            : cell.roughness_index >= 25
                            ? 'text-yellow-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {cell.roughness_index.toFixed(1)}
                      </div>
                      <div className="text-[9px] text-zinc-500">IRI proxy</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
