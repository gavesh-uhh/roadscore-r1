'use client';

import { use, useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';

export default function TripReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const tripId = resolvedParams.id;

  const [trip, setTrip] = useState<any>(null);
  const [telemetry, setTelemetry] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [predictions, setPredictions] = useState<any[]>([]);
  const [defects, setDefects] = useState<any[]>([]);
  
  const [viewMode, setViewMode] = useState<'split' | 'map' | 'cockpit'>('split');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [scrubProgress, setScrubProgress] = useState<number>(0);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [tripScore, setTripScore] = useState<number | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function loadTripData() {
      // 1. Load trip metadata
      const { data: tripData } = await supabase
        .from('trips')
        .select('*')
        .eq('id', tripId)
        .maybeSingle();
        
      if (tripData) {
        setTrip(tripData);
        
        // 2. Load driving events for this trip
        const { data: eventsData } = await supabase
          .from('driving_events')
          .select('*')
          .or(`trip_id.eq.${tripId},and(device_id.eq.${tripData.device_id},occurred_at.gte.${tripData.started_at},occurred_at.lte.${tripData.ended_at || new Date().toISOString()})`)
          .order('occurred_at', { ascending: true });
          
        if (eventsData) setEvents(eventsData);
        
        // 3. Load telemetry samples for trip duration
        const { data: telData } = await supabase
          .from('telemetry')
          .select('*')
          .eq('device_id', tripData.device_id)
          .gte('server_received_at', tripData.started_at)
          .lte('server_received_at', tripData.ended_at || new Date().toISOString())
          .order('server_received_at', { ascending: true })
          .limit(1000);
          
        if (telData) setTelemetry(telData);

        // 4. Load predictions for this trip
        const { data: predData } = await supabase
          .from('predictions')
          .select('*')
          .or(`trip_id.eq.${tripId},device_id.eq.${tripData.device_id}`)
          .order('issued_at', { ascending: true })
          .limit(100);

        if (predData) setPredictions(predData);

        // 5. Load active road defects for spatial proximity radar
        const { data: defectData } = await supabase
          .from('road_defects')
          .select('*')
          .limit(50);

        if (defectData) setDefects(defectData);

        // 6. Load canonical score for this trip
        const { data: scoreData } = await supabase
          .from('scores')
          .select('*')
          .eq('subject_type', 'trip')
          .or(`subject_id.eq.${tripId},subject_id.eq.${tripData.trip_id || tripId}`)
          .order('period_end', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (scoreData) {
          setTripScore(Number(scoreData.score));
        }
      }
    }
    loadTripData();
  }, [tripId, supabase]);

  const routePositions: [number, number][] = useMemo(() => {
    const pts = telemetry
      .filter(t => t.gps?.lat && t.gps?.lon)
      .map(t => [Number(t.gps.lat), Number(t.gps.lon)] as [number, number]);

    if (pts.length > 0) return pts;
    if (trip?.start_lat && trip?.start_lon) {
      return [[Number(trip.start_lat), Number(trip.start_lon)]];
    }
    return [[6.915, 79.852]];
  }, [telemetry, trip]);

  useEffect(() => {
    let interval: any;
    if (isPlaying) {
      interval = setInterval(() => {
        setScrubProgress((prev) => (prev >= 100 ? 0 : prev + 1 * playbackSpeed));
      }, 300);
    }
    return () => clearInterval(interval);
  }, [isPlaying, playbackSpeed]);

  const routeIndex = Math.min(
    Math.floor((scrubProgress / 100) * routePositions.length),
    Math.max(0, routePositions.length - 1)
  );
  const currentPos = routePositions[routeIndex] || [6.915, 79.852];
  
  const currentTel = telemetry[Math.min(
    Math.floor((scrubProgress / 100) * telemetry.length),
    Math.max(0, telemetry.length - 1)
  )];

  const currentSpeedKmh = Number(currentTel?.gps?.speed_kmh || 0);
  const currentHeading = Number(currentTel?.gps?.heading || 0);
  const currentVertG = Number(currentTel?.accel_cal?.vertical_rms || 1.0);
  const currentHorizG = Number(currentTel?.accel_cal?.horizontal_peak || 0.0);

  // Derive active lookahead hazard alert and radar blips for the current playback second
  const { activeAlert, radarBlips, advisorySpeedKmh } = useMemo(() => {
    if (!currentPos || routePositions.length === 0) {
      return { activeAlert: null, radarBlips: [], advisorySpeedKmh: null };
    }

    const blips: RadarBlip[] = [];
    let alert: CockpitAlert | null = null;
    let advisorySpeed: number | null = null;

    // 1. Calculate distance to all known road defects
    for (const d of defects) {
      if (!d.lat || !d.lon) continue;
      // Approx Euclidean distance in meters for local lat/lon
      const dLat = (d.lat - currentPos[0]) * 111320;
      const dLon = (d.lon - currentPos[1]) * 111320 * Math.cos((currentPos[0] * Math.PI) / 180);
      const distM = Math.sqrt(dLat * dLat + dLon * dLon);

      if (distM <= 220) {
        // Calculate relative bearing
        const bearingDeg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
        let relAngle = bearingDeg - currentHeading;
        while (relAngle > 180) relAngle -= 360;
        while (relAngle < -180) relAngle += 360;

        blips.push({
          id: `defect-${d.id}`,
          distanceM: distM,
          angleDeg: Math.max(-30, Math.min(30, relAngle)),
          severity: d.severity || 'high',
          type: 'road.pothole_impact',
          title: 'Confirmed Pothole',
        });

        // Trigger cockpit alert if directly in front cone (< 180m and within ±25 deg)
        if (distM <= 180 && Math.abs(relAngle) <= 30 && (!alert || distM < alert.distanceM)) {
          const eta = currentSpeedKmh > 5 ? distM / (currentSpeedKmh / 3.6) : 9.9;
          const safeSpeed = d.severity === 'critical' ? 30 : 40;

          alert = {
            id: `alert-${d.id}`,
            title: d.severity === 'critical' ? 'Severe Pothole Ahead' : 'Rough Road Defect',
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

    // 2. Check if current telemetry timestamp matches a known event
    if (!alert && events.length > 0) {
      const nearEvent = events.find((e) => {
        if (!e.lat || !e.lon) return false;
        const dLat = (e.lat - currentPos[0]) * 111320;
        const dLon = (e.lon - currentPos[1]) * 111320 * Math.cos((currentPos[0] * Math.PI) / 180);
        return Math.sqrt(dLat * dLat + dLon * dLon) < 60;
      });

      if (nearEvent) {
        alert = {
          id: `alert-event-${nearEvent.id}`,
          title: String(nearEvent.type || 'Incident').replace(/_/g, ' ').toUpperCase(),
          type: nearEvent.type,
          severity: nearEvent.severity || 'medium',
          distanceM: 35,
          etaS: 2.1,
          advisorySpeedKmh: 35,
        };
        advisorySpeed = 35;
      }
    }

    return { activeAlert: alert, radarBlips: blips, advisorySpeedKmh: advisorySpeed };
  }, [currentPos, currentHeading, currentSpeedKmh, defects, events]);

  const mapMarkers: MapMarker[] = [
    {
      id: 'active-replay-vehicle',
      type: 'vehicle',
      lat: currentPos[0],
      lon: currentPos[1],
      heading: currentHeading,
      speedKmh: currentSpeedKmh,
      title: 'Replay Vehicle',
      deviceId: trip?.device_id || undefined,
      occurredAt: currentTel?.server_received_at || currentTel?.ts || undefined,
      details: `Replay Progress: ${scrubProgress.toFixed(0)}%`,
    },
    ...events.filter(e => e.lat && e.lon).map((e, idx) => ({
      id: `evt-${e.id || e.event_key || idx}`,
      type: 'event' as const,
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
      details: e.magnitude ? `Magnitude: ${Number(e.magnitude).toFixed(2)} ${e.magnitude_unit || ''}` : 'Detected Incident',
    }))
  ];

  const mapPolylines: MapPolyline[] = [
    {
      id: 'trip-route',
      positions: routePositions,
      color: '#ffffff',
      weight: 3.5,
    },
  ];

  const waveformData = telemetry.map((t, i) => {
    const spd = t.gps?.speed_kmh != null ? Number(t.gps.speed_kmh) : 0;
    const vert = t.accel_cal?.vertical_rms != null ? Number(t.accel_cal.vertical_rms) : 1.0;
    const yaw = t.gyro_cal?.yaw_rate_deg_s != null ? Number(t.gyro_cal.yaw_rate_deg_s) : 0;

    return {
      sec: i,
      speed: parseFloat(spd.toFixed(1)),
      accelG: parseFloat(vert.toFixed(3)),
      gyroYaw: parseFloat(yaw.toFixed(2)),
    };
  });

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-black text-white font-sans text-xs">
      <Header title="Trip Replay & Incident Auditor" subtitle="Synchronized cockpit HUD, route replay, and telemetry waveforms" />

      {/* Action & Metric Banner */}
      <div className="bg-zinc-950 border-b border-zinc-800 px-4 py-2 flex items-center justify-between font-mono text-[11px]">
        <Link
          href="/trips"
          className="text-zinc-400 hover:text-white transition-colors flex items-center gap-1.5"
        >
          <ArrowLeft size={13} />
          <span>Back to Trips</span>
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
              viewMode === 'cockpit' ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700' : 'text-zinc-400 hover:text-white'
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

        <div className="flex items-center gap-4 text-zinc-400">
          <span>Device: <strong className="text-white">{trip?.device_id || 'Loading...'}</strong></span>
          <span>Distance: <strong className="text-white">{((trip?.distance_m || 0) / 1000).toFixed(1)} km</strong></span>
          {tripScore !== null && (
            <span>
              Safety Score:{' '}
              <strong className={tripScore >= 80 ? 'text-emerald-400 font-bold' : tripScore >= 60 ? 'text-amber-400 font-bold' : 'text-rose-400 font-bold'}>
                {tripScore.toFixed(1)}/100
              </strong>
            </span>
          )}
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden p-3 gap-3">
        <div className="flex-1 flex flex-col gap-3 overflow-hidden">
          
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
                vehicleName={trip?.device_id}
                timestamp={currentTel?.server_received_at ? new Date(currentTel.server_received_at).toLocaleTimeString() : undefined}
                className="flex-1"
              />
            </div>
          ) : viewMode === 'split' ? (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0 overflow-hidden">
              <div className="lg:col-span-7 rounded-md border border-zinc-800 overflow-hidden relative bg-zinc-950 min-h-0">
                <OSMMap
                  center={currentPos}
                  zoom={15}
                  markers={mapMarkers}
                  polylines={mapPolylines}
                  onMarkerClick={(m) => {
                    if (m.type === 'event') {
                      const evt = events.find(e => `evt-${e.id || e.event_key}` === m.id);
                      setSelectedEvent({
                        title: m.title,
                        details: m.details,
                        verdict: evt ? `${((evt.confidence || 1) * 100).toFixed(0)}% Confidence` : 'Verified',
                        evidence: evt?.evidence || null,
                      });
                    }
                  }}
                />
              </div>
              <div className="lg:col-span-5 rounded-md overflow-hidden bg-zinc-950 min-h-0 flex flex-col">
                <CockpitHUD
                  speedKmh={currentSpeedKmh}
                  advisorySpeedKmh={advisorySpeedKmh}
                  heading={currentHeading}
                  gForce={{ vertical: currentVertG, lateral: currentHorizG }}
                  activeAlert={activeAlert}
                  radarBlips={radarBlips}
                  vehicleName={trip?.device_id}
                  timestamp={currentTel?.server_received_at ? new Date(currentTel.server_received_at).toLocaleTimeString() : undefined}
                  compact={true}
                  className="flex-1"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 rounded-md border border-zinc-800 overflow-hidden relative bg-zinc-950 min-h-0">
              <OSMMap
                center={currentPos}
                zoom={15}
                markers={mapMarkers}
                polylines={mapPolylines}
                onMarkerClick={(m) => {
                  if (m.type === 'event') {
                    const evt = events.find(e => `evt-${e.id || e.event_key}` === m.id);
                    setSelectedEvent({
                      title: m.title,
                      details: m.details,
                      verdict: evt ? `${((evt.confidence || 1) * 100).toFixed(0)}% Confidence` : 'Verified',
                      evidence: evt?.evidence || null,
                    });
                  }
                }}
              />
            </div>
          )}

          {/* Bottom Panel: Synchronized Playback Scrub & Sensor Waveforms */}
          <div className="h-52 bg-zinc-950 border border-zinc-800 rounded-md p-3 flex flex-col space-y-2 font-mono text-[11px] shrink-0">
            <div className="flex items-center gap-3 bg-black p-2 rounded-md border border-zinc-800">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="px-3 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-white font-bold transition-colors flex items-center gap-1.5"
              >
                {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                <span>{isPlaying ? 'Pause' : 'Play Replay'}</span>
              </button>

              <div className="flex-1 flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={scrubProgress}
                  onChange={(e) => setScrubProgress(Number(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-emerald-400"
                />
                <span className="text-zinc-500 text-[10px] w-12 text-right">
                  {scrubProgress.toFixed(0)}%
                </span>
              </div>

              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800">
                {[1, 2, 4].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setPlaybackSpeed(spd)}
                    className={`px-2 py-0.5 rounded-sm text-[10px] ${
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
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={waveformData}>
                  <XAxis dataKey="sec" stroke="#52525b" tick={{ fontSize: 9 }} />
                  <YAxis stroke="#52525b" tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '4px', fontSize: '10px' }} />
                  <Line type="monotone" dataKey="speed" name="Speed (km/h)" stroke="#38bdf8" dot={false} isAnimationActive={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="accelG" name="Vert RMS (g)" stroke="#10b981" dot={false} isAnimationActive={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="gyroYaw" name="Gyro Yaw (°/s)" stroke="#f59e0b" dot={false} isAnimationActive={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Incident Dispute & Evidence Inspector */}
        <div className="w-68 bg-zinc-950 border border-zinc-800 rounded-md p-3 flex flex-col space-y-3 font-mono text-[11px] shrink-0">
          <span className="font-semibold text-zinc-300 uppercase text-[10px] tracking-wider flex items-center gap-1.5 border-b border-zinc-800 pb-2">
            <Activity size={12} className="text-emerald-400" />
            Incident Dispute Auditor
          </span>

          {selectedEvent ? (
            <div className="space-y-3">
              <div className="bg-black p-2.5 rounded-md border border-zinc-800 space-y-1">
                <p className="font-bold text-white">{selectedEvent.title}</p>
                <p className="text-zinc-400 text-[10px]">{selectedEvent.details}</p>
              </div>

              <div className="bg-black p-2.5 rounded-md border border-zinc-800 space-y-1">
                <p className="text-zinc-500 text-[10px] uppercase font-semibold">Classification Verdict</p>
                <p className="font-bold text-emerald-400">{selectedEvent.verdict}</p>
              </div>

              {selectedEvent.evidence && (
                <div className="bg-black p-2.5 rounded-md border border-zinc-800 space-y-1">
                  <p className="text-zinc-500 text-[10px] uppercase font-semibold">50Hz Sensor Evidence</p>
                  <pre className="text-[9px] text-zinc-400 overflow-x-auto max-h-48">
                    {JSON.stringify(selectedEvent.evidence, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="text-zinc-500 py-12 text-center space-y-2">
              <AlertTriangle size={20} className="mx-auto text-zinc-600" />
              <p>Click any event marker on the map to audit lookahead warnings and 50Hz sensor evidence.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
