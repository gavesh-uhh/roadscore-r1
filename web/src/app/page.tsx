'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/common/Header';
import { MapHexagon, MapMarker, MapPolyline, EventPulse, OSMMap } from '@/components/map/OSMMap';
import { CockpitHUD, CockpitAlert, RadarBlip } from '@/components/cockpit/CockpitHUD';
import { createClient } from '@/lib/supabase/client';
import {
  useRealtimeStream,
  TelemetryPacket,
  DrivingEventPacket,
} from '@/lib/realtime/useRealtimeStream';
import { cellToBoundary } from 'h3-js';
import {
  Activity,
  AlertTriangle,
  Car,
  Compass,
  MapPin,
  ShieldCheck,
  Square,
  Loader2,
  Gauge,
  X,
  Zap,
  Database,
  Radio,
} from 'lucide-react';
import { getFleetData } from '@/lib/fleet/api';
import type { DriverRecord } from '@/lib/fleet/types';
import {
  calculateContinuousScore24h,
  evaluateStreamHealth,
  StreamStatus,
  TelematicsEvent,
} from '@/lib/scoring/continuousEngine';
import { formatEventType } from '@/lib/events/format';
import { ScoreAuditDrawer } from '@/components/scoring/ScoreAuditDrawer';

interface TelemetryRow {
  device_id: string;
  ts: string;
  gps: { lat: number; lon: number; speed_kmh: number; heading: number } | null;
  accel_cal?: { vertical_rms?: number; horizontal_peak?: number } | null;
  server_received_at: string;
}

interface EventRow {
  event_key: string;
  device_id: string;
  type: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  occurred_at: string;
  lat: number | null;
  lon: number | null;
  speed_kmh: number | null;
  magnitude: number | null;
  magnitude_unit: string | null;
}

interface TripRow {
  trip_id: string;
  device_id: string;
  driver_id?: string | null;
  started_at: string;
  ended_at?: string | null;
  distance_m: number;
  duration_s: number;
  avg_speed_kmh: number;
  status: string;
}

interface RoadCellRow {
  h3_12: string;
  heading_sector?: number;
  roughness_index: number;
  pass_count: number;
  spike_count: number;
  speed_p85_kmh?: number;
  defect_confidence?: number;
}

interface DriverRow {
  driver_id: string;
  full_name: string;
  safety_score: number;
  assigned_vehicle: string;
  assigned_device_id: string | null;
  status: 'In Trip' | 'Idle';
  has_active_trip: boolean;
  active_trip_id: string | null;
}

export default function UnifiedOperationsDesk() {
  const [telemetry, setTelemetry] = useState<TelemetryRow[]>([]);
  const [totalTelemetryCount, setTotalTelemetryCount] = useState<number>(0);
  const [packetArrivals, setPacketArrivals] = useState<number[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [roadCells, setRoadCells] = useState<RoadCellRow[]>([]);
  const [roadDefects, setRoadDefects] = useState<any[]>([]);
  const [fleetDrivers, setFleetDrivers] = useState<DriverRecord[]>([]);
  const [telematicsEvents, setTelematicsEvents] = useState<TelematicsEvent[]>([]);
  const [decayTicker, setDecayTicker] = useState<number>(0);
  const [closingTripIds, setClosingTripIds] = useState<Set<string>>(new Set());

  // Realtime Map Pulses & Instant Alert Visualizer State
  const [activePulses, setActivePulses] = useState<EventPulse[]>([]);
  const [latestCriticalAlert, setLatestCriticalAlert] = useState<{
    event: EventRow;
    receivedAt: number;
  } | null>(null);

  // Selection & Map Focus State
  const [mapCenter, setMapCenter] = useState<[number, number]>([6.915, 79.852]);
  const [mapZoom, setMapZoom] = useState<number>(13);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [auditDriver, setAuditDriver] = useState<DriverRow | null>(null);
  const [showCockpitTwin, setShowCockpitTwin] = useState<boolean>(false);
  const [isMounted, setIsMounted] = useState<boolean>(false);

  const supabase = useMemo(() => createClient(), []);

  const handleEndTrip = async (tripId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!tripId || closingTripIds.has(tripId)) return;
    setClosingTripIds((prev) => new Set(prev).add(tripId));

    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/close`, {
        method: 'POST',
      });
      if (res.ok) {
        setTrips((prev) =>
          prev.map((t) =>
            t.trip_id === tripId
              ? { ...t, status: 'closed', ended_at: new Date().toISOString() }
              : t
          )
        );
      }
      await loadDatabaseData();
    } catch (err) {
      console.error('Failed to close trip:', err);
    } finally {
      setClosingTripIds((prev) => {
        const next = new Set(prev);
        next.delete(tripId);
        return next;
      });
    }
  };

  // Compute live stream health (Hz and connection status)
  const streamHealth = useMemo(() => {
    return evaluateStreamHealth(packetArrivals);
  }, [packetArrivals, decayTicker]);

  // Compute live continuous 24h score from real driving events with 0ms reactivity & exponential decay
  const drivers: DriverRow[] = useMemo(() => {
    return fleetDrivers.map((d) => {
      const assignedDev = d.assigned_device_id;
      const driverEvents = telematicsEvents.filter(
        (e) => e.driver_id === d.id || (assignedDev && e.device_id === assignedDev)
      );

      const continuousScore = calculateContinuousScore24h(driverEvents);

      const activeTrip = trips.find((t) => {
        const match = t.driver_id === d.id || (assignedDev && t.device_id === assignedDev);
        const st = String(t.status || '').toLowerCase();
        const isOpen = (st === 'open' || !t.ended_at) && st !== 'closed' && st !== 'abandoned';
        return match && isOpen;
      });

      return {
        driver_id: d.id,
        full_name: d.name,
        safety_score: continuousScore,
        assigned_vehicle: d.assigned_vehicle_plate || 'Unassigned',
        assigned_device_id: d.assigned_device_id || null,
        status: activeTrip ? 'In Trip' : 'Idle',
        has_active_trip: !!activeTrip,
        active_trip_id: activeTrip ? activeTrip.trip_id : null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetDrivers, telematicsEvents, trips, decayTicker]);

  const loadDatabaseData = useCallback(async () => {
    try {
      // 1. Fetch Drivers, Events, and exact Telemetry count strictly from Supabase DB
      const fleetData = await getFleetData(supabase);
      const [eventsRes, telRes, tripRes, cellRes, telCountRes, defectsRes] = await Promise.all([
        supabase.from('driving_events').select('*').order('occurred_at', { ascending: false }),
        supabase.from('telemetry').select('*').order('server_received_at', { ascending: false }).limit(100),
        supabase.from('trips').select('*').order('started_at', { ascending: false }).limit(15),
        supabase.from('road_cells').select('*').limit(60),
        supabase.from('telemetry').select('*', { count: 'exact', head: true }),
        supabase.from('road_defects').select('*').limit(50),
      ]);

      if (fleetData.drivers) {
        setFleetDrivers(fleetData.drivers);
      }
      if (telCountRes.count != null) {
        setTotalTelemetryCount(telCountRes.count);
      }
      if (defectsRes.data) {
        setRoadDefects(defectsRes.data);
      }

      const rawEvents = eventsRes.data || [];
      const allEvents: TelematicsEvent[] = rawEvents.map((e: any) => ({
        id: e.id,
        event_key: e.event_key,
        type: e.type,
        severity: e.severity,
        occurred_at: e.occurred_at,
        magnitude: e.magnitude != null ? Number(e.magnitude) : undefined,
        magnitude_unit: e.magnitude_unit || undefined,
        attributed_to_driver: e.attributed_to_driver,
        driver_id: e.driver_id,
        device_id: e.device_id,
      }));
      setTelematicsEvents(allEvents);

      const seenKeys = new Set<string>();
      const mappedEvents: EventRow[] = [];
      for (const e of rawEvents.slice(0, 40)) {
        const key = String(e.event_key || e.id || '');
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        mappedEvents.push({
          event_key: key,
          device_id: String(e.device_id || ''),
          type: String(e.type || ''),
          severity: (e.severity as any) || 'info',
          confidence: Number(e.confidence ?? 0),
          occurred_at: String(e.occurred_at || ''),
          lat: e.lat != null ? Number(e.lat) : null,
          lon: e.lon != null ? Number(e.lon) : null,
          speed_kmh: e.speed_kmh != null ? Number(e.speed_kmh) : null,
          magnitude: e.magnitude != null ? Number(e.magnitude) : null,
          magnitude_unit: e.magnitude_unit ? String(e.magnitude_unit) : null,
        });
      }
      setEvents(mappedEvents);

      if (telRes.data) {
        setTelemetry(
          telRes.data.map((r: any) => ({
            device_id: String(r.device_id || ''),
            ts: String(r.ts || r.server_received_at || ''),
            server_received_at: String(r.server_received_at || r.ts || ''),
            gps: r.gps || null,
            accel_cal: r.accel_cal || null,
          }))
        );

        const arrivalTimestamps = telRes.data
          .map((r: any) => new Date(r.server_received_at || r.ts || 0).getTime())
          .filter((t: number) => !isNaN(t) && t > 0);
        setPacketArrivals(arrivalTimestamps.slice(0, 50));
      }

      if (tripRes.data) {
        const mappedTrips: TripRow[] = tripRes.data.map((r: any) => ({
          trip_id: String(r.id || r.trip_id || ''),
          device_id: String(r.device_id || ''),
          driver_id: r.driver_id ? String(r.driver_id) : null,
          started_at: String(r.started_at || ''),
          ended_at: r.ended_at ? String(r.ended_at) : null,
          distance_m: Number(r.distance_m ?? 0),
          duration_s: Number(r.duration_s ?? 0),
          avg_speed_kmh: Number(r.avg_speed_kmh ?? ((r.avg_speed_mps || 0) * 3.6)),
          status: String(r.status || 'Active'),
        }));
        setTrips(mappedTrips);
        if (mappedTrips[0] && !selectedTripId) setSelectedTripId(mappedTrips[0].trip_id);
      }

      if (cellRes.data) {
        setRoadCells(cellRes.data as any);
      }
    } catch (err) {
      console.error('Error refreshing overview data:', err);
    }
  }, [supabase, selectedTripId]);

  // Auto-expire critical alert after 6s unless a new one arrives
  useEffect(() => {
    if (!latestCriticalAlert) return;
    const timer = setTimeout(() => {
      setLatestCriticalAlert(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [latestCriticalAlert]);

  // Realtime Stream Handlers
  const handleRealtimeTelemetry = useCallback((packet: TelemetryPacket) => {
    const now = Date.now();
    setTelemetry((prev) => {
      const row: TelemetryRow = {
        device_id: packet.device_id,
        ts: packet.ts,
        server_received_at: packet.server_received_at,
        gps: packet.gps,
        accel_cal: packet.accel_cal,
      };
      return [row, ...prev.filter((p) => p.device_id !== packet.device_id || p.ts !== packet.ts).slice(0, 99)];
    });
    setTotalTelemetryCount((prev) => prev + 1);
    setPacketArrivals((prev) => [now, ...prev.slice(0, 49)]);
  }, []);

  const handleRealtimeDrivingEvent = useCallback(
    (packet: DrivingEventPacket, rawPayload?: any) => {
      const key = packet.event_key;
      const newEvt: EventRow = {
        event_key: key,
        device_id: packet.device_id,
        type: packet.type,
        severity: packet.severity,
        confidence: packet.confidence,
        occurred_at: packet.occurred_at,
        lat: packet.lat,
        lon: packet.lon,
        speed_kmh: packet.speed_kmh,
        magnitude: packet.magnitude,
        magnitude_unit: packet.magnitude_unit,
      };

      const newTelEvt: TelematicsEvent = {
        id: rawPayload?.id || key,
        event_key: key,
        type: packet.type,
        severity: packet.severity,
        occurred_at: packet.occurred_at,
        magnitude: packet.magnitude ?? undefined,
        magnitude_unit: packet.magnitude_unit ?? undefined,
        attributed_to_driver: rawPayload?.attributed_to_driver ?? true,
        driver_id: rawPayload?.driver_id,
        device_id: packet.device_id,
      };

      setEvents((prev) => [newEvt, ...prev.filter((e) => e.event_key !== key)].slice(0, 40));
      setTelematicsEvents((prev) => [newTelEvt, ...prev.filter((e) => (e.event_key || e.id) !== key)]);

      // Radar pulse & instant alert banner for high/critical events
      if (packet.severity === 'critical' || packet.severity === 'high') {
        setLatestCriticalAlert({ event: newEvt, receivedAt: Date.now() });

        if (packet.lat && packet.lon) {
          const pulse: EventPulse = {
            id: `pulse-${key}-${Date.now()}`,
            lat: packet.lat,
            lon: packet.lon,
            severity: packet.severity,
            title: formatEventType(packet.type).label,
            eventType: packet.type,
            magnitude: packet.magnitude ?? undefined,
            occurredAt: packet.occurred_at,
          };
          setActivePulses((prev) => [pulse, ...prev.slice(0, 8)]);
        }
      }

      loadDatabaseData();
    },
    [loadDatabaseData]
  );

  const handleRealtimeTripChange = useCallback(() => {
    loadDatabaseData();
  }, [loadDatabaseData]);

  // Dual-Feed Realtime Hook: Fastify SSE (<10ms) with Supabase CDC Fallback
  const { feedMode, statusBadgeText, latencyMs, isSseActive } = useRealtimeStream({
    supabase,
    onTelemetry: handleRealtimeTelemetry,
    onDrivingEvent: handleRealtimeDrivingEvent,
    onTripChange: handleRealtimeTripChange,
    enabled: isMounted,
  });

  useEffect(() => {
    setIsMounted(true);
    loadDatabaseData();

    // Live continuous decay clock ticker (every 2.5s)
    const tickTimer = setInterval(() => {
      setDecayTicker((t) => t + 1);
    }, 2500);

    const interval = setInterval(() => {
      loadDatabaseData();
    }, 4000);

    return () => {
      clearInterval(interval);
      clearInterval(tickTimer);
    };
  }, [loadDatabaseData]);

  // Distinct, high-contrast curated color palette for fleet drivers and vehicles
  const DRIVER_PALETTE = [
    '#38bdf8', // Sky Blue (Driver 1 - ROADSCORE_001)
    '#f59e0b', // Amber (Driver 2 - DUMMY-001)
    '#a855f7', // Purple (Driver 3 - DUMMY-002)
    '#10b981', // Emerald (Driver 4 - DUMMY-003)
    '#f43f5e', // Rose (Driver 5 - DUMMY-004)
    '#06b6d4', // Cyan (Driver 6 - DUMMY-005)
    '#84cc16', // Lime (Driver 7 - DUMMY-006)
    '#ec4899', // Pink (Driver 8 - DUMMY-007)
    '#6366f1', // Indigo (Driver 9 - DUMMY-008)
    '#eab308', // Gold (Driver 10 - DUMMY-009)
  ];

  // Helper map for fast driver color lookup by device ID or driver ID
  const driverColorMap = new Map<string, string>();
  drivers.forEach((d, idx) => {
    const color = DRIVER_PALETTE[idx % DRIVER_PALETTE.length]!;
    driverColorMap.set(d.driver_id, color);
    if (d.assigned_device_id) {
      driverColorMap.set(d.assigned_device_id, color);
    }
  });

  // Construct Map Markers directly from DB records
  const mapMarkers: MapMarker[] = [];

  // Add device markers from latest telemetry in DB
  const devicePositions = new Map<string, TelemetryRow>();
  for (const t of telemetry) {
    if (t.gps?.lat && t.gps?.lon && !devicePositions.has(t.device_id)) {
      devicePositions.set(t.device_id, t);
    }
  }

  devicePositions.forEach((t, devId) => {
    const matchedDriver = drivers.find((d) => d.assigned_device_id === devId);
    const driverIdx = matchedDriver ? drivers.indexOf(matchedDriver) : -1;
    const color =
      driverColorMap.get(devId) ||
      (driverIdx >= 0 ? DRIVER_PALETTE[driverIdx % DRIVER_PALETTE.length] : DRIVER_PALETTE[mapMarkers.length % DRIVER_PALETTE.length]);

    mapMarkers.push({
      id: `dev-${devId}`,
      type: 'vehicle',
      lat: t.gps!.lat,
      lon: t.gps!.lon,
      heading: t.gps!.heading ?? 0,
      speedKmh: t.gps!.speed_kmh ?? 0,
      title: matchedDriver ? `${matchedDriver.full_name} (${devId})` : `Vehicle: ${devId}`,
      deviceId: devId,
      color,
      occurredAt: t.server_received_at || t.ts,
      details: matchedDriver
        ? `Driver: ${matchedDriver.full_name} | Vehicle: ${matchedDriver.assigned_vehicle} | Speed: ${t.gps!.speed_kmh?.toFixed(1) ?? '0'} km/h`
        : `Active Telemetry Stream | Received: ${t.server_received_at}`,
    });
  });

  // Filter events if driver is selected
  const activeDriver = selectedDriverId ? drivers.find((d) => d.driver_id === selectedDriverId) : null;
  const filteredEvents = activeDriver
    ? (activeDriver.assigned_device_id
        ? events.filter((e) => e.device_id === activeDriver.assigned_device_id)
        : [])
    : events;

  // Add event markers from DB (guaranteeing uniqueness & rich data)
  // Only surface HIGH-tier incidents (high + critical) on the map; hide low/medium/info clutter.
  const seenMarkerKeys = new Set<string>();
  for (const e of filteredEvents) {
    if (e.severity !== 'high' && e.severity !== 'critical') continue;
    if (e.lat && e.lon) {
      const markerId = `evt-${e.event_key}`;
      if (seenMarkerKeys.has(markerId)) continue;
      seenMarkerKeys.add(markerId);
      mapMarkers.push({
        id: markerId,
        type: 'event',
        severity: e.severity,
        lat: e.lat,
        lon: e.lon,
        title: formatEventType(e.type).label,
        eventType: e.type,
        deviceId: e.device_id,
        speedKmh: e.speed_kmh != null ? Number(e.speed_kmh) : undefined,
        magnitude: e.magnitude != null ? Number(e.magnitude) : undefined,
        magnitudeUnit: e.magnitude_unit || undefined,
        confidence: e.confidence != null ? Number(e.confidence) : undefined,
        occurredAt: e.occurred_at || undefined,
        details: e.magnitude ? `Magnitude: ${Number(e.magnitude).toFixed(2)} ${e.magnitude_unit || ''}` : `Speed: ${e.speed_kmh?.toFixed(1) ?? 'N/A'} km/h`,
      });
    }
  }

  // Build H3 Hexagons directly from DB road_cells
  const mapHexagons: MapHexagon[] = useMemo(() => {
    const list: MapHexagon[] = [];
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

      list.push({
        id: hexId,
        boundary,
        color,
        fillOpacity: 0.35,
        roughnessIndex: cell.roughness_index,
        passCount: cell.pass_count,
        spikeCount: cell.spike_count,
        speedP85: cell.speed_p85_kmh,
        defectConfidence: cell.defect_confidence,
        tooltipText: `H3 Index: ${cell.h3_12} | Roughness: ${cell.roughness_index.toFixed(1)}/100`,
      });
    }
    return list;
  }, [roadCells]);

  // Active cockpit driver (selected driver, or first driver by default)
  const currentCockpitDriver = useMemo(() => {
    if (selectedDriverId) {
      const match = drivers.find((d) => d.driver_id === selectedDriverId);
      if (match) return match;
    }
    return drivers[0] || null;
  }, [selectedDriverId, drivers]);

  // Cockpit driver items for the in-HUD switcher dropdown
  const cockpitDriverList = useMemo(() => {
    return drivers.map((d, idx) => ({
      id: d.driver_id,
      name: d.full_name,
      vehicle: d.assigned_vehicle,
      deviceId: d.assigned_device_id,
      color: driverColorMap.get(d.driver_id) || DRIVER_PALETTE[idx % DRIVER_PALETTE.length],
    }));
  }, [drivers, driverColorMap, DRIVER_PALETTE]);

  // Active device telemetry strictly for the chosen cockpit driver
  const activeDeviceTel = useMemo(() => {
    if (currentCockpitDriver?.assigned_device_id) {
      const match = telemetry.find((t) => t.device_id === currentCockpitDriver.assigned_device_id);
      if (match) return match;
    }
    return null;
  }, [currentCockpitDriver, telemetry]);

  const activeSpeed = activeDeviceTel?.gps?.speed_kmh != null ? Number(activeDeviceTel.gps.speed_kmh) : 0;
  const activeHeading = activeDeviceTel?.gps?.heading != null ? Number(activeDeviceTel.gps.heading) : 0;
  const activeVertG = activeDeviceTel?.accel_cal?.vertical_rms != null ? Number(activeDeviceTel.accel_cal.vertical_rms) : 1.0;
  const activeHorizG = activeDeviceTel?.accel_cal?.horizontal_peak != null ? Number(activeDeviceTel.accel_cal.horizontal_peak) : 0.0;

  // Real-time Lookahead Hazard Alert and Radar Blips computed dynamically from road defects and vehicle position
  const { cockpitAlert, cockpitRadarBlips, cockpitAdvisorySpeed } = useMemo(() => {
    const vehicleLat = activeDeviceTel?.gps?.lat;
    const vehicleLon = activeDeviceTel?.gps?.lon;

    if (!vehicleLat || !vehicleLon) {
      return { cockpitAlert: null, cockpitRadarBlips: [], cockpitAdvisorySpeed: null };
    }

    const blips: RadarBlip[] = [];
    let alert: CockpitAlert | null = null;
    let advisorySpeed: number | null = null;

    // 1. Check known confirmed road defects
    for (const d of roadDefects) {
      if (!d.lat || !d.lon) continue;
      const dLat = (d.lat - vehicleLat) * 111320;
      const dLon = (d.lon - vehicleLon) * 111320 * Math.cos((vehicleLat * Math.PI) / 180);
      const distM = Math.sqrt(dLat * dLat + dLon * dLon);

      if (distM <= 220) {
        const bearingDeg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
        let relAngle = bearingDeg - activeHeading;
        while (relAngle > 180) relAngle -= 360;
        while (relAngle < -180) relAngle += 360;

        if (Math.abs(relAngle) <= 45) {
          blips.push({
            id: `defect-${d.id}`,
            distanceM: distM,
            angleDeg: Math.max(-30, Math.min(30, relAngle)),
            severity: d.severity || 'high',
            type: 'road.pothole_impact',
            title: d.severity === 'critical' ? 'Severe Pothole' : 'Road Defect',
          });

          if (distM <= 180 && Math.abs(relAngle) <= 25 && (!alert || distM < alert.distanceM)) {
            const eta = activeSpeed > 5 ? distM / (activeSpeed / 3.6) : distM / 5;
            const safeSpeed = d.severity === 'critical' ? 25 : 35;
            alert = {
              id: `alert-${d.id}`,
              title: d.severity === 'critical' ? 'Severe Hazard Ahead' : 'Rough Surface Ahead',
              type: 'road.hazard_ahead',
              severity: d.severity || 'high',
              distanceM: distM,
              etaS: Math.min(15, Math.max(0.5, eta)),
              advisorySpeedKmh: safeSpeed,
            };
            advisorySpeed = safeSpeed;
          }
        }
      }
    }

    // 2. Check active driving events nearby
    if (!alert && events.length > 0) {
      const nearEvent = events.find((e) => {
        if (!e.lat || !e.lon) return false;
        const dLat = (e.lat - vehicleLat) * 111320;
        const dLon = (e.lon - vehicleLon) * 111320 * Math.cos((vehicleLat * Math.PI) / 180);
        return Math.sqrt(dLat * dLat + dLon * dLon) < 80;
      });

      if (nearEvent) {
        alert = {
          id: `alert-event-${nearEvent.event_key}`,
          title: String(nearEvent.type || 'Incident').replace(/_/g, ' ').toUpperCase(),
          type: nearEvent.type,
          severity: nearEvent.severity || 'medium',
          distanceM: 40,
          etaS: activeSpeed > 5 ? 40 / (activeSpeed / 3.6) : 3.0,
          advisorySpeedKmh: 35,
        };
        advisorySpeed = 35;
      }
    }

    return {
      cockpitAlert: alert,
      cockpitRadarBlips: blips.slice(0, 6),
      cockpitAdvisorySpeed: advisorySpeed,
    };
  }, [activeDeviceTel, activeHeading, activeSpeed, roadDefects, events]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-black text-white font-sans text-xs">
      <Header title="Operations Desk" subtitle="Live telemetry, incident tracking, and route dispatch" />

      {/* Top Status Bar */}
      <div className="bg-zinc-950 border-b border-zinc-800 px-4 py-2 flex items-center justify-between text-xs shrink-0 select-none">
        <div className="flex items-center gap-5">
          {/* Stream Status Badge */}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0">
              {streamHealth.status === 'streaming' && (
                <span className="animate-live-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              {streamHealth.status === 'intermittent' && (
                <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  streamHealth.status === 'streaming'
                    ? 'bg-emerald-500'
                    : streamHealth.status === 'intermittent'
                    ? 'bg-amber-500'
                    : streamHealth.status === 'idle'
                    ? 'bg-zinc-600'
                    : 'bg-rose-500'
                }`}
              />
            </span>
            <span className="text-zinc-400 font-medium">
              {streamHealth.status === 'streaming'
                ? `Live Ingest (${streamHealth.rateHz} Hz)`
                : streamHealth.status === 'intermittent'
                ? 'Intermittent Ingest'
                : streamHealth.status === 'idle'
                ? `Stream Idle (${streamHealth.lastSeenSecAgo < 900 ? `${streamHealth.lastSeenSecAgo}s ago` : 'offline'})`
                : 'Stream Disconnected'}
            </span>
            <span className="font-mono font-bold text-white ml-1">
              {totalTelemetryCount > 0 ? totalTelemetryCount : telemetry.length} Packets
            </span>
          </div>

          {/* Dual-Feed Active Mode Badge */}
          {feedMode === 'sse' ? (
            <div
              title="Fast direct stream from engine (<10ms latency)"
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/80 text-emerald-300 font-mono text-[11px] font-bold shadow-[0_0_10px_rgba(16,185,129,0.25)]"
            >
              <Zap size={12} className="text-emerald-400 fill-emerald-400 animate-pulse" />
              <span>FAST STREAM (SSE)</span>
              {latencyMs !== null && (
                <span className="text-[10px] text-emerald-400/80 font-normal ml-0.5">(&lt;10ms)</span>
              )}
            </div>
          ) : (
            <div
              title="Standard fallback via cloud database sync"
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-amber-950/70 border border-amber-600/70 text-amber-300 font-mono text-[11px] font-bold shadow-[0_0_10px_rgba(245,158,11,0.2)]"
            >
              <Database size={12} className="text-amber-400" />
              <span>SLOW STREAM (Cloud CDC)</span>
              <span className="text-[10px] text-amber-400/80 font-normal ml-0.5">(Supabase)</span>
            </div>
          )}

          {/* Real-time Spike Alert Badge in Top Status Bar */}
          {latestCriticalAlert && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/90 border border-rose-500 text-rose-300 font-mono text-[10px] font-bold animate-alert-flash">
              <AlertTriangle size={11} className="text-rose-400 animate-bounce" />
              <span>CRITICAL EVENT SPIKE</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-zinc-400 font-medium">Active Incidents</span>
            <span className="font-mono font-bold text-amber-400 ml-1">{events.length} Events</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-zinc-400 font-medium">Active Trips</span>
            <span className="font-mono font-bold text-white ml-1">{trips.length} Routes</span>
          </div>
        </div>

        <div className="text-[11px] text-zinc-500 font-mono flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>60 FPS Dead-Reckoning</span>
        </div>
      </div>

      {/* Main 3-Pane Operations Workspace */}
      <div className="flex-1 flex overflow-hidden p-3 gap-3 min-h-0">
        {/* PANE 1: LEFT PANEL - Driver Safety & Trips */}
        <div className="w-80 bg-zinc-950 rounded-md flex flex-col overflow-hidden border border-zinc-800 text-xs shrink-0 min-h-0">
          {/* Driver Safety */}
          <div className="px-3 py-2 bg-zinc-900/60 font-semibold text-white flex items-center justify-between border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-2">
              <span>Drivers</span>
              {drivers.filter((d) => d.has_active_trip).length > 0 && (
                <span className="text-[10px] text-emerald-400 font-mono font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {drivers.filter((d) => d.has_active_trip).length} in trip
                </span>
              )}
            </div>
            <span className="text-[11px] text-zinc-400 font-mono">{drivers.length} Total</span>
          </div>

          <div className="p-2 space-y-1 overflow-y-auto max-h-48 shrink-0 border-b border-zinc-800/60">
            {drivers.length === 0 ? (
              <div className="p-4 text-center text-zinc-500 text-[11px]">
                No driver records found.
              </div>
            ) : (
              drivers.map((driver, idx) => {
                const isSelected = selectedDriverId === driver.driver_id;
                const driverKey = driver.driver_id ? `driver-${driver.driver_id}-${idx}` : `driver-${idx}`;
                const driverColor =
                  driverColorMap.get(driver.driver_id) ||
                  (driver.assigned_device_id ? driverColorMap.get(driver.assigned_device_id) : undefined) ||
                  DRIVER_PALETTE[idx % DRIVER_PALETTE.length]!;

                const handleFocusDriver = () => {
                  setSelectedDriverId(driver.driver_id);
                  const devId = driver.assigned_device_id;
                  const pos = devId ? devicePositions.get(devId) : null;
                  if (pos?.gps?.lat != null && pos?.gps?.lon != null && Number.isFinite(pos.gps.lat) && Number.isFinite(pos.gps.lon)) {
                    setMapCenter([pos.gps.lat, pos.gps.lon]);
                    setMapZoom(16);
                  } else {
                    setMapCenter([6.915, 79.852]);
                    setMapZoom(15);
                  }
                };

                return (
                  <div
                    key={driverKey}
                    title="Click to select | Double-click to focus marker on map"
                    onClick={() => {
                      const isCurrentlySelected = selectedDriverId === driver.driver_id;
                      setSelectedDriverId((prev) => (prev === driver.driver_id ? null : driver.driver_id));
                      if (!isCurrentlySelected) {
                        const devId = driver.assigned_device_id;
                        const pos = devId ? devicePositions.get(devId) : null;
                        if (pos?.gps?.lat != null && pos?.gps?.lon != null && Number.isFinite(pos.gps.lat) && Number.isFinite(pos.gps.lon)) {
                          setMapCenter([pos.gps.lat, pos.gps.lon]);
                        }
                      }
                    }}
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      handleFocusDriver();
                    }}
                    className={`p-2 rounded-md cursor-pointer transition-all flex items-center justify-between border select-none group ${
                      isSelected
                        ? 'bg-zinc-900 border-zinc-700 text-white shadow-sm'
                        : 'bg-zinc-950 border-zinc-800/40 hover:bg-zinc-900/50 hover:border-zinc-700/60 text-zinc-400'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Driver Unique Color Indicator Badge */}
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0 border transition-transform group-hover:scale-125"
                        style={{
                          backgroundColor: driverColor,
                          borderColor: '#ffffff',
                          borderWidth: '1px',
                          boxShadow: `0 0 8px ${driverColor}aa`,
                        }}
                        title={`Driver Map Marker Color: ${driverColor}`}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-white text-xs truncate">{driver.full_name}</p>
                          {driver.has_active_trip && (
                            <span className="inline-flex items-center gap-1 px-1 py-0.2 rounded-xs bg-emerald-950/90 border border-emerald-700/60 text-emerald-400 text-[9px] font-mono font-bold tracking-tight shrink-0">
                              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-live-ping" />
                              TRIP
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-500 font-mono truncate">{driver.assigned_vehicle}</p>
                      </div>
                    </div>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setAuditDriver(driver);
                      }}
                      title="Click to view itemized score deduction audit"
                      className={`px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-bold cursor-pointer transition-transform hover:scale-105 shrink-0 ${
                        driver.safety_score >= 90
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                          : driver.safety_score >= 75
                          ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                          : 'bg-rose-950 text-rose-400 border border-rose-800/60'
                      }`}
                    >
                      {driver.safety_score.toFixed(1)}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Active Trips Directory */}
          <div className="px-3 py-2 bg-zinc-900/60 font-semibold text-white flex items-center justify-between border-b border-zinc-800 shrink-0">
            <span>Recent Trips</span>
            <span className="text-[11px] text-zinc-400 font-mono">
              {trips.filter((t) => (String(t.status || '').toLowerCase() === 'open' || !t.ended_at) && String(t.status || '').toLowerCase() !== 'closed' && String(t.status || '').toLowerCase() !== 'abandoned').length} Active / {trips.length} Total
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
            {trips.length === 0 ? (
              <div className="p-4 text-center text-zinc-500 text-[11px]">
                No trips recorded.
              </div>
            ) : (
              trips.map((trip, idx) => {
                const distanceKm = ((trip.distance_m || 0) / 1000).toFixed(1);
                const durationMin = ((trip.duration_s || 0) / 60).toFixed(0);
                const tripIdStr = String(trip.trip_id || (trip as any).id || `trip-${idx}`);
                const isSelected = selectedTripId === tripIdStr;
                const st = String(trip.status || '').toLowerCase();
                const isOpen = (st === 'open' || !trip.ended_at) && st !== 'closed' && st !== 'abandoned';
                const isClosing = closingTripIds.has(tripIdStr);

                return (
                  <div
                    key={`trip-${tripIdStr}-${idx}`}
                    onClick={() => {
                      setSelectedTripId((prev) => (prev === tripIdStr ? null : tripIdStr));
                      setMapCenter([6.918, 79.856]);
                    }}
                    className={`p-2 rounded-md cursor-pointer transition-colors space-y-1 border ${
                      isSelected
                        ? 'bg-zinc-900 border-zinc-700 text-white'
                        : 'bg-zinc-950 border-zinc-800/40 hover:bg-zinc-900/50 text-zinc-400'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isOpen && (
                          <span className="relative flex h-1.5 w-1.5 shrink-0">
                            <span className="animate-live-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                          </span>
                        )}
                        <span className="font-medium text-white text-xs font-mono truncate">
                          {tripIdStr.length > 14 ? `${tripIdStr.slice(0, 14)}...` : tripIdStr}
                        </span>
                      </div>
                      <span className="text-xs font-mono font-bold text-zinc-300">{distanceKm} km</span>
                    </div>

                    <div className="flex items-center justify-between text-zinc-500 text-[10px]">
                      <span className="font-mono">{trip.device_id}</span>
                      <div className="flex items-center gap-1.5">
                        <span>{durationMin} mins</span>
                        {isOpen && (
                          <button
                            onClick={(e) => handleEndTrip(tripIdStr, e)}
                            disabled={isClosing}
                            className="px-1.5 py-0.5 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/80 font-medium text-[9px] transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                            title="Force finalize and close active trip"
                          >
                            {isClosing ? (
                              <Loader2 size={9} className="animate-spin text-rose-300" />
                            ) : (
                              <Square size={7} className="fill-current" />
                            )}
                            <span>End</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* PANE 2: CENTER PANEL - Map View */}
        <div className="flex-1 rounded-md overflow-hidden relative border border-zinc-800 flex flex-col min-h-0 bg-zinc-950">
          {/* Top Floating Control Bar */}
          <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
            <button
              onClick={() => setShowCockpitTwin(!showCockpitTwin)}
              className={`px-2.5 py-1.5 rounded-md text-[10px] font-mono font-bold tracking-wider uppercase transition-all shadow-lg flex items-center gap-1.5 border backdrop-blur-sm ${
                showCockpitTwin
                  ? 'bg-emerald-950/90 text-emerald-300 border-emerald-600 ring-1 ring-emerald-500/50'
                  : 'bg-zinc-950/90 text-zinc-300 border-zinc-800 hover:border-zinc-600 hover:text-white'
              }`}
            >
              <Gauge size={12} className={showCockpitTwin ? 'text-emerald-400' : 'text-zinc-400'} />
              <span>{showCockpitTwin ? 'Close Cockpit Twin' : 'In-Cabin Cockpit Twin'}</span>
            </button>
          </div>

          <div className="flex-1 relative">
            <OSMMap
              center={mapCenter}
              zoom={mapZoom}
              markers={mapMarkers}
              hexagons={mapHexagons}
              eventPulses={activePulses}
              onMarkerClick={(m) => {
                const evt = events.find((e) => e.event_key === m.id.replace('evt-', ''));
                if (evt) setSelectedEvent(evt);
              }}
            />

            {/* Floating Live Cockpit HUD Overlay */}
            <AnimatePresence>
              {showCockpitTwin && (
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 20, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="absolute bottom-3 right-3 left-3 md:left-auto md:w-[460px] z-20 shadow-2xl rounded-lg border border-zinc-700/80 overflow-hidden bg-black/95 backdrop-blur-md"
                >
                  <CockpitHUD
                    speedKmh={activeSpeed}
                    heading={activeHeading}
                    gForce={{ vertical: activeVertG, lateral: activeHorizG }}
                    activeAlert={cockpitAlert}
                    radarBlips={cockpitRadarBlips}
                    advisorySpeedKmh={cockpitAdvisorySpeed}
                    isLive={true}
                    vehicleName={currentCockpitDriver?.assigned_vehicle || currentCockpitDriver?.assigned_device_id || 'Fleet Vehicle'}
                    driverName={currentCockpitDriver?.full_name}
                    driverColor={
                      currentCockpitDriver
                        ? driverColorMap.get(currentCockpitDriver.driver_id) || DRIVER_PALETTE[0]
                        : undefined
                    }
                    driverList={cockpitDriverList}
                    selectedDriverId={currentCockpitDriver?.driver_id || null}
                    onSelectDriver={(dId) => {
                      setSelectedDriverId(dId);
                      const d = drivers.find((drv) => drv.driver_id === dId);
                      const pos = d?.assigned_device_id ? devicePositions.get(d.assigned_device_id) : null;
                      if (pos?.gps?.lat != null && pos?.gps?.lon != null && Number.isFinite(pos.gps.lat) && Number.isFinite(pos.gps.lon)) {
                        setMapCenter([pos.gps.lat, pos.gps.lon]);
                      }
                    }}
                    compact={true}
                    timestamp={new Date().toLocaleTimeString()}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* PANE 3: RIGHT PANEL - Anomaly Event Stream */}
        <div className="w-84 bg-zinc-950 rounded-md flex flex-col overflow-hidden border border-zinc-800 text-xs shrink-0 min-h-0">
          <div className="px-3 py-2 bg-zinc-900/60 font-semibold text-white flex items-center justify-between border-b border-zinc-800 shrink-0">
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={13} className="text-amber-400" />
              Incident Stream
              {activeDriver && (
                <span className="text-[10px] text-emerald-400 font-normal">
                  ({activeDriver.full_name.split(' ')[0]})
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {activeDriver && (
                <button
                  type="button"
                  onClick={() => setSelectedDriverId(null)}
                  className="text-[10px] text-zinc-400 hover:text-white underline cursor-pointer"
                >
                  Clear
                </button>
              )}
              <span className="text-[11px] text-zinc-400 font-mono">{filteredEvents.length} Events</span>
            </div>
          </div>

          {/* Real-time Critical Event Pulse Banner */}
          <AnimatePresence>
            {latestCriticalAlert && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -8 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="m-2 p-2.5 rounded-md border border-rose-500/80 bg-gradient-to-r from-rose-950/90 via-rose-900/60 to-zinc-950 text-white shadow-lg animate-alert-flash shrink-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle size={14} className="text-rose-400 mt-0.5 shrink-0 animate-bounce" />
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5 font-bold text-white text-[11px] font-sans">
                        <span className="truncate">{formatEventType(latestCriticalAlert.event.type).label}</span>
                        <span className="px-1 py-0.2 rounded text-[8px] font-mono uppercase bg-rose-900 text-rose-200 border border-rose-700">
                          {latestCriticalAlert.event.severity}
                        </span>
                      </div>
                      <p className="text-[10px] text-rose-200 font-mono truncate">
                        Device: {latestCriticalAlert.event.device_id} | Mag: {latestCriticalAlert.event.magnitude ?? 'N/A'}{latestCriticalAlert.event.magnitude_unit ?? 'g'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setLatestCriticalAlert(null)}
                    className="text-zinc-400 hover:text-white p-0.5 rounded cursor-pointer shrink-0"
                  >
                    <X size={12} />
                  </button>
                </div>

                {latestCriticalAlert.event.lat && latestCriticalAlert.event.lon && (
                  <div className="mt-2 pt-1.5 border-t border-rose-800/60 flex items-center justify-between text-[9px] font-mono text-rose-300">
                    <span>{latestCriticalAlert.event.lat.toFixed(4)}, {latestCriticalAlert.event.lon.toFixed(4)}</span>
                    <button
                      onClick={() => {
                        if (latestCriticalAlert.event.lat && latestCriticalAlert.event.lon) {
                          setMapCenter([latestCriticalAlert.event.lat, latestCriticalAlert.event.lon]);
                          setSelectedEvent(latestCriticalAlert.event);
                        }
                      }}
                      className="px-1.5 py-0.5 rounded bg-rose-900/80 hover:bg-rose-800 text-white border border-rose-700 cursor-pointer font-sans text-[9px] flex items-center gap-1"
                    >
                      <MapPin size={9} />
                      <span>Locate on Map</span>
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-0">
            {filteredEvents.length === 0 ? (
              <div className="p-8 text-center text-zinc-500 space-y-1">
                <Activity className="w-5 h-5 mx-auto text-zinc-600" />
                <p className="text-xs font-medium text-zinc-400">Incident Feed Idle</p>
                <p className="text-[10px] text-zinc-600">No driving events logged</p>
              </div>
            ) : (
              filteredEvents.map((evt, idx) => {
                const isSelected = selectedEvent?.event_key === evt.event_key;
                const isCritical = evt.severity === 'critical' || evt.severity === 'high';
                const eventKey = evt.event_key ? `evt-${evt.event_key}-${idx}` : `evt-${idx}`;

                return (
                  <motion.div
                    key={eventKey}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    onClick={() => {
                      setSelectedEvent(evt);
                      if (evt.lat && evt.lon) setMapCenter([evt.lat, evt.lon]);
                    }}
                    className={`p-2 rounded-md border cursor-pointer transition-colors space-y-1 ${
                      isSelected
                        ? 'bg-zinc-900 border-zinc-700 text-white'
                        : isCritical
                        ? 'bg-rose-950/30 border-rose-800/50 text-zinc-300'
                        : 'bg-zinc-950 border-zinc-800/40 text-zinc-300 hover:bg-zinc-900/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 font-semibold text-white text-[11px] font-sans">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: formatEventType(evt.type).dotColor }}
                          />
                          <span>{formatEventType(evt.type).label}</span>
                        </div>
                        <span className="text-[9px] text-zinc-500 font-mono block pl-3">{evt.type}</span>
                      </div>

                      <span
                        className={`px-1.5 py-0.5 rounded-sm text-[9px] font-mono font-bold uppercase border shrink-0 ${
                          evt.severity === 'critical'
                            ? 'bg-rose-950 text-rose-400 border-rose-800/60'
                            : evt.severity === 'high'
                            ? 'bg-amber-950 text-amber-400 border-amber-800/60'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        {evt.severity}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
                      <span>Device: {evt.device_id}</span>
                      <span>Mag: {evt.magnitude ?? 'N/A'} {evt.magnitude_unit ?? ''}</span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1 border-t border-zinc-900">
                      <span className="flex items-center gap-1 font-mono">
                        <MapPin size={10} className="text-emerald-400" />
                        <span>
                          {evt.lat ? `${evt.lat.toFixed(3)}, ${evt.lon?.toFixed(3)}` : 'No GPS'}
                        </span>
                      </span>
                      <span className="font-mono" suppressHydrationWarning>
                        {isMounted && evt.occurred_at ? new Date(evt.occurred_at).toLocaleTimeString() : (evt.occurred_at ? evt.occurred_at.slice(11, 19) : '')}
                      </span>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {auditDriver && (
        <ScoreAuditDrawer
          isOpen={!!auditDriver}
          onClose={() => setAuditDriver(null)}
          driverName={auditDriver.full_name}
          vehiclePlate={auditDriver.assigned_vehicle}
          currentScore={auditDriver.safety_score}
          events={
            auditDriver.assigned_device_id
              ? telematicsEvents.filter(
                  (e) =>
                    e.driver_id === auditDriver.driver_id ||
                    e.device_id === auditDriver.assigned_device_id
                )
              : telematicsEvents.filter((e) => e.driver_id === auditDriver.driver_id)
          }
        />
      )}
    </div>
  );
}
