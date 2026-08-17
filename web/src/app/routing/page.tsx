'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Header } from '@/components/common/Header';
import { OSMMap, MapMarker, MapPolyline, MapHexagon } from '@/components/map/OSMMap';
import { createClient } from '@/lib/supabase/client';
import { cellToBoundary } from 'h3-js';
import {
  ArrowUpDown,
  Crosshair,
  Shield,
  Zap,
  Scale,
  Send,
  Check,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import {
  LocationItem,
  RoutePreset,
  PresetType,
  PRESET_LOCATIONS,
  calculateThreePresets,
} from '@/lib/routing/osrmEngine';

export default function SmartRoutingPage() {
  const supabase = useMemo(() => createClient(), []);

  // Location State
  const [origin, setOrigin] = useState<LocationItem>(PRESET_LOCATIONS[0]);
  const [destination, setDestination] = useState<LocationItem>(PRESET_LOCATIONS[1]);
  const [pickingTarget, setPickingTarget] = useState<'origin' | 'destination' | null>(null);

  // Routes & Selection
  const [routes, setRoutes] = useState<RoutePreset[]>([]);
  const [selectedId, setSelectedId] = useState<PresetType>('safe');
  const [loading, setLoading] = useState<boolean>(true);
  const [routingError, setRoutingError] = useState<string | null>(null);

  // Map layers & overlay
  const [roadCells, setRoadCells] = useState<any[]>([]);
  const [roadDefects, setRoadDefects] = useState<any[]>([]);
  const [showPotholes, setShowPotholes] = useState<boolean>(true);
  const [showH3Grid, setShowH3Grid] = useState<boolean>(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([6.938, 79.865]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Load backend spatial telemetry
  useEffect(() => {
    async function loadData() {
      try {
        const [cellsRes, defectsRes] = await Promise.all([
          supabase.from('road_cells').select('*').limit(2000),
          supabase.from('road_defects').select('*').limit(1000),
        ]);
        if (cellsRes.data) setRoadCells(cellsRes.data);
        if (defectsRes.data) setRoadDefects(defectsRes.data);
      } catch (err) {
        console.error('Error loading spatial data:', err);
      }
    }
    loadData();
  }, [supabase]);

  // Recalculate routes on location change
  const computeRoutes = useCallback(async () => {
    setLoading(true);
    setRoutingError(null);
    try {
      const results = await calculateThreePresets(origin, destination, roadCells, roadDefects);
      if (results.length === 0) {
        setRoutes([]);
        setRoutingError('Routing unavailable: street routing network unreachable.');
      } else {
        setRoutes(results);
        // Default to recommended route
        const recommended = results.find((r) => r.isRecommended) || results[0];
        setSelectedId(recommended.id);

        if (results[0]?.polyline[0]) {
          const mid = results[0].polyline[Math.floor(results[0].polyline.length / 2)];
          setMapCenter(mid);
        }
      }
    } catch (err) {
      console.error('Routing calculation failed:', err);
      setRoutingError('Routing unavailable: error communicating with routing service.');
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, [origin, destination, roadCells, roadDefects]);

  useEffect(() => {
    computeRoutes();
  }, [computeRoutes]);

  const activeRoute = routes.find((r) => r.id === selectedId) || routes[0];

  // Swap endpoints
  const handleSwap = () => {
    const prev = origin;
    setOrigin(destination);
    setDestination(prev);
  };

  // Click on map to set waypoint
  const handleMapClick = (coords: [number, number]) => {
    if (!pickingTarget) return;

    const customPoint: LocationItem = {
      id: `custom-${Date.now()}`,
      name: `Point (${coords[0].toFixed(3)}, ${coords[1].toFixed(3)})`,
      lat: coords[0],
      lon: coords[1],
    };

    if (pickingTarget === 'origin') {
      setOrigin(customPoint);
    } else {
      setDestination(customPoint);
    }
    setPickingTarget(null);
  };

  const handleDispatch = () => {
    if (!activeRoute) return;
    setStatusMessage(`Dispatched ${activeRoute.title} (${activeRoute.distanceKm} km) to vehicle.`);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // Map Polylines
  const mapPolylines: MapPolyline[] = useMemo(() => {
    return routes.map((r) => {
      const isSelected = r.id === activeRoute?.id;
      return {
        id: `poly-${r.id}`,
        positions: r.polyline,
        color: r.color,
        weight: isSelected ? 4 : 2.5,
        opacity: isSelected ? 1.0 : 0.25,
        dashArray: r.dashArray,
      };
    });
  }, [routes, activeRoute]);

  // Map Markers
  const mapMarkers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = [
      {
        id: 'start',
        lat: origin.lat,
        lon: origin.lon,
        title: `Origin: ${origin.name}`,
        type: 'start',
      },
      {
        id: 'dest',
        lat: destination.lat,
        lon: destination.lon,
        title: `Destination: ${destination.name}`,
        type: 'end',
      },
    ];

    if (showPotholes) {
      roadDefects.forEach((d) => {
        if (d.lat && d.lon) {
          list.push({
            id: `defect-${d.id}`,
            lat: d.lat,
            lon: d.lon,
            title: `Road Defect / Pothole`,
            type: 'defect',
            severity: d.severity || 'high',
            confidence: d.confidence,
            h3_12: d.h3_12,
            details: `Detected road surface anomaly | Spike rate: ${d.spike_rate?.toFixed(1) ?? 'N/A'}`,
          });
        }
      });
    }

    return list;
  }, [origin, destination, roadDefects, showPotholes]);

  // H3 Grid
  const mapHexagons: MapHexagon[] = useMemo(() => {
    if (!showH3Grid) return [];

    const hexList: MapHexagon[] = [];
    for (let idx = 0; idx < roadCells.length; idx++) {
      const cell = roadCells[idx];
      if (!cell.h3_12) continue;
      let boundary: [number, number][] = [];
      try {
        boundary = cellToBoundary(cell.h3_12);
      } catch {
        continue;
      }
      if (!boundary || boundary.length === 0) continue;

      let color = '#22c55e';
      if (cell.roughness_index >= 75) color = '#ef4444';
      else if (cell.roughness_index >= 50) color = '#f97316';
      else if (cell.roughness_index >= 25) color = '#eab308';

      const hexId = cell.heading_sector !== undefined ? `${cell.h3_12}_${cell.heading_sector}` : `${cell.h3_12}_${idx}`;

      hexList.push({
        id: hexId,
        boundary,
        color,
        fillOpacity: 0.2,
        tooltipText: `Roughness: ${Number(cell.roughness_index || 0).toFixed(1)}/100`,
      });
    }

    return hexList;
  }, [roadCells, showH3Grid]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-black text-zinc-100 font-sans text-xs">
      <Header
        title="Fleet Routing"
        subtitle="Street-level pathfinding with road roughness and defect telemetry"
      />

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden p-2.5 gap-2.5 min-h-0">
        {/* Left Sidebar: Controls & Presets */}
        <div className="w-80 bg-zinc-950 rounded border border-zinc-800 flex flex-col shrink-0 overflow-hidden">
          {/* Waypoints Section */}
          <div className="p-3 border-b border-zinc-800 space-y-2.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
              <span>Waypoints</span>
              <button
                type="button"
                onClick={handleSwap}
                className="flex items-center gap-1 text-zinc-400 hover:text-white px-1.5 py-0.5 rounded border border-zinc-800 hover:border-zinc-700 bg-zinc-900 transition-colors"
                title="Swap origin and destination"
              >
                <ArrowUpDown size={11} />
                <span>Swap</span>
              </button>
            </div>

            {/* Origin Field */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <label className="text-zinc-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Origin
                </label>
                {pickingTarget === 'origin' ? (
                  <span className="text-amber-400 font-mono text-[10px]">Click map...</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPickingTarget('origin')}
                    className="text-zinc-500 hover:text-zinc-300 flex items-center gap-1 text-[10px]"
                  >
                    <Crosshair size={10} /> Set on map
                  </button>
                )}
              </div>
              <select
                value={origin.id}
                onChange={(e) => {
                  const found = PRESET_LOCATIONS.find((h) => h.id === e.target.value);
                  if (found) setOrigin(found);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 text-xs focus:outline-none focus:border-zinc-600"
              >
                {PRESET_LOCATIONS.map((h) => (
                  <option key={`orig-${h.id}`} value={h.id}>
                    {h.name}
                  </option>
                ))}
                {origin.id.startsWith('custom') && <option value={origin.id}>{origin.name}</option>}
              </select>
            </div>

            {/* Destination Field */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <label className="text-zinc-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                  Destination
                </label>
                {pickingTarget === 'destination' ? (
                  <span className="text-amber-400 font-mono text-[10px]">Click map...</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPickingTarget('destination')}
                    className="text-zinc-500 hover:text-zinc-300 flex items-center gap-1 text-[10px]"
                  >
                    <Crosshair size={10} /> Set on map
                  </button>
                )}
              </div>
              <select
                value={destination.id}
                onChange={(e) => {
                  const found = PRESET_LOCATIONS.find((h) => h.id === e.target.value);
                  if (found) setDestination(found);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 text-xs focus:outline-none focus:border-zinc-600"
              >
                {PRESET_LOCATIONS.map((h) => (
                  <option key={`dest-${h.id}`} value={h.id}>
                    {h.name}
                  </option>
                ))}
                {destination.id.startsWith('custom') && (
                  <option value={destination.id}>{destination.name}</option>
                )}
              </select>
            </div>
          </div>

          {/* Presets Header */}
          <div className="px-3 py-2 bg-zinc-950 border-b border-zinc-800/80 flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-400">Route Options</span>
            {loading && (
              <span className="text-[10px] text-zinc-500 font-mono flex items-center gap-1">
                <RefreshCw size={10} className="animate-spin" /> Routing...
              </span>
            )}
          </div>

          {/* Presets List */}
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2 min-h-0">
            {routingError && (
              <div className="p-3 rounded bg-rose-950/40 border border-rose-800/60 text-rose-300 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-rose-200">
                  <AlertCircle size={13} />
                  <span>Routing Unavailable</span>
                </div>
                <p className="text-[11px] text-rose-400 leading-tight">
                  {routingError}
                </p>
                <button
                  type="button"
                  onClick={computeRoutes}
                  className="mt-2 w-full py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-100 rounded text-[11px] font-mono transition-colors"
                >
                  Retry Road Routing
                </button>
              </div>
            )}

            {!routingError && routes.length === 0 && !loading && (
              <div className="p-3 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 text-center">
                No route available between selected coordinates.
              </div>
            )}

            {routes.map((preset) => {
              const isSelected = selectedId === preset.id;

              return (
                <div
                  key={preset.id}
                  onClick={() => setSelectedId(preset.id)}
                  className={`p-2.5 rounded border cursor-pointer transition-colors space-y-2 ${
                    isSelected
                      ? 'bg-zinc-900 border-zinc-600 text-white'
                      : 'bg-zinc-950 border-zinc-800/90 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900/50'
                  }`}
                >
                  {/* Title & Badge */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: preset.color }}
                      />
                      <span className="font-semibold text-zinc-100 text-xs">{preset.title}</span>
                    </div>

                    {preset.isRecommended && (
                      <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/70">
                        {preset.badge || 'Recommended'}
                      </span>
                    )}
                  </div>

                  {/* Subtitle / Evidence description */}
                  <p className="text-[10px] text-zinc-400 leading-tight">
                    {preset.subtitle}
                  </p>

                  {/* Concise Data Row */}
                  <div className="grid grid-cols-4 gap-1 text-[11px] font-mono pt-1 border-t border-zinc-800/60 text-zinc-300">
                    <div>
                      <span className="text-[9px] text-zinc-500 block font-sans">Time</span>
                      <span className="font-medium text-white">{preset.durationMins}m</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-zinc-500 block font-sans">Dist</span>
                      <span>{preset.distanceKm}km</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-zinc-500 block font-sans">Potholes</span>
                      {preset.potholesHit !== null ? (
                        <span
                          className={
                            preset.potholesHit === 0 ? 'text-emerald-400 font-medium' : 'text-rose-400'
                          }
                        >
                          {preset.potholesHit}
                        </span>
                      ) : (
                        <span className="text-zinc-500 font-normal">Unverified</span>
                      )}
                    </div>
                    <div>
                      <span className="text-[9px] text-zinc-500 block font-sans">Quality</span>
                      {preset.smoothnessScore !== null ? (
                        <span className="text-zinc-200">{preset.smoothnessScore}%</span>
                      ) : (
                        <span className="text-zinc-500 font-normal">No data</span>
                      )}
                    </div>
                  </div>

                  {/* Telemetry Coverage Status */}
                  <div className="flex items-center justify-between text-[10px] font-mono pt-0.5 text-zinc-500">
                    <span>H3 Coverage:</span>
                    <span
                      className={
                        preset.coverageStatus === 'verified'
                          ? 'text-emerald-400 font-medium'
                          : preset.coverageStatus === 'partial'
                          ? 'text-amber-400'
                          : preset.coverageStatus === 'sparse'
                          ? 'text-zinc-400'
                          : 'text-zinc-500'
                      }
                    >
                      {preset.coverageStatus === 'verified'
                        ? `${preset.coveragePct}% Verified`
                        : preset.coverageStatus === 'partial'
                        ? `${preset.coveragePct}% Mapped`
                        : preset.coverageStatus === 'sparse'
                        ? `${preset.coveragePct}% Sparse`
                        : 'Unmapped (0%)'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Dispatch Footer */}
          <div className="p-2.5 border-t border-zinc-800 bg-zinc-950 space-y-2">
            <button
              type="button"
              disabled={!activeRoute}
              onClick={handleDispatch}
              className="w-full py-1.5 bg-zinc-100 hover:bg-white disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-semibold text-xs rounded transition-colors flex items-center justify-center gap-1.5"
            >
              <Send size={11} />
              Dispatch {activeRoute?.title || 'Route'}
            </button>

            {statusMessage && (
              <div className="p-1.5 bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] rounded font-mono text-center">
                ✓ {statusMessage}
              </div>
            )}
          </div>
        </div>

        {/* Right Map Canvas */}
        <div className="flex-1 rounded border border-zinc-800 flex flex-col min-h-0 bg-zinc-950 relative overflow-hidden">
          {/* Map Controls Header */}
          <div className="h-9 px-3 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between text-[11px] shrink-0">
            <div className="flex items-center gap-3">
              {activeRoute ? (
                <>
                  <span className="text-zinc-400">
                    Active:{' '}
                    <span className="font-semibold text-zinc-100">{activeRoute.title}</span>
                  </span>
                  <span className="text-zinc-600">|</span>
                  <span className="font-mono text-zinc-400">
                    {activeRoute.distanceKm} km · {activeRoute.durationMins} mins ·{' '}
                    {activeRoute.potholesHit !== null ? (
                      <span className={activeRoute.potholesHit === 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {activeRoute.potholesHit} potholes
                      </span>
                    ) : (
                      <span className="text-zinc-400">Unverified surface</span>
                    )}
                  </span>
                  <span className="text-zinc-600">|</span>
                  <span className="text-[10px] font-mono text-zinc-400">
                    Coverage:{' '}
                    <span
                      className={
                        activeRoute.coverageStatus === 'verified'
                          ? 'text-emerald-400'
                          : activeRoute.coverageStatus === 'partial'
                          ? 'text-amber-400'
                          : 'text-zinc-400'
                      }
                    >
                      {activeRoute.coverageStatus === 'verified'
                        ? `${activeRoute.coveragePct}% Verified Fleet Telemetry`
                        : activeRoute.coverageStatus === 'partial'
                        ? `${activeRoute.coveragePct}% Mapped Telemetry`
                        : activeRoute.coverageStatus === 'sparse'
                        ? `${activeRoute.coveragePct}% Sparse Telemetry`
                        : 'Unmapped Route Corridor (0%)'}
                    </span>
                  </span>
                </>
              ) : (
                <span className="text-zinc-500 font-mono">
                  {loading ? 'Calculating road routes...' : 'No active route'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-zinc-400 cursor-pointer hover:text-zinc-200">
                <input
                  type="checkbox"
                  checked={showPotholes}
                  onChange={(e) => setShowPotholes(e.target.checked)}
                  className="rounded bg-zinc-900 border-zinc-700 text-zinc-400 focus:ring-0"
                />
                <span>Potholes ({roadDefects.length})</span>
              </label>

              <label className="flex items-center gap-1.5 text-zinc-400 cursor-pointer hover:text-zinc-200">
                <input
                  type="checkbox"
                  checked={showH3Grid}
                  onChange={(e) => setShowH3Grid(e.target.checked)}
                  className="rounded bg-zinc-900 border-zinc-700 text-zinc-400 focus:ring-0"
                />
                <span>H3 Grid</span>
              </label>
            </div>
          </div>

          {/* Leaflet Map */}
          <div className="flex-1 relative">
            <OSMMap
              center={mapCenter}
              zoom={13}
              markers={mapMarkers}
              polylines={mapPolylines}
              hexagons={mapHexagons}
              onMapClick={handleMapClick}
            />

            {/* Minimal Corner Legend */}
            <div className="absolute bottom-2.5 left-2.5 z-10 bg-zinc-950/90 border border-zinc-800 rounded px-2.5 py-1.5 text-[10px] font-mono space-y-1 backdrop-blur">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-1 rounded-sm bg-emerald-500 inline-block" />
                <span className="text-zinc-300">Safe Route (Surface-Optimized)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-1 rounded-sm bg-rose-500 border-dashed inline-block" />
                <span className="text-zinc-400">Fast Route (Shortest Time)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-1 rounded-sm bg-amber-500 inline-block" />
                <span className="text-zinc-400">Balanced Route (Alternative)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
