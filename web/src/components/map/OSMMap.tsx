'use client';

import dynamic from 'next/dynamic';

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  title: string;
  type?: 'vehicle' | 'event' | 'defect' | 'prediction' | 'start' | 'end' | 'waypoint';
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  details?: string;
  heading?: number;
  speedKmh?: number;
  magnitude?: number;
  magnitudeUnit?: string;
  confidence?: number;
  occurredAt?: string;
  deviceId?: string;
  eventType?: string;
  h3_12?: string;
  category?: string;
}

export interface MapPolyline {
  id: string;
  positions: [number, number][];
  color?: string;
  weight?: number;
  opacity?: number;
  dashArray?: string;
}

export interface MapHexagon {
  id: string;
  boundary: [number, number][]; // Array of [lat, lon]
  color: string;
  fillOpacity: number;
  tooltipText?: string;
  roughnessIndex?: number;
  passCount?: number;
  spikeCount?: number;
  speedP85?: number;
  defectConfidence?: number;
}

export interface OSMMapProps {
  center?: [number, number];
  zoom?: number;
  markers?: MapMarker[];
  polylines?: MapPolyline[];
  hexagons?: MapHexagon[];
  onMarkerClick?: (marker: MapMarker) => void;
  onMapClick?: (coords: [number, number]) => void;
  className?: string;
}

const LeafletMapClient = dynamic(() => import('./LeafletMapClient'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-zinc-950 border border-zinc-800 rounded flex items-center justify-center text-zinc-500 font-sans text-xs">
      Initializing Spatial Map...
    </div>
  ),
});

export function OSMMap(props: OSMMapProps) {
  return <LeafletMapClient {...props} />;
}
