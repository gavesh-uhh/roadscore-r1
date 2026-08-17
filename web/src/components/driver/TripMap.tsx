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
import type { GeoPosition, HorizonHazard, TripState, KnownRoadDefect } from '@/lib/sim/demoSimulator';
import { HAZARD_SHORT } from './hazardMeta';
import { Compass, Navigation, Radio, Clock, Route } from 'lucide-react';

export interface TripMapProps {
  position: GeoPosition;
  breadcrumbs: readonly [number, number][];
  hazards: HorizonHazard[];
  knownDefects?: KnownRoadDefect[];
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
  knownDefects = [],
  trip,
  speedKmh,
  pulses,
  className = '',
}: TripMapProps) {
  const safeLat = Number.isFinite(position?.lat) ? position.lat : 6.9271;
  const safeLon = Number.isFinite(position?.lon) ? position.lon : 79.8612;
  const heading = Number.isFinite(position?.headingDeg) ? position.headingDeg : 0;
  const cardinal = getCardinal(heading);

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [
      {
        id: 'ego',
        lat: safeLat,
        lon: safeLon,
        title: trip.active ? 'On Trip' : 'Vehicle Position',
        type: 'vehicle',
        heading,
        speedKmh: Number.isFinite(speedKmh) ? speedKmh : 0,
      },
    ];

    // Trip start pin
    if (trip.active && breadcrumbs.length > 0) {
      const [slat, slon] = breadcrumbs[0];
      if (Number.isFinite(slat) && Number.isFinite(slon)) {
        list.push({
          id: 'trip-start',
          lat: slat,
          lon: slon,
          title: 'Trip Started',
          type: 'start',
          details: trip.startedAt ? new Date(trip.startedAt).toLocaleTimeString() : undefined,
        });
      }
    }

    // Static known defects on map (if not already active in dynamic horizon hazards)
    const activeHazardIds = new Set(hazards.map((h) => h.id.replace('def_', '')));
    for (const d of knownDefects) {
      if (activeHazardIds.has(d.id)) continue;
      if (!Number.isFinite(d.lat) || !Number.isFinite(d.lon)) continue;
      list.push({
        id: `map_def_${d.id}`,
        lat: d.lat,
        lon: d.lon,
        title: `Defect: ${d.severity.toUpperCase()}`,
        type: 'defect',
        severity: d.severity,
        details: d.h3_12 ? `H3: ${d.h3_12}` : undefined,
      });
    }

    // Projected hazards on the horizon
    for (const h of hazards) {
      if (!Number.isFinite(h.lat) || !Number.isFinite(h.lon)) continue;
      list.push({
        id: h.id,
        lat: h.lat!,
        lon: h.lon!,
        title: `${HAZARD_SHORT[h.kind]} · ${Math.max(0, Math.round(h.distanceM))}m`,
        type: h.kind === 'traffic_queue' ? 'waypoint' : 'defect',
        severity: h.severity,
        details: h.advisory,
      });
    }
    return list;
  }, [safeLat, safeLon, heading, breadcrumbs, hazards, knownDefects, trip, speedKmh]);

  const polylines = useMemo<MapPolyline[]>(() => {
    if (breadcrumbs.length < 2) return [];

    // Filter out initial teleport / jump from 0 or default starting point
    const validCrumbs: [number, number][] = [];
    for (let i = 0; i < breadcrumbs.length; i++) {
      const pt = breadcrumbs[i];
      if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;

      if (validCrumbs.length > 0) {
        const prev = validCrumbs[validCrumbs.length - 1];
        // Approximate distance in km
        const dLat = (pt[0] - prev[0]) * 111;
        const dLon = (pt[1] - prev[1]) * 111 * Math.cos((prev[0] * Math.PI) / 180);
        const distKm = Math.hypot(dLat, dLon);

        // If a jump > 400m occurs (e.g. from initial 0 or dummy coordinate to live location),
        // reset to start cleanly from the actual vehicle's live track.
        if (distKm > 0.4) {
          validCrumbs.length = 0;
        }
      }
      validCrumbs.push([pt[0], pt[1]]);
    }

    if (validCrumbs.length < 2) return [];

    return [
      {
        id: 'trip-trail',
        positions: validCrumbs,
        color: '#10b981',
        weight: 4,
        opacity: 0.85,
      },
    ];
  }, [breadcrumbs]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <OSMMap
        center={[safeLat, safeLon]}
        zoom={16}
        markers={markers}
        polylines={polylines}
        eventPulses={pulses}
        className="absolute inset-0"
      />

      {/* Minimal Driver Spatial Overlay (Heading & Trip Distance - Anchored Top-Left) */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
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
