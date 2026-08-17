'use client';

/**
 * TripMap — High-Tech Live Cockpit Spatial Map (DRIVER_VIEW_V2_PLAN §3.4)
 *
 * Renders the cockpit's spatial view over the dark OSM map with:
 *  - Real-time ego vehicle marker (heading-aware arrow + speed halo)
 *  - Emerald breadcrumb trail
 *  - Projected horizon hazard markers with vector types and severity colors
 *  - Exoneration & harsh maneuver event pulse rings
 *  - Top glassmorphic telemetry HUD (heading, cardinal, distance, duration, GPS lock)
 */

import { useMemo } from 'react';
import { OSMMap, type MapMarker, type MapPolyline, type EventPulse } from '@/components/map/OSMMap';
import type { GeoPosition, HorizonHazard, TripState } from '@/lib/sim/demoSimulator';
import { HAZARD_SHORT } from './hazardMeta';
import { Compass, Navigation, Radio, Clock, Route } from 'lucide-react';

export interface TripMapProps {
  position: GeoPosition;
  breadcrumbs: readonly [number, number][];
  hazards: HorizonHazard[];
  trip: TripState;
  speedKmh: number;
  pulses: EventPulse[];
  className?: string;
}

function getCardinal(deg: number): string {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return directions[index];
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TripMap({
  position,
  breadcrumbs,
  hazards,
  trip,
  speedKmh,
  pulses,
  className = '',
}: TripMapProps) {
  const heading = position.headingDeg ?? 0;
  const cardinal = getCardinal(heading);

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [
      {
        id: 'ego',
        lat: position.lat,
        lon: position.lon,
        title: trip.active ? 'On Trip' : 'Vehicle Position',
        type: 'vehicle',
        heading: position.headingDeg,
        speedKmh,
      },
    ];

    // Trip start pin
    if (trip.active && breadcrumbs.length > 0) {
      const [slat, slon] = breadcrumbs[0];
      list.push({
        id: 'trip-start',
        lat: slat,
        lon: slon,
        title: 'Trip Started',
        type: 'start',
        details: trip.startedAt ? new Date(trip.startedAt).toLocaleTimeString() : undefined,
      });
    }

    // Projected hazards on the horizon
    for (const h of hazards) {
      if (h.lat == null || h.lon == null) continue;
      list.push({
        id: h.id,
        lat: h.lat,
        lon: h.lon,
        title: `${HAZARD_SHORT[h.kind]} · ${Math.max(0, Math.round(h.distanceM))}m`,
        type: h.kind === 'traffic_queue' ? 'waypoint' : 'defect',
        severity: h.severity,
        details: h.advisory,
      });
    }
    return list;
  }, [position, breadcrumbs, hazards, trip, speedKmh]);

  const polylines = useMemo<MapPolyline[]>(() => {
    if (breadcrumbs.length < 2) return [];
    return [
      {
        id: 'trip-trail',
        positions: breadcrumbs.map(([lat, lon]) => [lat, lon] as [number, number]),
        color: '#10b981',
        weight: 4,
        opacity: 0.8,
      },
    ];
  }, [breadcrumbs]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <OSMMap
        center={[position.lat, position.lon]}
        zoom={16}
        markers={markers}
        polylines={polylines}
        eventPulses={pulses}
        className="absolute inset-0"
      />

      {/* Minimal Driver Spatial Overlay (Heading & Trip Distance - Anchored Top-Left) */}
      <div className="pointer-events-none absolute left-3 top-3 z-[500] flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-full border border-zinc-800/80 bg-black/80 px-3 py-1.5 text-[10px] font-mono font-bold text-zinc-200 backdrop-blur-md shadow-lg shadow-black/80">
          <Compass size={12} className="text-sky-400" />
          <span>
            {Math.round(heading)}° {cardinal}
          </span>
          {trip.active && (
            <>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-300">{(trip.distanceM / 1000).toFixed(1)} km</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
