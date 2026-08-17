'use client';

import { useEffect, useRef, memo } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Polygon,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import type { OSMMapProps, MapMarker, EventPulse } from './OSMMap';

// Fix default marker icon assets
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function getSeverityBadgeClasses(severity?: string) {
  switch (severity) {
    case 'critical':
      return 'bg-rose-950 text-rose-300 border-rose-800/80';
    case 'high':
      return 'bg-amber-950 text-amber-300 border-amber-800/80';
    case 'medium':
      return 'bg-yellow-950 text-yellow-300 border-yellow-800/70';
    default:
      return 'bg-zinc-900 text-zinc-400 border-zinc-800';
  }
}

function formatTimestamp(iso?: string) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

// Stable top-level click handler component
function MapClickHandler({ onClick }: { onClick?: (coords: [number, number]) => void }) {
  useMapEvents({
    click(e) {
      if (onClick) {
        onClick([e.latlng.lat, e.latlng.lng]);
      }
    },
  });
  return null;
}

// Stable top-level view controller preserving user-initiated zoom and pan
function MapViewPreserver({
  mapCenter,
  mapZoom,
}: {
  mapCenter: [number, number];
  mapZoom: number;
}) {
  const map = useMap();
  const prevCenterRef = useRef<[number, number] | null>(null);
  const prevZoomPropRef = useRef<number>(mapZoom);
  const isInitialRef = useRef<boolean>(true);

  useEffect(() => {
    if (!map || !mapCenter || !mapCenter[0] || !mapCenter[1]) return;

    if (isInitialRef.current) {
      // First mount initial view
      map.setView(mapCenter, mapZoom, { animate: false });
      prevCenterRef.current = [mapCenter[0], mapCenter[1]];
      prevZoomPropRef.current = mapZoom;
      isInitialRef.current = false;
      return;
    }

    const prev = prevCenterRef.current;
    const hasMeaningfulCenterChange =
      !prev ||
      Math.abs(prev[0] - mapCenter[0]) > 0.0002 ||
      Math.abs(prev[1] - mapCenter[1]) > 0.0002;

    const hasExplicitZoomPropChange = prevZoomPropRef.current !== mapZoom;

    if (hasMeaningfulCenterChange) {
      // Smoothly fly to target driver coordinate
      map.flyTo(mapCenter, hasExplicitZoomPropChange ? mapZoom : map.getZoom(), {
        duration: 0.9,
        easeLinearity: 0.25,
      });
      prevCenterRef.current = [mapCenter[0], mapCenter[1]];
      if (hasExplicitZoomPropChange) {
        prevZoomPropRef.current = mapZoom;
      }
    } else if (hasExplicitZoomPropChange) {
      map.setZoom(mapZoom);
      prevZoomPropRef.current = mapZoom;
    }
  }, [map, mapCenter, mapZoom]);

  return null;
}

// Custom marker icons based on type & severity
function createMarkerIcon(m: MapMarker) {
  if (m.type === 'start') {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" style="filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.9));">
        <circle cx="16" cy="16" r="14" fill="#059669" stroke="#ffffff" stroke-width="2.5"/>
        <circle cx="16" cy="16" r="6" fill="#ffffff"/>
      </svg>
    `;
    return L.divIcon({
      className: 'custom-leaflet-icon',
      html: svg,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }

  if (m.type === 'end') {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" style="filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.9));">
        <circle cx="16" cy="16" r="14" fill="#dc2626" stroke="#ffffff" stroke-width="2.5"/>
        <path d="M12 10h8v4h-8zm0 8h8v4h-8z" fill="#ffffff"/>
      </svg>
    `;
    return L.divIcon({
      className: 'custom-leaflet-icon',
      html: svg,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }

  if (m.type === 'waypoint') {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28" style="filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.8));">
        <polygon points="14,2 26,24 2,24" fill="#0284c7" stroke="#ffffff" stroke-width="2"/>
      </svg>
    `;
    return L.divIcon({
      className: 'custom-leaflet-icon',
      html: svg,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  let color = m.color || '#ffffff';
  if (!m.color) {
    if (m.type === 'event') {
      if (m.severity === 'critical') color = '#ef4444';
      else if (m.severity === 'high') color = '#f97316';
      else if (m.severity === 'medium') color = '#f59e0b';
      else color = '#3b82f6';
    } else if (m.type === 'defect') {
      color = '#eab308';
    } else if (m.type === 'vehicle') {
      color = '#10b981';
    }
  }

  const headingAngle = m.heading ?? 0;

  const svgIcon = `
    <div style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; position: relative;">
      ${
        m.type === 'vehicle'
          ? `
          <div style="position: absolute; width: 32px; height: 32px; border-radius: 9999px; background: ${color}22; border: 1.5px solid ${color}88; box-shadow: 0 0 10px ${color}88;"></div>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" width="26" height="26" style="filter: drop-shadow(0px 2px 5px rgba(0,0,0,0.9)); transform: rotate(${headingAngle}deg); transform-origin: 50% 50%; transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1); position: relative; z-index: 2;">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
          `
          : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" width="28" height="28" style="filter: drop-shadow(0px 2px 5px rgba(0,0,0,0.9));"><circle cx="12" cy="12" r="9" stroke="#ffffff" stroke-width="2"/></svg>`
      }
    </div>
  `;

  return L.divIcon({
    className: 'custom-leaflet-icon',
    html: svgIcon,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

// Radar Pulse Icon for Instant Event Visualizer
function createRadarPulseIcon(pulse: { severity?: string; type?: string }) {
  const isCritical = pulse.severity === 'critical';
  const rippleColor = isCritical ? '#ef4444' : '#f59e0b';
  const glowBg = isCritical ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.35)';

  const html = `
    <div style="position: relative; width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; pointer-events: none;">
      <!-- Outer expanding radar ring -->
      <div class="animate-radar-pulse" style="position: absolute; width: 56px; height: 56px; border-radius: 9999px; border: 2px solid ${rippleColor}; background-color: ${glowBg};"></div>
      <!-- Inner fast radar ring -->
      <div class="animate-radar-pulse-fast" style="position: absolute; width: 36px; height: 36px; border-radius: 9999px; border: 1.5px solid ${rippleColor};"></div>
      <!-- Center glowing focal beacon -->
      <div style="position: relative; width: 10px; height: 10px; border-radius: 9999px; background-color: ${rippleColor}; box-shadow: 0 0 10px ${rippleColor}; border: 1.5px solid #ffffff;"></div>
    </div>
  `;

  return L.divIcon({
    className: 'radar-pulse-leaflet-icon',
    html,
    iconSize: [64, 64],
    iconAnchor: [32, 32],
  });
}

/**
 * 60 FPS Dead-Reckoning Vehicle Marker
 * Interpolates vehicle position between 1 Hz telemetry packets using requestAnimationFrame.
 * Extrapolation is clamped to a maximum of 2.0 seconds to prevent drift on packet loss.
 */
const VehicleDeadReckoningMarker = memo(function VehicleDeadReckoningMarker({
  marker,
  onClick,
}: {
  marker: MapMarker;
  onClick?: (m: MapMarker) => void;
}) {
  const markerRef = useRef<L.Marker | null>(null);
  const anchorRef = useRef({
    baseLat: marker.lat,
    baseLon: marker.lon,
    speedKmh: marker.speedKmh ?? 0,
    heading: marker.heading ?? 0,
    baseTime: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  });

  // When a new packet arrives with updated coordinate, speed, or heading:
  useEffect(() => {
    anchorRef.current = {
      baseLat: marker.lat,
      baseLon: marker.lon,
      speedKmh: marker.speedKmh ?? 0,
      heading: marker.heading ?? 0,
      baseTime: performance.now(),
    };

    if (markerRef.current) {
      markerRef.current.setIcon(createMarkerIcon(marker));
      markerRef.current.setLatLng([marker.lat, marker.lon]);
    }
  }, [marker.lat, marker.lon, marker.speedKmh, marker.heading, marker]);

  // 60 FPS Dead-Reckoning Extrapolation Loop
  useEffect(() => {
    let animId: number;

    const loop = () => {
      const now = performance.now();
      const { baseLat, baseLon, speedKmh, heading, baseTime } = anchorRef.current;

      if (speedKmh > 0 && markerRef.current) {
        const elapsedSec = (now - baseTime) / 1000;
        // Clamp extrapolation to maximum 2.0 seconds to prevent drift
        const clampedDt = Math.min(Math.max(elapsedSec, 0), 2.0);

        if (clampedDt > 0) {
          const speedMps = speedKmh / 3.6;
          const distanceM = speedMps * clampedDt;
          const headingRad = (heading * Math.PI) / 180;

          // Spatial displacement approximation (WGS84 spherical model)
          // 1 deg lat ~= 111,139 meters
          const dLat = (distanceM * Math.cos(headingRad)) / 111139;
          const cosLat = Math.cos((baseLat * Math.PI) / 180);
          const dLon =
            (distanceM * Math.sin(headingRad)) /
            (111139 * (Math.abs(cosLat) > 0.0001 ? cosLat : 1));

          const currentLat = baseLat + dLat;
          const currentLon = baseLon + dLon;

          markerRef.current.setLatLng([currentLat, currentLon]);
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <Marker
      ref={markerRef}
      position={[marker.lat, marker.lon]}
      icon={createMarkerIcon(marker)}
      eventHandlers={{
        click: () => onClick?.(marker),
      }}
    >
      <Popup>
        <div className="p-2.5 text-xs font-sans text-zinc-200 bg-zinc-950 select-none min-w-[210px] max-w-[260px]">
          <div className="flex items-start justify-between gap-2 border-b border-zinc-800/80 pb-2 mb-2 pr-4">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 font-bold text-white text-xs leading-tight truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-ping shrink-0" />
                <span className="truncate">{marker.title}</span>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono block pl-3 truncate">
                60 FPS Dead-Reckoning
              </span>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-emerald-950 text-emerald-300 border border-emerald-800/80 shrink-0">
              TRACKING
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
            {marker.speedKmh !== undefined && (
              <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1">
                <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">Speed</span>
                <span className="font-bold text-white">
                  {marker.speedKmh.toFixed(1)} <span className="text-zinc-500 font-normal">km/h</span>
                </span>
              </div>
            )}
            {marker.heading !== undefined && (
              <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1">
                <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">Heading</span>
                <span className="font-bold text-white">{marker.heading.toFixed(0)}°</span>
              </div>
            )}
            {marker.deviceId && (
              <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1 col-span-2">
                <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">Device ID</span>
                <span className="font-mono text-zinc-300 truncate block">{marker.deviceId}</span>
              </div>
            )}
          </div>

          <div className="mt-2 pt-1.5 border-t border-zinc-900 flex items-center justify-between text-[9px] font-mono text-zinc-500">
            <span>{formatTimestamp(marker.occurredAt) || 'Live Active'}</span>
            <span>
              {marker.lat.toFixed(4)}, {marker.lon.toFixed(4)}
            </span>
          </div>
        </div>
      </Popup>
    </Marker>
  );
});

export default function LeafletMapClient({
  center = [6.915, 79.852],
  zoom = 13,
  markers = [],
  polylines = [],
  hexagons = [],
  eventPulses = [],
  onMarkerClick,
  onHexagonClick,
  onMapClick,
  className = '',
}: OSMMapProps) {
  // Separate vehicle markers from other markers for specialized 60 FPS interpolation
  const vehicleMarkers = markers.filter((m) => m.type === 'vehicle');
  const staticMarkers = markers.filter((m) => m.type !== 'vehicle');

  // Filter high/critical severity event markers that warrant real-time radar ripples
  const criticalEventMarkers = staticMarkers.filter(
    (m) => m.type === 'event' && (m.severity === 'critical' || m.severity === 'high')
  );

  return (
    <div className={`w-full h-full rounded overflow-hidden border border-zinc-800 relative z-0 ${className}`}>
      <MapContainer center={center} zoom={zoom} scrollWheelZoom={true} className="w-full h-full">
        <MapViewPreserver mapCenter={center} mapZoom={zoom} />
        <MapClickHandler onClick={onMapClick} />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Polylines */}
        {polylines.map((poly, idx) => (
          <Polyline
            key={poly.id ? `poly-${poly.id}-${idx}` : `poly-${idx}`}
            positions={poly.positions}
            pathOptions={{
              color: poly.color ?? '#ffffff',
              weight: poly.weight ?? 4,
              opacity: poly.opacity ?? 0.9,
              dashArray: poly.dashArray,
            }}
          />
        ))}

        {/* H3 Hexagons */}
        {hexagons.map((hex, idx) => (
          <Polygon
            key={hex.id ? `hex-${hex.id}-${idx}` : `hex-${idx}`}
            positions={hex.boundary}
            pathOptions={{
              color: hex.color,
              fillColor: hex.color,
              fillOpacity: hex.fillOpacity ?? 0.35,
              weight: 1,
            }}
            eventHandlers={{
              click: () => onHexagonClick?.(hex),
            }}
          >
            <Popup>
              <div className="p-2.5 text-xs font-sans text-zinc-200 bg-zinc-950 select-none min-w-[210px] max-w-[260px]">
                <div className="flex items-start justify-between gap-2 border-b border-zinc-800/80 pb-2 mb-2 pr-4">
                  <div className="min-w-0">
                    <div className="font-bold text-white text-xs font-mono truncate">
                      Cell: {hex.id.slice(0, 10)}...
                    </div>
                    <span className="text-[10px] text-zinc-500 font-mono block">
                      H3 Spatial Index Res 12
                    </span>
                  </div>
                  {hex.roughnessIndex !== undefined && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase shrink-0 bg-zinc-900 text-zinc-300 border border-zinc-800">
                      {hex.roughnessIndex >= 75
                        ? 'SEVERE'
                        : hex.roughnessIndex >= 50
                        ? 'ROUGH'
                        : hex.roughnessIndex >= 25
                        ? 'WEAR'
                        : 'SMOOTH'}
                    </span>
                  )}
                </div>

                {hex.roughnessIndex !== undefined ? (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1">
                      <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">Roughness</span>
                      <span className="font-bold text-white">
                        {hex.roughnessIndex.toFixed(1)} <span className="text-zinc-500 font-normal">/100</span>
                      </span>
                    </div>
                    {hex.passCount !== undefined && (
                      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1">
                        <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">Passes</span>
                        <span className="font-bold text-white">{hex.passCount}</span>
                      </div>
                    )}
                    {hex.spikeCount !== undefined && (
                      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1">
                        <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">Spikes</span>
                        <span className="font-bold text-white">{hex.spikeCount}</span>
                      </div>
                    )}
                    {hex.speedP85 !== undefined && (
                      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1">
                        <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">P85 Speed</span>
                        <span className="font-bold text-white">{hex.speedP85.toFixed(1)} km/h</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-zinc-300 text-[11px] font-mono">{hex.tooltipText}</p>
                )}
              </div>
            </Popup>
          </Polygon>
        ))}

        {/* Instant Event Radar Pulse Ripples */}
        {criticalEventMarkers.map((evt, idx) => (
          <Marker
            key={`pulse-crit-${evt.id}-${idx}`}
            position={[evt.lat, evt.lon]}
            icon={createRadarPulseIcon({ severity: evt.severity, type: evt.eventType })}
            interactive={false}
          />
        ))}

        {/* Explicit Realtime Event Pulses (from SSE / CDC instant stream) */}
        {eventPulses.map((pulse, idx) => (
          <Marker
            key={`pulse-stream-${pulse.id}-${idx}`}
            position={[pulse.lat, pulse.lon]}
            icon={createRadarPulseIcon({ severity: pulse.severity, type: pulse.eventType })}
            interactive={false}
          />
        ))}

        {/* 60 FPS Dead-Reckoning Vehicle Markers */}
        {vehicleMarkers.map((m, idx) => (
          <VehicleDeadReckoningMarker
            key={m.id ? `veh-marker-${m.id}` : `veh-marker-${idx}`}
            marker={m}
            onClick={onMarkerClick}
          />
        ))}

        {/* Standard / Static Map Markers */}
        {staticMarkers.map((m, idx) => (
          <Marker
            key={m.id ? `marker-${m.id}-${idx}` : `marker-${idx}`}
            position={[m.lat, m.lon]}
            icon={createMarkerIcon(m)}
            eventHandlers={{
              click: () => onMarkerClick?.(m),
            }}
          >
            <Popup>
              <div className="p-2.5 text-xs font-sans text-zinc-200 bg-zinc-950 select-none min-w-[210px] max-w-[260px]">
                {/* Header */}
                <div className="flex items-start justify-between gap-2 border-b border-zinc-800/80 pb-2 mb-2 pr-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-bold text-white text-xs leading-tight truncate">
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
                      <span className="truncate">{m.title}</span>
                    </div>
                    {m.eventType && (
                      <span className="text-[10px] text-zinc-500 font-mono block pl-3 truncate">
                        {m.eventType}
                      </span>
                    )}
                  </div>
                  {m.severity ? (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider shrink-0 border ${getSeverityBadgeClasses(m.severity)}`}
                    >
                      {m.severity}
                    </span>
                  ) : null}
                </div>

                {/* Metric Badges Grid */}
                <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                  {m.speedKmh !== undefined && (
                    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1">
                      <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">Speed</span>
                      <span className="font-bold text-white">
                        {m.speedKmh.toFixed(1)} <span className="text-zinc-500 font-normal">km/h</span>
                      </span>
                    </div>
                  )}
                  {m.magnitude !== undefined && (
                    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1">
                      <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">Magnitude</span>
                      <span className="font-bold text-white">
                        {m.magnitude > 0 ? `+${m.magnitude.toFixed(2)}` : m.magnitude.toFixed(2)}{' '}
                        <span className="text-zinc-500 font-normal">{m.magnitudeUnit || 'g'}</span>
                      </span>
                    </div>
                  )}
                  {m.confidence !== undefined && (
                    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1">
                      <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">Confidence</span>
                      <span className="font-bold text-white">
                        {(m.confidence * (m.confidence <= 1 ? 100 : 1)).toFixed(0)}%
                      </span>
                    </div>
                  )}
                  {m.deviceId && (
                    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1 col-span-2">
                      <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">Device ID</span>
                      <span className="font-mono text-zinc-300 truncate block">{m.deviceId}</span>
                    </div>
                  )}
                </div>

                {/* Optional Details description */}
                {m.details && !m.speedKmh && !m.magnitude && (
                  <p className="text-zinc-400 text-[10px] mt-1.5 pt-1.5 border-t border-zinc-900">{m.details}</p>
                )}

                {/* Footer Timestamp & GPS Coordinate */}
                <div className="mt-2 pt-1.5 border-t border-zinc-900 flex items-center justify-between text-[9px] font-mono text-zinc-500">
                  <span>{formatTimestamp(m.occurredAt) || 'Active'}</span>
                  <span>
                    {m.lat.toFixed(4)}, {m.lon.toFixed(4)}
                  </span>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
