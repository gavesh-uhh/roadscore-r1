'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { OSMMap, MapMarker, MapPolyline } from '@/components/map/OSMMap';
import { createClient } from '@/lib/supabase/client';
import { cellToLatLng } from 'h3-js';
import {
  ShieldCheck,
  Target,
  AlertTriangle,
  ArrowRight,
  Activity,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Filter,
  Layers,
  Zap,
  RefreshCw,
  Search,
  Crosshair,
  Compass,
} from 'lucide-react';
import { formatEventType } from '@/lib/events/format';

interface PredictionRow {
  id: string;
  device_id: string;
  trip_id: string;
  issued_at: string;
  type: string;
  target_defect_id: string | null;
  target_h3_12: string;
  distance_m: number;
  eta_s: number;
  confidence: number;
  outcome: 'hit' | 'miss' | 'not_traversed' | 'pending';
  outcome_event_id?: string | null;
  outcome_checked_at?: string | null;
  lat?: number;
  lon?: number;
  target_lat?: number;
  target_lon?: number;
}

export default function PredictionsAndVerification() {
  const [predictions, setPredictions] = useState<PredictionRow[]>([]);
  const [defects, setDefects] = useState<any[]>([]);
  const [selectedPrediction, setSelectedPrediction] = useState<PredictionRow | null>(null);
  const [filterOutcome, setFilterOutcome] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewTab, setViewTab] = useState<'table' | 'map' | 'split'>('split');
  const [loading, setLoading] = useState(true);
  const [mapCenter, setMapCenter] = useState<[number, number]>([6.915, 79.852]);
  const [mapZoom, setMapZoom] = useState<number>(14);

  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      // 1. Fetch predictions
      const { data: predData, error: predErr } = await supabase
        .from('predictions')
        .select('*')
        .order('issued_at', { ascending: false })
        .limit(100);

      // 2. Fetch road defects for spatial reference
      const { data: defectData } = await supabase
        .from('road_defects')
        .select('*')
        .limit(100);

      if (defectData) setDefects(defectData);

      if (predData && !predErr) {
        // 3. Fetch linked outcome events if any exist to get ground-truth coordinates
        const eventIds = predData
          .map((r: any) => r.outcome_event_id)
          .filter((id: any) => Boolean(id));

        let eventMap = new Map<string, { lat: number; lon: number }>();
        if (eventIds.length > 0) {
          const { data: eventRows } = await supabase
            .from('driving_events')
            .select('id, lat, lon')
            .in('id', eventIds);

          if (eventRows) {
            for (const ev of eventRows) {
              if (ev.lat && ev.lon) {
                eventMap.set(ev.id, { lat: Number(ev.lat), lon: Number(ev.lon) });
              }
            }
          }
        }

        const mappedData: PredictionRow[] = predData.map((r: any) => {
          const matchedDefect = defectData?.find((d) => d.id === r.target_defect_id);

          // Real target coordinates: from matched defect or H3 centroid calculation
          let targetLat: number | undefined = matchedDefect?.lat ? Number(matchedDefect.lat) : undefined;
          let targetLon: number | undefined = matchedDefect?.lon ? Number(matchedDefect.lon) : undefined;

          if ((targetLat === undefined || targetLon === undefined) && r.target_h3_12) {
            try {
              const [hLat, hLon] = cellToLatLng(r.target_h3_12);
              targetLat = hLat;
              targetLon = hLon;
            } catch {
              // ignore
            }
          }

          // Real origin coordinates: from outcome event if available or real telemetry
          let originLat: number | undefined = undefined;
          let originLon: number | undefined = undefined;
          if (r.outcome_event_id && eventMap.has(r.outcome_event_id)) {
            const ev = eventMap.get(r.outcome_event_id)!;
            originLat = ev.lat;
            originLon = ev.lon;
          }

          return {
            id: String(r.id || ''),
            device_id: String(r.device_id || ''),
            trip_id: String(r.trip_id || ''),
            issued_at: String(r.issued_at || ''),
            type: String(r.type || 'road.hazard_ahead'),
            target_defect_id: r.target_defect_id ? String(r.target_defect_id) : null,
            target_h3_12: String(r.target_h3_12 || 'N/A'),
            distance_m: Number(r.distance_m ?? 0),
            eta_s: Number(r.eta_s ?? 0),
            confidence: Number(r.confidence ?? 0),
            outcome: (r.outcome as any) || 'pending',
            outcome_event_id: r.outcome_event_id ? String(r.outcome_event_id) : null,
            outcome_checked_at: r.outcome_checked_at ? String(r.outcome_checked_at) : null,
            lat: originLat,
            lon: originLon,
            target_lat: targetLat,
            target_lon: targetLon,
          };
        });

        setPredictions(mappedData);

        // Center map dynamically on first valid target
        const firstTarget = mappedData.find((p) => p.target_lat && p.target_lon);
        if (firstTarget && firstTarget.target_lat && firstTarget.target_lon) {
          setMapCenter([firstTarget.target_lat, firstTarget.target_lon]);
        }
      }
    } catch (err) {
      console.error('Error loading prediction auditor data:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle prediction row selection
  const handleSelectPrediction = (p: PredictionRow) => {
    setSelectedPrediction(p);
    if (p.target_lat && p.target_lon) {
      setMapCenter([p.target_lat, p.target_lon]);
      setMapZoom(16);
    }
  };

  // Filtered Predictions
  const filteredPredictions = useMemo(() => {
    return predictions.filter((p) => {
      if (filterOutcome !== 'all' && p.outcome !== filterOutcome) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesH3 = p.target_h3_12.toLowerCase().includes(query);
        const matchesId = p.id.toLowerCase().includes(query);
        const matchesDevice = p.device_id.toLowerCase().includes(query);
        if (!matchesH3 && !matchesId && !matchesDevice) return false;
      }
      return true;
    });
  }, [predictions, filterOutcome, searchQuery]);

  // Real Executive Compliance & Accuracy Metrics (No Fake Fallbacks)
  const metrics = useMemo(() => {
    const total = predictions.length;
    const hitCount = predictions.filter((p) => p.outcome === 'hit').length;
    const missCount = predictions.filter((p) => p.outcome === 'miss').length;
    const notTraversedCount = predictions.filter((p) => p.outcome === 'not_traversed').length;
    const pendingCount = predictions.filter((p) => p.outcome === 'pending').length;

    const evaluated = hitCount + missCount;
    // Ground truth precision over traversed warnings (0.0% when empty)
    const precisionRate = evaluated > 0 ? ((hitCount / evaluated) * 100).toFixed(1) : '0.0';

    // Driver Hazard Evasion Rate: miss represents vehicle traversing without harsh impact
    const evasionRate = evaluated > 0 ? ((missCount / evaluated) * 100).toFixed(1) : '0.0';

    const avgLookaheadDistance =
      total > 0
        ? (predictions.reduce((acc, p) => acc + p.distance_m, 0) / total).toFixed(0)
        : '0';

    return {
      total,
      hitCount,
      missCount,
      notTraversedCount,
      pendingCount,
      precisionRate,
      evasionRate,
      avgLookaheadDistance,
    };
  }, [predictions]);

  // Map Markers & Projection Rays (Only using verified spatial coordinates)
  const mapMarkers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = [];

    // 1. Add defect targets from road_defects
    for (const d of defects) {
      let dLat = Number(d.lat ?? 0);
      let dLon = Number(d.lon ?? 0);
      if ((!dLat || !dLon) && d.h3_12) {
        try {
          const [hLat, hLon] = cellToLatLng(d.h3_12);
          dLat = hLat;
          dLon = hLon;
        } catch {
          // ignore
        }
      }

      if (dLat !== 0 && dLon !== 0) {
        list.push({
          id: `defect-${d.id}`,
          type: 'defect',
          lat: dLat,
          lon: dLon,
          title: `Confirmed Hazard`,
          severity: d.severity || 'high',
          confidence: d.confidence,
          h3_12: d.h3_12,
          details: `Target Defect #${String(d.id).slice(0, 8)} | Consensus: ${d.distinct_devices ?? 1} devices`,
        });
      }
    }

    // 2. Add prediction targets from active queue
    for (const p of filteredPredictions) {
      if (p.target_lat && p.target_lon) {
        const isSelected = selectedPrediction?.id === p.id;
        list.push({
          id: `pred-target-${p.id}`,
          type: 'prediction',
          lat: p.target_lat,
          lon: p.target_lon,
          title: `Predicted Hazard: ${formatEventType(p.type).label}`,
          severity: p.outcome === 'hit' ? 'critical' : p.outcome === 'miss' ? 'medium' : 'high',
          confidence: p.confidence,
          h3_12: p.target_h3_12,
          details: `Prediction #${p.id.slice(0, 8)} | ETA: ${p.eta_s}s | Outcome: ${p.outcome.toUpperCase()}`,
        });
      }

      // Add vehicle origin point if real coordinates exist
      if (p.lat && p.lon) {
        list.push({
          id: `pred-origin-${p.id}`,
          type: 'event',
          lat: p.lat,
          lon: p.lon,
          title: `Vehicle Position: ${p.device_id}`,
          severity: p.outcome === 'hit' ? 'critical' : 'info',
          details: `Distance: ${p.distance_m}m | Outcome: ${p.outcome.toUpperCase()}`,
        });
      }
    }

    return list;
  }, [defects, filteredPredictions, selectedPrediction]);

  // Build lookahead projection rays connecting vehicle to predicted hazard (only when real origin and target exist)
  const mapPolylines: MapPolyline[] = useMemo(() => {
    return filteredPredictions
      .filter((p) => p.lat && p.lon && p.target_lat && p.target_lon)
      .slice(0, 30)
      .map((p) => ({
        id: `ray-${p.id}`,
        positions: [
          [p.lat!, p.lon!],
          [p.target_lat!, p.target_lon!],
        ],
        color: p.outcome === 'hit' ? '#ef4444' : p.outcome === 'miss' ? '#10b981' : '#38bdf8',
        weight: 2,
        dashArray: '4, 4',
      }));
  }, [filteredPredictions]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-black text-white font-sans text-xs">
      <Header
        title="Hazard Predictions & Compliance Auditor"
        subtitle="Proactive lookahead cone warnings, driver reaction evasion rates, and ground-truth verification"
      />

      {/* Navigation Sub-Bar */}
      <div className="bg-black border-b border-zinc-800 px-4 py-2 flex items-center justify-between shrink-0 font-mono text-[11px]">
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800">
          <Link href="/road-network" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            H3 Grid
          </Link>
          <Link href="/road-network/defects" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            Defects Inventory
          </Link>
          <Link href="/road-network/predictions" className="px-3 py-1 rounded-md bg-zinc-800 text-white font-semibold">
            Hazard Predictions
          </Link>
        </div>

        {/* View Switcher & Refresh */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded p-0.5">
            <button
              onClick={() => setViewTab('split')}
              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors flex items-center gap-1 ${
                viewTab === 'split' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Layers size={11} />
              <span>Split View</span>
            </button>
            <button
              onClick={() => setViewTab('table')}
              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors flex items-center gap-1 ${
                viewTab === 'table' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Filter size={11} />
              <span>Audit Table</span>
            </button>
            <button
              onClick={() => setViewTab('map')}
              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors flex items-center gap-1 ${
                viewTab === 'map' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Zap size={11} />
              <span>Spatial Cone Map</span>
            </button>
          </div>

          <button
            onClick={loadData}
            className="p-1.5 rounded border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white transition-colors"
            title="Refresh predictions"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* KPI Ribbon */}
      <div className="p-3 bg-zinc-950 border-b border-zinc-900 grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        <div className="bg-black/60 border border-zinc-800/80 rounded-md p-2.5">
          <span className="text-[10px] text-zinc-400 uppercase font-mono block">Lookahead Warnings</span>
          <div className="text-xl font-bold font-mono text-white mt-0.5">{metrics.total}</div>
          <span className="text-[9px] text-zinc-500 font-mono">
            {metrics.total > 0 ? `Avg Horizon: ${metrics.avgLookaheadDistance}m` : 'No active warnings'}
          </span>
        </div>

        <div className="bg-black/60 border border-zinc-800/80 rounded-md p-2.5">
          <span className="text-[10px] text-emerald-400 uppercase font-mono block">Driver Evasion Rate</span>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">{metrics.evasionRate}%</div>
          <span className="text-[9px] text-zinc-500 font-mono">Slowed & avoided cavity</span>
        </div>

        <div className="bg-black/60 border border-zinc-800/80 rounded-md p-2.5">
          <span className="text-[10px] text-sky-400 uppercase font-mono block">Predictor Precision</span>
          <div className="text-xl font-bold font-mono text-sky-400 mt-0.5">{metrics.precisionRate}%</div>
          <span className="text-[9px] text-zinc-500 font-mono">Ground-truth verified</span>
        </div>

        <div className="bg-black/60 border border-zinc-800/80 rounded-md p-2.5">
          <span className="text-[10px] text-amber-400 uppercase font-mono block">Impact Strikes</span>
          <div className="text-xl font-bold font-mono text-amber-400 mt-0.5">{metrics.hitCount}</div>
          <span className="text-[9px] text-zinc-500 font-mono">Warning ignored / struck</span>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden p-3 gap-3 min-h-0">
        {/* Main Section */}
        {viewTab === 'map' ? (
          <div className="flex-1 rounded-md border border-zinc-800 overflow-hidden relative bg-zinc-950 min-h-0">
            <OSMMap
              center={mapCenter}
              zoom={mapZoom}
              markers={mapMarkers}
              polylines={mapPolylines}
              onMarkerClick={(m) => {
                const id = m.id.replace('pred-target-', '').replace('pred-origin-', '');
                const match = predictions.find((p) => p.id === id);
                if (match) setSelectedPrediction(match);
              }}
            />
          </div>
        ) : viewTab === 'split' ? (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0 overflow-hidden">
            {/* Split Table */}
            <div className="lg:col-span-7 bg-zinc-950 border border-zinc-800 rounded-md flex flex-col overflow-hidden min-h-0">
              {/* Filter Tabs & Search */}
              <div className="px-3 py-2 bg-zinc-900/60 border-b border-zinc-800 flex items-center justify-between font-mono text-[10px] shrink-0 gap-2">
                <div className="relative flex-1 max-w-xs">
                  <Search size={10} className="absolute left-2 top-2 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Search prediction ID, H3 index, device..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded pl-6 pr-2 py-1 text-zinc-200 font-mono text-[10px] focus:outline-none focus:border-zinc-600 placeholder:text-zinc-600"
                  />
                </div>

                <div className="flex items-center gap-1">
                  {['all', 'hit', 'miss', 'not_traversed', 'pending'].map((st) => (
                    <button
                      key={st}
                      onClick={() => setFilterOutcome(st)}
                      className={`px-2 py-0.5 rounded capitalize transition-colors ${
                        filterOutcome === st
                          ? 'bg-zinc-800 text-white font-bold'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {st.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-zinc-900/40 text-zinc-400 border-b border-zinc-800 font-mono text-[10px] uppercase tracking-wider sticky top-0 backdrop-blur z-10">
                      <th className="p-2.5">Prediction</th>
                      <th className="p-2.5">Target Cell</th>
                      <th className="p-2.5">Horizon</th>
                      <th className="p-2.5 text-right">Outcome</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900/80 font-mono text-[11px]">
                    {filteredPredictions.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-zinc-500 font-mono">
                          {loading ? 'Querying predictions table...' : 'No hazard predictions found.'}
                        </td>
                      </tr>
                    ) : (
                      filteredPredictions.map((p, idx) => {
                        const isSelected = selectedPrediction?.id === p.id;
                        const rowKey = p.id ? `pred-${p.id}-${idx}` : `pred-${idx}`;
                        return (
                          <tr
                            key={rowKey}
                            onClick={() => handleSelectPrediction(p)}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-zinc-800/80 text-white' : 'hover:bg-zinc-900/40 text-zinc-300'
                            }`}
                          >
                            <td className="p-2.5">
                              <div className="font-bold text-white text-[11px] truncate">{p.id.slice(0, 10)}...</div>
                              <span className="text-zinc-500 text-[9px] block">{p.device_id}</span>
                            </td>
                            <td className="p-2.5 text-emerald-400 text-[10px]">
                              {p.target_h3_12.slice(0, 12)}...
                            </td>
                            <td className="p-2.5 text-zinc-400">
                              {p.distance_m}m ({p.eta_s}s)
                            </td>
                            <td className="p-2.5 text-right">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${
                                  p.outcome === 'hit'
                                    ? 'bg-rose-950 text-rose-300 border-rose-800'
                                    : p.outcome === 'miss'
                                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                    : p.outcome === 'not_traversed'
                                    ? 'bg-zinc-900 text-zinc-400 border-zinc-800'
                                    : 'bg-amber-950 text-amber-300 border-amber-800'
                                }`}
                              >
                                {p.outcome === 'miss' ? 'Safe Evasion' : p.outcome.replace('_', ' ')}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Split Map */}
            <div className="lg:col-span-5 rounded-md border border-zinc-800 overflow-hidden relative bg-zinc-950 min-h-0">
              <OSMMap
                center={mapCenter}
                zoom={mapZoom}
                markers={mapMarkers}
                polylines={mapPolylines}
                onMarkerClick={(m) => {
                  const id = m.id.replace('pred-target-', '').replace('pred-origin-', '');
                  const match = predictions.find((p) => p.id === id);
                  if (match) setSelectedPrediction(match);
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-md flex flex-col overflow-hidden min-h-0">
            <div className="px-3 py-2 bg-zinc-900/60 border-b border-zinc-800 flex items-center justify-between font-mono text-[10px] shrink-0">
              <span className="font-semibold text-zinc-300 uppercase">Lookahead Warnings & Verification Log</span>
              <div className="flex items-center gap-1">
                {['all', 'hit', 'miss', 'not_traversed', 'pending'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setFilterOutcome(st)}
                    className={`px-2 py-0.5 rounded capitalize ${
                      filterOutcome === st
                        ? 'bg-zinc-800 text-white font-bold'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {st.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-900/40 text-zinc-400 border-b border-zinc-800 font-mono text-[10px] uppercase tracking-wider sticky top-0 backdrop-blur z-10">
                    <th className="p-3">Prediction ID</th>
                    <th className="p-3">Device / Trip</th>
                    <th className="p-3">Warning Type</th>
                    <th className="p-3">Target H3 Cell</th>
                    <th className="p-3">Lookahead Horizon</th>
                    <th className="p-3">Confidence</th>
                    <th className="p-3 text-right">Verification Outcome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900/80 font-mono text-[11px]">
                  {filteredPredictions.map((p, idx) => (
                    <tr
                      key={p.id ? `pred-full-${p.id}-${idx}` : `pred-full-${idx}`}
                      onClick={() => handleSelectPrediction(p)}
                      className="hover:bg-zinc-900/40 transition-colors cursor-pointer"
                    >
                      <td className="p-3 font-bold text-white">{p.id}</td>
                      <td className="p-3 text-zinc-400">{p.device_id}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 text-zinc-200">
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: formatEventType(p.type).dotColor }}
                          />
                          <span>{formatEventType(p.type).label}</span>
                        </div>
                      </td>
                      <td className="p-3 text-emerald-400">{p.target_h3_12}</td>
                      <td className="p-3 text-zinc-300">
                        {p.distance_m}m ({p.eta_s}s)
                      </td>
                      <td className="p-3 text-zinc-400">{(p.confidence * 100).toFixed(0)}%</td>
                      <td className="p-3 text-right">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                            p.outcome === 'hit'
                              ? 'bg-rose-950 text-rose-300 border-rose-800'
                              : p.outcome === 'miss'
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                              : p.outcome === 'not_traversed'
                              ? 'bg-zinc-900 text-zinc-400 border-zinc-800'
                              : 'bg-amber-950 text-amber-300 border-amber-800'
                          }`}
                        >
                          {p.outcome === 'miss' ? 'Safe Evasion' : p.outcome.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Right Sidebar: Prediction Detail Inspector */}
        <div className="w-80 bg-zinc-950 border border-zinc-800 rounded-md p-3 flex flex-col space-y-3 font-mono text-[11px] shrink-0">
          <span className="font-semibold text-zinc-300 uppercase text-[10px] tracking-wider flex items-center gap-1.5 border-b border-zinc-800 pb-2">
            <Activity size={12} className="text-emerald-400" />
            Verification Inspector
          </span>

          {selectedPrediction ? (
            <div className="space-y-3">
              <div className="bg-black p-2.5 rounded-md border border-zinc-800 space-y-1">
                <span className="text-[9px] text-zinc-500 uppercase">Warning Classification</span>
                <p className="font-bold text-white text-xs">{formatEventType(selectedPrediction.type).label}</p>
                <p className="text-zinc-400 text-[10px] mt-1 font-mono truncate select-all">ID: {selectedPrediction.id}</p>
              </div>

              <div className="bg-black p-2.5 rounded-md border border-zinc-800 space-y-1">
                <span className="text-[9px] text-zinc-500 uppercase">Lookahead Cone Metrics</span>
                <div className="grid grid-cols-2 gap-2 mt-1 text-[10px]">
                  <div>
                    <span className="text-zinc-500 block">Distance</span>
                    <span className="font-bold text-white">{selectedPrediction.distance_m} m</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Warning ETA</span>
                    <span className="font-bold text-white">{selectedPrediction.eta_s} s</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Confidence</span>
                    <span className="font-bold text-emerald-400">{(selectedPrediction.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">Target H3-12</span>
                    <span className="font-bold text-emerald-400 truncate block">{selectedPrediction.target_h3_12.slice(0, 10)}...</span>
                  </div>
                </div>
              </div>

              <div className="bg-black p-2.5 rounded-md border border-zinc-800 space-y-1">
                <span className="text-[9px] text-zinc-500 uppercase">Ground Truth Resolution</span>
                <p
                  className={`font-bold text-xs uppercase mt-0.5 ${
                    selectedPrediction.outcome === 'hit'
                      ? 'text-rose-400'
                      : selectedPrediction.outcome === 'miss'
                      ? 'text-emerald-400'
                      : 'text-zinc-300'
                  }`}
                >
                  {selectedPrediction.outcome === 'miss'
                    ? '✓ SAFE EVASION (DEFEAT AVOIDED)'
                    : selectedPrediction.outcome === 'hit'
                    ? '⚠️ SUSPENSION IMPACT CONFIRMED'
                    : selectedPrediction.outcome === 'not_traversed'
                    ? '↪ ROUTE DIVERTED (NOT TRAVERSED)'
                    : '⏳ AWAITING PASS EVALUATION'}
                </p>
                <p className="text-[10px] text-zinc-400 mt-1 leading-relaxed">
                  {selectedPrediction.outcome === 'miss'
                    ? 'The driver traversed the target H3 cell safely with reduced G-forces, indicating successful hazard evasion.'
                    : selectedPrediction.outcome === 'hit'
                    ? 'An impact candidate fired within the target H3 cell radius, confirming ground truth defect strike.'
                    : selectedPrediction.outcome === 'not_traversed'
                    ? 'Vehicle diverted before entering the lookahead target boundary.'
                    : 'Prediction emitted into active lookahead horizon; awaiting post-pass telemetry evaluation.'}
                </p>

                {selectedPrediction.outcome_event_id && (
                  <div className="pt-2 border-t border-zinc-900 text-[9px] text-zinc-500">
                    Linked Ground Truth Event: <span className="font-mono text-zinc-300">{selectedPrediction.outcome_event_id.slice(0, 8)}...</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-zinc-500 py-12 text-center space-y-2">
              <ShieldCheck size={20} className="mx-auto text-zinc-600" />
              <p>Select any prediction row to audit ground-truth verification and lookahead metrics.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
