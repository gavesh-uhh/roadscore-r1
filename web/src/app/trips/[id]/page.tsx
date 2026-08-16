'use client';

import { use, useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { MapMarker, MapPolyline, OSMMap } from '@/components/map/OSMMap';
import { CockpitHUD, CockpitAlert, RadarBlip } from '@/components/cockpit/CockpitHUD';
import { createClient } from '@/lib/supabase/client';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import {
  ArrowLeft,
  Play,
  Pause,
  Activity,
  AlertTriangle,
  Radio,
  Layers,
  Gauge,
  ShieldCheck,
  Car,
  User,
  Loader2,
  MapPin,
  AlertOctagon,
} from 'lucide-react';

export default function TripReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const tripId = resolvedParams.id;

  const [trip, setTrip] = useState<any>(null);
  const [telemetry, setTelemetry] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [predictions, setPredictions] = useState<any[]>([]);
  const [defects, setDefects] = useState<any[]>([]);
  const [tripScore, setTripScore] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);

  const [viewMode, setViewMode] = useState<'split' | 'map' | 'cockpit'>('split');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [scrubProgress, setScrubProgress] = useState<number>(0);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);

  const supabase = useMemo(() => createClient(), []);

  // 1. Core Data Loader
  const loadTripData = useCallback(async () => {
    try {
      setLoading(true);

      // 1. Fetch trip metadata joined with driver and vehicle
      const { data: tripData, error: tripErr } = await supabase
        .from('trips')
        .select(`
          *,
          drivers:driver_id(id, name, licence_ref),
          vehicles:vehicle_id(id, plate, make, model, year)
        `)
        .eq('id', tripId)
        .maybeSingle();

      if (tripErr || !tripData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setTrip(tripData);

      // 2. Fetch driving events for this trip
      let loadedEvents: any[] = [];
      const { data: eventsByTrip } = await supabase
        .from('driving_events')
        .select('*')
        .eq('trip_id', tripId)
        .order('occurred_at', { ascending: true });

      if (eventsByTrip && eventsByTrip.length > 0) {
        loadedEvents = eventsByTrip;
      } else if (tripData.device_id && tripData.started_at) {
        // Fallback for events without trip_id link
        const { data: fallbackEvents } = await supabase
          .from('driving_events')
          .select('*')
          .eq('device_id', tripData.device_id)
          .gte('occurred_at', tripData.started_at)
          .lte('occurred_at', tripData.ended_at || new Date().toISOString())
          .order('occurred_at', { ascending: true });

        if (fallbackEvents) loadedEvents = fallbackEvents;
      }
      setEvents(loadedEvents);

      // 3. Fetch telemetry samples for the trip
      let telQuery = supabase
        .from('telemetry')
        .select('*')
        .eq('device_id', tripData.device_id);

      if (tripData.telemetry_from != null) {
        telQuery = telQuery.gte('id', tripData.telemetry_from);
        if (tripData.telemetry_to != null) {
          telQuery = telQuery.lte('id', tripData.telemetry_to);
        }
      } else if (tripData.started_at) {
        telQuery = telQuery
          .gte('server_received_at', tripData.started_at)
          .lte('server_received_at', tripData.ended_at || new Date().toISOString());
      }

      const { data: telData } = await telQuery
        .order('server_received_at', { ascending: true })
        .limit(5000);

      if (telData) setTelemetry(telData);

      // 4. Fetch predictions for this trip
      let predQuery = supabase
        .from('predictions')
        .select('*')
        .eq('trip_id', tripId)
        .order('issued_at', { ascending: true });

      const { data: predData } = await predQuery;
      if (predData && predData.length > 0) {
        setPredictions(predData);
      } else if (tripData.device_id && tripData.started_at) {
        const { data: fallbackPreds } = await supabase
          .from('predictions')
          .select('*')
          .eq('device_id', tripData.device_id)
          .gte('issued_at', tripData.started_at)
          .lte('issued_at', tripData.ended_at || new Date().toISOString())
          .order('issued_at', { ascending: true })
          .limit(100);
        if (fallbackPreds) setPredictions(fallbackPreds);
      }

      // 5. Fetch active road defects for spatial proximity radar
      const { data: defectData } = await supabase
        .from('road_defects')
        .select('*')
        .eq('status', 'active')
        .limit(100);

      if (defectData) setDefects(defectData);

      // 6. Fetch canonical score or calculate dynamic score
      const { data: scoreData } = await supabase
        .from('scores')
        .select('*')
        .eq('subject_type', 'trip')
        .eq('subject_id', tripId)
        .order('period_end', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (scoreData) {
        setTripScore(Number(scoreData.score));
      } else {
        // Compute canonical trip score from trip events & distance
        const distanceKm = Math.max((tripData.distance_m || 0) / 1000, 1.0);
        const scorableEvents = loadedEvents.filter(
          (e) => e.attributed_to_driver !== false && e.category === 'driver'
        );

        const weights: Record<string, number> = {
          'driver.harsh_brake': 8.0,
          'driver.harsh_accel': 5.0,
          'driver.sharp_corner': 3.0,
          'driver.excessive_cornering_speed': 7.0,
          'driver.swerving': 10.0,
          'driver.avoidable_impact': 9.0,
          'driver.speeding_relative': 6.0,
          'driver.speeding_for_conditions': 7.0,
          'driver.excessive_idling': 4.0,
          'driver.continuous_driving': 8.0,
        };

        const sevMults: Record<string, number> = {
          info: 0.0,
          low: 0.8,
          medium: 1.5,
          high: 2.5,
          critical: 4.0,
        };

        let rawPenalty = 0;
        for (const e of scorableEvents) {
          const w = weights[e.type] ?? 5.0;
          const sm = sevMults[e.severity] ?? 1.0;
          const conf = Number(e.confidence ?? 1.0);
          rawPenalty += w * sm * conf;
        }

        const k = 15.0;
        const dynScore = Math.max(0, Math.min(100, 100 - (100 * rawPenalty) / (distanceKm * k)));
        setTripScore(parseFloat(dynScore.toFixed(1)));
      }

      setLoading(false);
    } catch (err) {
      console.error('Failed to load trip replay data:', err);
      setLoading(false);
    }
  }, [tripId, supabase]);

  useEffect(() => {
    loadTripData();
  }, [loadTripData]);

  // Real-time subscription for in-progress active trips
  useEffect(() => {
    if (!trip || trip.status === 'closed' || trip.status === 'abandoned' || trip.ended_at) {
      return;
    }

    const deviceId = trip.device_id;
    if (!deviceId) return;

    const channel = supabase
      .channel(`active-trip-${tripId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'telemetry',
          filter: `device_id=eq.${deviceId}`,
        },
        (payload) => {
          if (payload.new) {
            setTelemetry((prev) => [...prev, payload.new]);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'driving_events',
          filter: `device_id=eq.${deviceId}`,
        },
        (payload) => {
          if (payload.new) {
            setEvents((prev) => [...prev, payload.new]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [trip, tripId, supabase]);

  // Derived route GPS positions
  const routePositions: [number, number][] = useMemo(() => {
    const pts = telemetry
      .filter((t) => t.gps?.lat && t.gps?.lon && !isNaN(Number(t.gps.lat)) && !isNaN(Number(t.gps.lon)))
      .map((t) => [Number(t.gps.lat), Number(t.gps.lon)] as [number, number]);

    if (pts.length > 0) return pts;

    if (trip?.start_lat && trip?.start_lon) {
      return [[Number(trip.start_lat), Number(trip.start_lon)]];
    }
    if (trip?.end_lat && trip?.end_lon) {
      return [[Number(trip.end_lat), Number(trip.end_lon)]];
    }
    return [];
  }, [telemetry, trip]);

  // Playback timer ticker
  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        setScrubProgress((prev) => {
          if (prev >= 100) {
            setIsPlaying(false);
            return 100;
          }
          const step = (100 / Math.max(1, telemetry.length)) * playbackSpeed;
          return Math.min(100, prev + Math.max(0.4, step));
        });
      }, 250);
    }
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed, telemetry.length]);

  const routeIndex = Math.min(
    Math.floor((scrubProgress / 100) * (routePositions.length || 1)),
    Math.max(0, routePositions.length - 1)
  );
  const currentPos: [number, number] | null = routePositions.length > 0 ? routePositions[routeIndex] : null;

  const currentTelIndex = Math.min(
    Math.floor((scrubProgress / 100) * (telemetry.length || 1)),
    Math.max(0, telemetry.length - 1)
  );
  const currentTel = telemetry[currentTelIndex];

  const currentSpeedKmh = Number(currentTel?.gps?.speed_kmh ?? 0);
  const currentHeading = Number(currentTel?.gps?.heading ?? 0);
  const currentVertG = Number(
    currentTel?.accel_cal?.vertical_rms ?? currentTel?.accel_cal?.vertical_peak ?? 1.0
  );
  const currentHorizG = Number(
    currentTel?.accel_cal?.horizontal_peak ?? currentTel?.accel_cal?.magnitude_peak ?? 0.0
  );

  // Derive lookahead hazard alerts and radar blips relative to vehicle position
  const { activeAlert, radarBlips, advisorySpeedKmh } = useMemo(() => {
    if (!currentPos || routePositions.length === 0) {
      return { activeAlert: null, radarBlips: [], advisorySpeedKmh: null };
    }

    const blips: RadarBlip[] = [];
    let alert: CockpitAlert | null = null;
    let advisorySpeed: number | null = null;

    // 1. Proximity to road defects
    for (const d of defects) {
      if (!d.lat || !d.lon) continue;
      const dLat = (d.lat - currentPos[0]) * 111320;
      const dLon = (d.lon - currentPos[1]) * 111320 * Math.cos((currentPos[0] * Math.PI) / 180);
      const distM = Math.sqrt(dLat * dLat + dLon * dLon);

      if (distM <= 220) {
        const bearingDeg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
        let relAngle = bearingDeg - currentHeading;
        while (relAngle > 180) relAngle -= 360;
        while (relAngle < -180) relAngle += 360;

        blips.push({
          id: `defect-${d.id}`,
          distanceM: Math.round(distM),
          angleDeg: Math.max(-30, Math.min(30, relAngle)),
          severity: d.severity || 'high',
          type: 'road.pothole_impact',
          title: 'Confirmed Pothole',
        });

        // Trigger lookahead warning if directly in vehicle path
        if (distM <= 180 && Math.abs(relAngle) <= 30 && (!alert || distM < alert.distanceM)) {
          const speedMps = Math.max(currentSpeedKmh / 3.6, 2.0);
          const eta = distM / speedMps;
          const safeSpeed = d.severity === 'critical' ? 25 : 35;

          alert = {
            id: `alert-${d.id}`,
            title: d.severity === 'critical' ? 'Severe Pothole Ahead' : 'Rough Road Defect',
            type: 'road.hazard_ahead',
            severity: d.severity || 'high',
            distanceM: Math.round(distM),
            etaS: Math.min(15, Math.max(0.5, parseFloat(eta.toFixed(1)))),
            advisorySpeedKmh: safeSpeed,
          };
          advisorySpeed = safeSpeed;
        }
      }
    }

    // 2. Real proximity to driving event locations
    if (!alert && events.length > 0) {
      const nearEvent = events.find((e) => {
        if (!e.lat || !e.lon) return false;
        const dLat = (e.lat - currentPos[0]) * 111320;
        const dLon = (e.lon - currentPos[1]) * 111320 * Math.cos((currentPos[0] * Math.PI) / 180);
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);
        return dist < 80;
      });

      if (nearEvent) {
        const dLat = (nearEvent.lat - currentPos[0]) * 111320;
        const dLon = (nearEvent.lon - currentPos[1]) * 111320 * Math.cos((currentPos[0] * Math.PI) / 180);
        const distM = Math.sqrt(dLat * dLat + dLon * dLon);
        const speedMps = Math.max(currentSpeedKmh / 3.6, 2.0);
        const eta = distM / speedMps;
        const safeSpeed = nearEvent.severity === 'critical' ? 25 : nearEvent.severity === 'high' ? 35 : 45;

        alert = {
          id: `alert-event-${nearEvent.id}`,
          title: String(nearEvent.type || 'Incident').replace(/_/g, ' ').toUpperCase(),
          type: nearEvent.type,
          severity: nearEvent.severity || 'medium',
          distanceM: Math.max(5, Math.round(distM)),
          etaS: Math.min(15, Math.max(0.5, parseFloat(eta.toFixed(1)))),
          advisorySpeedKmh: safeSpeed,
        };
        advisorySpeed = safeSpeed;
      }
    }

    return { activeAlert: alert, radarBlips: blips, advisorySpeedKmh: advisorySpeed };
  }, [currentPos, currentHeading, currentSpeedKmh, defects, events, routePositions.length]);

  // Map Markers
  const mapMarkers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = [];

    // Current vehicle replay position
    if (currentPos) {
      list.push({
        id: 'active-replay-vehicle',
        type: 'vehicle',
        lat: currentPos[0],
        lon: currentPos[1],
        heading: currentHeading,
        speedKmh: currentSpeedKmh,
        title: 'Replay Vehicle',
        deviceId: trip?.device_id || undefined,
        occurredAt: currentTel?.server_received_at || currentTel?.ts || undefined,
        details: `Replay Progress: ${scrubProgress.toFixed(0)}% • ${currentSpeedKmh.toFixed(1)} km/h`,
      });
    }

    // Origin Start Marker
    if (routePositions.length > 0) {
      list.push({
        id: 'trip-start-point',
        type: 'start',
        lat: routePositions[0][0],
        lon: routePositions[0][1],
        title: 'Trip Origin',
        details: `Departed: ${trip?.started_at ? new Date(trip.started_at).toLocaleTimeString() : 'N/A'}`,
      });
    }

    // Destination End Marker (if trip finished and has > 1 point)
    if (routePositions.length > 1 && trip?.ended_at) {
      const lastPt = routePositions[routePositions.length - 1];
      list.push({
        id: 'trip-end-point',
        type: 'end',
        lat: lastPt[0],
        lon: lastPt[1],
        title: 'Trip Destination',
        details: `Arrived: ${new Date(trip.ended_at).toLocaleTimeString()}`,
      });
    }

    // Incident / Driving Event Markers
    events.forEach((e, idx) => {
      if (e.lat && e.lon) {
        list.push({
          id: `evt-${e.id || e.event_key || idx}`,
          type: 'event',
          severity: e.severity,
          lat: Number(e.lat),
          lon: Number(e.lon),
          title: String(e.type || 'EVENT').replace(/_/g, ' ').toUpperCase(),
          eventType: e.type,
          deviceId: e.device_id || trip?.device_id || undefined,
          speedKmh: e.speed_kmh != null ? Number(e.speed_kmh) : undefined,
          magnitude: e.magnitude != null ? Number(e.magnitude) : undefined,
          magnitudeUnit: e.magnitude_unit || undefined,
          confidence: e.confidence != null ? Number(e.confidence) : undefined,
          occurredAt: e.occurred_at || undefined,
          category: e.category || undefined,
          details: e.magnitude
            ? `Magnitude: ${Number(e.magnitude).toFixed(2)} ${e.magnitude_unit || ''}`
            : `Classification: ${e.category || 'telematics'}`,
        });
      }
    });

    return list;
  }, [currentPos, currentHeading, currentSpeedKmh, currentTel, trip, scrubProgress, routePositions, events]);

  const mapPolylines: MapPolyline[] = useMemo(() => {
    if (routePositions.length < 2) return [];
    return [
      {
        id: 'trip-route',
        positions: routePositions,
        color: '#10b981',
        weight: 3.5,
      },
    ];
  }, [routePositions]);

  // Waveform Sensor Timeseries
  const waveformData = useMemo(() => {
    return telemetry.map((t, i) => {
      const spd = t.gps?.speed_kmh != null ? Number(t.gps.speed_kmh) : 0;
      const vert =
        t.accel_cal?.vertical_rms != null
          ? Number(t.accel_cal.vertical_rms)
          : t.accel_cal?.vertical_peak != null
          ? Number(t.accel_cal.vertical_peak)
          : 1.0;
      const yaw =
        t.gyro_cal?.yaw_rate_peak != null
          ? Number(t.gyro_cal.yaw_rate_peak)
          : t.gyro_cal?.yaw_rate_deg_s != null
          ? Number(t.gyro_cal.yaw_rate_deg_s)
          : 0;

      return {
        sec: i,
        time: t.ts
          ? new Date(t.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : t.server_received_at
          ? new Date(t.server_received_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : `${i}s`,
        speed: parseFloat(spd.toFixed(1)),
        accelG: parseFloat(vert.toFixed(3)),
        gyroYaw: parseFloat(yaw.toFixed(2)),
      };
    });
  }, [telemetry]);

  // Jump scrubber to exact time of an event
  const jumpToEvent = (evt: any) => {
    setSelectedEvent(evt);
    if (!evt.occurred_at || telemetry.length === 0) return;
    const evtTs = new Date(evt.occurred_at).getTime();

    // Find nearest telemetry index
    let closestIdx = 0;
    let minDiff = Infinity;
    telemetry.forEach((t, i) => {
      const tTs = t.server_received_at
        ? new Date(t.server_received_at).getTime()
        : t.ts
        ? new Date(t.ts).getTime()
        : 0;
      const diff = Math.abs(tTs - evtTs);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    });

    const progress = (closestIdx / Math.max(1, telemetry.length - 1)) * 100;
    setScrubProgress(Math.min(100, Math.max(0, progress)));
    setIsPlaying(false);
  };

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-black text-white font-sans text-xs">
        <Header title="Trip Replay & Incident Auditor" subtitle="Loading telemetry trajectory and sensor logs..." />
        <div className="flex-1 flex flex-col items-center justify-center space-y-3">
          <Loader2 size={32} className="animate-spin text-emerald-400" />
          <p className="text-zinc-400 font-mono text-xs">Loading trip replay data from Supabase...</p>
        </div>
      </div>
    );
  }

  if (notFound || !trip) {
    return (
      <div className="flex flex-col h-screen bg-black text-white font-sans text-xs">
        <Header title="Trip Replay" subtitle="Trip Inspector" />
        <div className="flex-1 flex flex-col items-center justify-center space-y-4 p-6 text-center">
          <div className="p-4 rounded-full bg-zinc-900 border border-zinc-800 text-amber-400">
            <AlertOctagon size={32} />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white">Trip Record Not Found</h2>
            <p className="text-zinc-400 max-w-md">
              No trip record matches the ID <code className="text-zinc-200 font-mono bg-zinc-900 px-1.5 py-0.5 rounded">{tripId}</code>.
            </p>
          </div>
          <Link
            href="/trips"
            className="px-4 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700 text-white font-medium inline-flex items-center gap-2 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Return to Trips Directory</span>
          </Link>
        </div>
      </div>
    );
  }

  const driverName = trip.drivers?.name || null;
  const vehicleLabel = trip.vehicles?.plate
    ? `${trip.vehicles.plate} (${trip.vehicles.make || ''} ${trip.vehicles.model || ''})`
    : trip.device_id;

  const initialCenter: [number, number] =
    currentPos ||
    (routePositions.length > 0 ? routePositions[0] : [0, 0]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-black text-white font-sans text-xs">
      <Header
        title="Trip Replay & Incident Auditor"
        subtitle="Synchronized cockpit HUD, route replay, and telemetry waveforms"
      />

      {/* Action & Metric Banner */}
      <div className="bg-zinc-950 border-b border-zinc-800 px-4 py-2 flex flex-wrap items-center justify-between gap-3 font-mono text-[11px]">
        <div className="flex items-center gap-3">
          <Link
            href="/trips"
            className="text-zinc-400 hover:text-white transition-colors flex items-center gap-1.5 py-1 px-2 rounded hover:bg-zinc-900 border border-transparent hover:border-zinc-800"
          >
            <ArrowLeft size={13} />
            <span>Trips</span>
          </Link>

          {/* View Mode Switcher */}
          <div className="flex items-center gap-1 bg-black p-1 rounded-md border border-zinc-800">
            <button
              onClick={() => setViewMode('split')}
              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors flex items-center gap-1.5 ${
                viewMode === 'split' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Layers size={11} />
              <span>Split View</span>
            </button>
            <button
              onClick={() => setViewMode('cockpit')}
              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors flex items-center gap-1.5 ${
                viewMode === 'cockpit'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Gauge size={11} />
              <span>Cockpit HUD</span>
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors flex items-center gap-1.5 ${
                viewMode === 'map' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Radio size={11} />
              <span>Map Only</span>
            </button>
          </div>
        </div>

        {/* Metadata Badges */}
        <div className="flex flex-wrap items-center gap-4 text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Car size={12} className="text-zinc-500" />
            <span>Vehicle:</span>
            <strong className="text-white font-mono">{vehicleLabel}</strong>
          </span>

          {driverName && (
            <span className="flex items-center gap-1.5">
              <User size={12} className="text-zinc-500" />
              <span>Driver:</span>
              <strong className="text-white">{driverName}</strong>
            </span>
          )}

          <span>
            Distance: <strong className="text-white">{((trip?.distance_m || 0) / 1000).toFixed(1)} km</strong>
          </span>

          {tripScore !== null && (
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={13} className={tripScore >= 80 ? 'text-emerald-400' : tripScore >= 60 ? 'text-amber-400' : 'text-rose-400'} />
              <span>Safety Score:</span>
              <strong
                className={
                  tripScore >= 80
                    ? 'text-emerald-400 font-bold'
                    : tripScore >= 60
                    ? 'text-amber-400 font-bold'
                    : 'text-rose-400 font-bold'
                }
              >
                {tripScore.toFixed(1)}/100
              </strong>
            </span>
          )}
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden p-3 gap-3 min-h-0">
        <div className="flex-1 flex flex-col gap-3 overflow-hidden min-h-0">
          
          {/* Top Panel: Cockpit HUD or Spatial Map */}
          {viewMode === 'cockpit' ? (
            <div className="flex-1 rounded-md border border-zinc-800 overflow-hidden bg-zinc-950 min-h-0 flex flex-col">
              <CockpitHUD
                speedKmh={currentSpeedKmh}
                advisorySpeedKmh={advisorySpeedKmh}
                heading={currentHeading}
                gForce={{ vertical: currentVertG, lateral: currentHorizG }}
                activeAlert={activeAlert}
                radarBlips={radarBlips}
                vehicleName={vehicleLabel}
                driverName={driverName || undefined}
                timestamp={
                  currentTel?.server_received_at
                    ? new Date(currentTel.server_received_at).toLocaleTimeString()
                    : undefined
                }
                className="flex-1"
              />
            </div>
          ) : viewMode === 'split' ? (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0 overflow-hidden">
              <div className="lg:col-span-7 rounded-md border border-zinc-800 overflow-hidden relative bg-zinc-950 min-h-0 flex flex-col">
                {routePositions.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-500 font-mono space-y-2">
                    <MapPin size={24} className="text-zinc-600" />
                    <p>No GPS coordinates logged for this trip.</p>
                    <p className="text-[10px] text-zinc-600">
                      Telemetry was recorded with inertial and gyro sensors without active GPS fix.
                    </p>
                  </div>
                ) : (
                  <OSMMap
                    center={initialCenter}
                    zoom={15}
                    markers={mapMarkers}
                    polylines={mapPolylines}
                    onMarkerClick={(m) => {
                      if (m.type === 'event') {
                        const evt = events.find(
                          (e) => `evt-${e.id || e.event_key}` === m.id || e.id === m.id
                        );
                        if (evt) jumpToEvent(evt);
                      }
                    }}
                  />
                )}
              </div>
              <div className="lg:col-span-5 rounded-md overflow-hidden bg-zinc-950 min-h-0 flex flex-col">
                <CockpitHUD
                  speedKmh={currentSpeedKmh}
                  advisorySpeedKmh={advisorySpeedKmh}
                  heading={currentHeading}
                  gForce={{ vertical: currentVertG, lateral: currentHorizG }}
                  activeAlert={activeAlert}
                  radarBlips={radarBlips}
                  vehicleName={vehicleLabel}
                  driverName={driverName || undefined}
                  timestamp={
                    currentTel?.server_received_at
                      ? new Date(currentTel.server_received_at).toLocaleTimeString()
                      : undefined
                  }
                  compact={true}
                  className="flex-1"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 rounded-md border border-zinc-800 overflow-hidden relative bg-zinc-950 min-h-0 flex flex-col">
              {routePositions.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-zinc-500 font-mono space-y-2">
                  <MapPin size={24} className="text-zinc-600" />
                  <p>No GPS coordinates logged for this trip.</p>
                </div>
              ) : (
                <OSMMap
                  center={initialCenter}
                  zoom={15}
                  markers={mapMarkers}
                  polylines={mapPolylines}
                  onMarkerClick={(m) => {
                    if (m.type === 'event') {
                      const evt = events.find(
                        (e) => `evt-${e.id || e.event_key}` === m.id || e.id === m.id
                      );
                      if (evt) jumpToEvent(evt);
                    }
                  }}
                />
              )}
            </div>
          )}

          {/* Bottom Panel: Synchronized Playback Scrub & Sensor Waveforms */}
          <div className="h-52 bg-zinc-950 border border-zinc-800 rounded-md p-3 flex flex-col space-y-2 font-mono text-[11px] shrink-0">
            <div className="flex items-center gap-3 bg-black p-2 rounded-md border border-zinc-800">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="px-3 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-white font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                <span>{isPlaying ? 'Pause' : 'Play Replay'}</span>
              </button>

              <div className="flex-1 flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.1"
                  value={scrubProgress}
                  onChange={(e) => {
                    setScrubProgress(Number(e.target.value));
                    setIsPlaying(false);
                  }}
                  className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-emerald-400"
                />
                <span className="text-zinc-400 text-[10px] w-12 text-right">
                  {scrubProgress.toFixed(0)}%
                </span>
              </div>

              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800">
                {[1, 2, 4].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setPlaybackSpeed(spd)}
                    className={`px-2 py-0.5 rounded-sm text-[10px] cursor-pointer ${
                      playbackSpeed === spd
                        ? 'bg-zinc-800 text-white font-bold'
                        : 'text-zinc-500 hover:text-white'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 bg-black p-2 rounded-md border border-zinc-800 min-h-0">
              {waveformData.length === 0 ? (
                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[10px]">
                  No 1 Hz sensor time-series packets in range.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={waveformData}>
                    <XAxis dataKey="sec" stroke="#52525b" tick={{ fontSize: 9 }} />
                    <YAxis stroke="#52525b" tick={{ fontSize: 9 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#09090b',
                        borderColor: '#27272a',
                        borderRadius: '4px',
                        fontSize: '10px',
                      }}
                      labelFormatter={(val: any) => {
                        const idx = typeof val === 'number' ? val : Number(val);
                        const time = waveformData[idx]?.time;
                        return `Sample #${idx}${time ? ` (${time})` : ''}`;
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="speed"
                      name="Speed (km/h)"
                      stroke="#38bdf8"
                      dot={false}
                      isAnimationActive={false}
                      strokeWidth={1.5}
                    />
                    <Line
                      type="monotone"
                      dataKey="accelG"
                      name="Vert RMS (g)"
                      stroke="#10b981"
                      dot={false}
                      isAnimationActive={false}
                      strokeWidth={1.5}
                    />
                    <Line
                      type="monotone"
                      dataKey="gyroYaw"
                      name="Gyro Yaw (°/s)"
                      stroke="#f59e0b"
                      dot={false}
                      isAnimationActive={false}
                      strokeWidth={1.5}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar: Incident Dispute & Evidence Inspector */}
        <div className="w-72 bg-zinc-950 border border-zinc-800 rounded-md p-3 flex flex-col space-y-3 font-mono text-[11px] shrink-0 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <span className="font-semibold text-zinc-300 uppercase text-[10px] tracking-wider flex items-center gap-1.5">
              <Activity size={12} className="text-emerald-400" />
              Incident Dispute Auditor
            </span>
            <span className="text-[10px] text-zinc-500 font-mono">
              {events.length} {events.length === 1 ? 'event' : 'events'}
            </span>
          </div>

          {selectedEvent ? (
            <div className="space-y-3">
              <div className="bg-black p-2.5 rounded-md border border-zinc-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold ${
                      selectedEvent.severity === 'critical'
                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                        : selectedEvent.severity === 'high'
                        ? 'bg-amber-950 text-amber-300 border border-amber-800'
                        : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                    }`}
                  >
                    {selectedEvent.severity || 'low'}
                  </span>
                  <button
                    onClick={() => setSelectedEvent(null)}
                    className="text-zinc-500 hover:text-white text-[10px] cursor-pointer"
                  >
                    Close
                  </button>
                </div>
                <p className="font-bold text-white text-xs pt-1">
                  {String(selectedEvent.type || 'Incident').replace(/_/g, ' ').toUpperCase()}
                </p>
                <p className="text-zinc-400 text-[10px]">
                  {selectedEvent.occurred_at
                    ? new Date(selectedEvent.occurred_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : 'Time unknown'}
                </p>
              </div>

              {/* Attribution Verdict */}
              <div className="bg-black p-2.5 rounded-md border border-zinc-800 space-y-1">
                <p className="text-zinc-500 text-[10px] uppercase font-semibold">Attribution Verdict</p>
                <div className="flex items-center gap-1.5">
                  {selectedEvent.attributed_to_driver !== false && selectedEvent.category === 'driver' ? (
                    <span className="text-rose-400 font-bold flex items-center gap-1">
                      <AlertTriangle size={11} /> Driver-Attributed
                    </span>
                  ) : (
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      <ShieldCheck size={11} /> Road / System Excluded (§8)
                    </span>
                  )}
                </div>
                <p className="text-zinc-400 text-[10px]">
                  Confidence:{' '}
                  <strong className="text-white">
                    {((selectedEvent.confidence ?? 1.0) * 100).toFixed(0)}%
                  </strong>
                </p>
              </div>

              {/* Physical Magnitude */}
              {selectedEvent.magnitude != null && (
                <div className="bg-black p-2.5 rounded-md border border-zinc-800 space-y-1">
                  <p className="text-zinc-500 text-[10px] uppercase font-semibold">Sensor Magnitude</p>
                  <p className="font-bold text-amber-400">
                    {Number(selectedEvent.magnitude).toFixed(2)} {selectedEvent.magnitude_unit || ''}
                  </p>
                  {selectedEvent.speed_kmh != null && (
                    <p className="text-zinc-400 text-[10px]">
                      Vehicle Speed: {Number(selectedEvent.speed_kmh).toFixed(1)} km/h
                    </p>
                  )}
                </div>
              )}

              {/* 50Hz Sensor Evidence Frame */}
              {selectedEvent.evidence && (
                <div className="bg-black p-2.5 rounded-md border border-zinc-800 space-y-1">
                  <p className="text-zinc-500 text-[10px] uppercase font-semibold">50Hz Sensor Evidence</p>
                  <pre className="text-[9px] text-zinc-400 overflow-x-auto max-h-40 bg-zinc-950 p-1.5 rounded border border-zinc-900">
                    {JSON.stringify(selectedEvent.evidence, null, 2)}
                  </pre>
                </div>
              )}

              {/* Jump to replay second */}
              <button
                onClick={() => jumpToEvent(selectedEvent)}
                className="w-full py-1.5 px-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white font-semibold rounded text-center transition-colors cursor-pointer"
              >
                Sync Replay to Event
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {events.length === 0 ? (
                <div className="text-zinc-500 py-10 text-center space-y-2">
                  <ShieldCheck size={24} className="mx-auto text-emerald-500/80" />
                  <p className="font-medium text-zinc-300">Clean Telematics Record</p>
                  <p className="text-[10px] text-zinc-500">
                    Zero harsh driving events or road hazard impacts recorded on this trip.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-zinc-400 text-[10px]">
                    Select any incident below or click on the map to audit 50Hz sensor evidence:
                  </p>
                  {events.map((evt, idx) => {
                    const isDriver =
                      evt.attributed_to_driver !== false && evt.category === 'driver';
                    return (
                      <div
                        key={`evt-list-${evt.id || idx}`}
                        onClick={() => jumpToEvent(evt)}
                        className="p-2.5 rounded-md bg-black hover:bg-zinc-900 border border-zinc-800/80 cursor-pointer transition-colors space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white text-[11px]">
                            {String(evt.type || 'Event').replace(/_/g, ' ').toUpperCase()}
                          </span>
                          <span
                            className={`px-1 py-0.2 rounded text-[8px] uppercase font-bold ${
                              evt.severity === 'critical'
                                ? 'text-rose-400'
                                : evt.severity === 'high'
                                ? 'text-amber-400'
                                : 'text-zinc-400'
                            }`}
                          >
                            {evt.severity || 'low'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-zinc-400">
                          <span>
                            {evt.occurred_at ? new Date(evt.occurred_at).toLocaleTimeString() : 'N/A'}
                          </span>
                          <span
                            className={
                              isDriver ? 'text-rose-400 text-[9px]' : 'text-emerald-400 text-[9px]'
                            }
                          >
                            {isDriver ? 'Driver Penalty' : 'Road Excluded'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
