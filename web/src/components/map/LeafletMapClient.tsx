'use client';

import { useEffect, useRef } from 'react';
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
import type { OSMMapProps, MapMarker } from './OSMMap';

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
      return 'bg-zinc-900 text-zinc-100 border-zinc-700';
    case 'high':
      return 'bg-zinc-900 text-zinc-200 border-zinc-700';
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
      // Pan to new coordinate while PRESERVING user's current zoom level
      map.panTo(mapCenter, { animate: true });
      prevCenterRef.current = [mapCenter[0], mapCenter[1]];
    }

    if (hasExplicitZoomPropChange) {
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

  let color = '#ffffff';
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

  const svgIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" width="28" height="28" style="filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.8)); transform: rotate(${m.heading ?? 0}deg);">
      ${m.type === 'vehicle' 
        ? `<path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>` 
        : `<circle cx="12" cy="12" r="9" stroke="#ffffff" stroke-width="2"/>`}
    </svg>
  `;

  return L.divIcon({
    className: 'custom-leaflet-icon',
    html: svgIcon,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export default function LeafletMapClient({
  center = [6.9150, 79.8520],
  zoom = 13,
  markers = [],
  polylines = [],
  hexagons = [],
  onMarkerClick,
  onMapClick,
  className = '',
}: OSMMapProps) {
  return (
    <div className={`w-full h-full rounded overflow-hidden border border-zinc-800 relative z-0 ${className}`}>
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
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

        {/* Markers */}
        {markers.map((m, idx) => (
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
                  {m.type === 'vehicle' ? (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-mono uppercase bg-zinc-900 text-zinc-300 border border-zinc-800 shrink-0">
                      LIVE
                    </span>
                  ) : m.severity ? (
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
                  {m.heading !== undefined && m.type === 'vehicle' && (
                    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded px-1.5 py-1">
                      <span className="text-zinc-500 block text-[9px] uppercase tracking-wider">Heading</span>
                      <span className="font-bold text-white">{m.heading.toFixed(0)}°</span>
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
                  <span>{m.lat.toFixed(4)}, {m.lon.toFixed(4)}</span>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
