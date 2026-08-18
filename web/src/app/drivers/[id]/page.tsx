'use client';

import { use, useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/common/Header';
import {
  computeCanonicalScore,
  calculateFactorRadarScores,
  calculateCanonicalDeductions,
  getCanonicalExcludedEvents,
  generateScoreTimeline,
  ScorableEvent as TelematicsEvent,
  DeductionItem,
  ExcludedEventItem,
} from '@/lib/scoring/canonicalEngine';
import { formatEventType } from '@/lib/events/format';
import { createClient } from '@/lib/supabase/client';
import { getFleetData, updateDriver, deleteDriver } from '@/lib/fleet/api';
import { VehicleRecord } from '@/lib/fleet/types';
import { DriverDrawer } from '@/components/fleet/DriverDrawer';
import { ScoreAuditDrawer } from '@/components/scoring/ScoreAuditDrawer';
import {
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  Cpu,
  Car,
  Clock,
  Navigation,
  CheckCircle2,
  TrendingUp,
  Edit2,
  FileText,
  Route,
  Activity,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export interface ActiveTripSummary {
  id: string;
  started_at: string;
  distance_m: number;
  duration_s: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  status: string;
  device_id: string;
}

const FACTOR_META: Record<string, { label: string; desc: string }> = {
  longitudinal: { label: 'Longitudinal Dynamics', desc: 'Braking & acceleration smoothness' },
  cornering: { label: 'Cornering & Lateral', desc: 'Turn stability, swerving, lateral Gs' },
  speedCompliance: { label: 'Speed Compliance', desc: 'Adherence to road speed limits' },
  roadRiskAdaptation: { label: 'Road Risk Adaptation', desc: 'Pothole & road shock mitigation' },
  fatigueEco: { label: 'Eco & Operational Habits', desc: 'Excessive idle & continuous driving' },
};

export default function DriverScorecard({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const driverId = resolvedParams.id;
  const router = useRouter();

  const [driver, setDriver] = useState<any>(null);
  const [device, setDevice] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [activeTrip, setActiveTrip] = useState<ActiveTripSummary | null>(null);
  const [events, setEvents] = useState<TelematicsEvent[]>([]);
  const [timelineData, setTimelineData] = useState<{ hour: string; score: number }[]>([]);
  const [deductions, setDeductions] = useState<DeductionItem[]>([]);
  const [excludedEvents, setExcludedEvents] = useState<ExcludedEventItem[]>([]);
  const [currentScore, setCurrentScore] = useState<number>(100.0);
  const [totalDistanceKm, setTotalDistanceKm] = useState<number>(0);
  const [totalTripsCount, setTotalTripsCount] = useState<number>(0);
  const [totalMovingHours, setTotalMovingHours] = useState<number>(0);
  const [roadRoughness, setRoadRoughness] = useState<number>(0.15);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  // Drawer modal states
  const [driverDrawerOpen, setDriverDrawerOpen] = useState(false);
  const [scoreAuditOpen, setScoreAuditOpen] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  const loadDriverData = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);

      // 1. Fetch fleet vehicles for driver drawer
      const fleet = await getFleetData(supabase);
      setVehicles(fleet.vehicles);

      // 2. Load driver record
      const { data: dData } = await supabase
        .from('drivers')
        .select('*')
        .eq('id', driverId)
        .single();

      if (dData) setDriver(dData);

      // 3. Load assigned device
      const { data: devData } = await supabase
        .from('devices')
        .select('*')
        .eq('driver_id', driverId)
        .maybeSingle();

      let assignedDeviceId: string | null = null;
      if (devData) {
        setDevice(devData);
        assignedDeviceId = devData.device_id;

        // 4. Load associated vehicle
        if (devData.vehicle_id) {
          const { data: vData } = await supabase
            .from('vehicles')
            .select('*')
            .eq('id', devData.vehicle_id)
            .maybeSingle();

          if (vData) setVehicle(vData);
        }
      } else {
        setDevice(null);
        setVehicle(null);
      }

      // 5. Load all trips for this driver / assigned device
      let tripsQuery = supabase
        .from('trips')
        .select('*')
        .order('started_at', { ascending: false });

      if (assignedDeviceId) {
        tripsQuery = tripsQuery.or(`driver_id.eq.${driverId},device_id.eq.${assignedDeviceId}`);
      } else {
        tripsQuery = tripsQuery.eq('driver_id', driverId);
      }

      const { data: tripsData } = await tripsQuery;
      const allDriverTrips = tripsData || [];

      // Calculate lifetime / rolling exposure metrics
      const distKm = allDriverTrips.reduce((acc: number, t: any) => acc + (Number(t.distance_m) || 0) / 1000, 0);
      const movingHrs = allDriverTrips.reduce((acc: number, t: any) => acc + (Number(t.moving_s || t.duration_s) || 0) / 3600, 0);
      setTotalDistanceKm(Number(distKm.toFixed(1)));
      setTotalTripsCount(allDriverTrips.length);
      setTotalMovingHours(Number(movingHrs.toFixed(1)));

      // Find current open active trip
      const foundActive = allDriverTrips.find((t: any) => {
        const st = String(t.status || '').toLowerCase();
        return (st === 'open' || !t.ended_at) && st !== 'closed' && st !== 'abandoned';
      });

      if (foundActive) {
        setActiveTrip({
          id: String(foundActive.id || foundActive.trip_id || ''),
          started_at: String(foundActive.started_at || ''),
          distance_m: Number(foundActive.distance_m || 0),
          duration_s: Number(foundActive.duration_s || 0),
          avg_speed_kmh: Number(foundActive.avg_speed_kmh || ((foundActive.avg_speed_mps || 0) * 3.6)),
          max_speed_kmh: Number(foundActive.max_speed_kmh || ((foundActive.max_speed_mps || 0) * 3.6)),
          status: String(foundActive.status || 'open'),
          device_id: String(foundActive.device_id || ''),
        });
      } else {
        setActiveTrip(null);
      }

      // 6. Load driver-attributed events and §8 fairness excluded events
      const filterClauses = [`driver_id.eq.${driverId}`];
      if (assignedDeviceId) {
        filterClauses.push(`device_id.eq.${assignedDeviceId}`);
      }

      const [driverEventsRes, excludedEventsRes] = await Promise.all([
        supabase
          .from('driving_events')
          .select('*')
          .or(filterClauses.join(','))
          .or('attributed_to_driver.eq.true,category.eq.driver,type.ilike.driver.%')
          .order('occurred_at', { ascending: false }),
        supabase
          .from('driving_events')
          .select('*')
          .or(filterClauses.join(','))
          .eq('attributed_to_driver', false)
          .order('occurred_at', { ascending: false })
          .limit(100),
      ]);

      const combined = [...(driverEventsRes.data || []), ...(excludedEventsRes.data || [])];
      const seenEventKeys = new Set<string>();
      const mappedEvents: TelematicsEvent[] = [];

      for (const e of combined) {
        const key = String(e.event_key || e.id || '');
        if (key && seenEventKeys.has(key)) continue;
        if (key) seenEventKeys.add(key);

        mappedEvents.push({
          id: e.id,
          event_key: e.event_key,
          type: e.type,
          severity: e.severity,
          occurred_at: e.occurred_at,
          magnitude: e.magnitude,
          magnitude_unit: e.magnitude_unit,
          attributed_to_driver: e.attributed_to_driver,
          driver_id: driverId,
          device_id: e.device_id,
        });
      }

      setEvents(mappedEvents);

      // Compute canonical score matching /drivers and /
      const canonicalScoreResult = computeCanonicalScore({
        distanceKm: distKm,
        events: mappedEvents,
        subjectType: 'driver',
        subjectId: driverId,
      });
      setCurrentScore(canonicalScoreResult.score);

      // Compute itemized deductions (supporting analytics)
      const itemizedDeductions = calculateCanonicalDeductions(mappedEvents);
      setDeductions(itemizedDeductions);

      // Compute §8 fairness excluded events
      const excluded = getCanonicalExcludedEvents(mappedEvents);
      setExcludedEvents(excluded);

      // Compute score timeline (supporting analytics)
      const timeline = generateScoreTimeline(mappedEvents, distKm);
      setTimelineData(timeline);

      // Average road roughness from device telemetry
      if (assignedDeviceId) {
        const { data: telData } = await supabase
          .from('telemetry')
          .select('accel_cal')
          .eq('device_id', assignedDeviceId)
          .order('server_received_at', { ascending: false })
          .limit(100);

        if (telData && telData.length > 0) {
          const sumRms = telData.reduce((acc: number, row: any) => acc + (Number(row.accel_cal?.vertical_rms) || 0), 0);
          setRoadRoughness(Number((sumRms / telData.length).toFixed(2)));
        }
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error loading driver profile:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [driverId, supabase]);

  useEffect(() => {
    setIsMounted(true);
    loadDriverData(true);

    const channel = supabase
      .channel(`realtime_driver_${driverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => loadDriverData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => loadDriverData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => loadDriverData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driving_events' }, () => loadDriverData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => loadDriverData(false))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry' }, () => loadDriverData(false))
      .subscribe();

    const interval = setInterval(() => {
      loadDriverData(false);
    }, 2500);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [driverId, loadDriverData, supabase]);

  const handleSaveDriver = async (formData: {
    name: string;
    licence_ref: string;
    assign_vehicle_id: string;
  }) => {
    await updateDriver(supabase, driverId, formData);
    await loadDriverData(false);
  };

  const handleDeleteDriver = async (id: string) => {
    await deleteDriver(supabase, id);
    router.push('/drivers');
  };

  const radarScores = useMemo(() => calculateFactorRadarScores(events), [events]);

  const factorList = useMemo(() => {
    return [
      { key: 'longitudinal', score: radarScores.longitudinal },
      { key: 'cornering', score: radarScores.cornering },
      { key: 'speedCompliance', score: radarScores.speedCompliance },
      { key: 'roadRiskAdaptation', score: radarScores.roadRiskAdaptation },
      { key: 'fatigueEco', score: radarScores.fatigueEco },
    ].map((f) => ({
      ...f,
      meta: FACTOR_META[f.key] || { label: f.key, desc: '' },
    }));
  }, [radarScores]);

  const scoreColor =
    currentScore >= 90 ? 'text-emerald-400' : currentScore >= 75 ? 'text-amber-400' : 'text-rose-400';
  const scoreBorderColor =
    currentScore >= 90 ? 'border-emerald-800/60' : currentScore >= 75 ? 'border-amber-800/60' : 'border-rose-800/60';
  const scoreBgColor =
    currentScore >= 90 ? 'bg-emerald-950/20' : currentScore >= 75 ? 'bg-amber-950/20' : 'bg-rose-950/20';

  const eventsPer100km = totalDistanceKm > 0
    ? Number((deductions.length / (totalDistanceKm / 100)).toFixed(1))
    : 0;

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header title="Driver Scorecard" subtitle="Continuous safety rating & telematics audit" />

      <div className="p-5 space-y-4 max-w-7xl w-full mx-auto">
        {/* Navigation & Live Status Bar */}
        <div className="flex items-center justify-between">
          <Link
            href="/drivers"
            className="text-xs text-zinc-400 hover:text-white transition-colors flex items-center gap-1.5 font-mono"
          >
            <ArrowLeft size={14} />
            <span>Back to Drivers</span>
          </Link>

          <div className="flex items-center gap-2.5">
            {activeTrip && (
              <Link
                href={`/trips/${activeTrip.id}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/80 border border-emerald-700/60 text-emerald-400 text-[11px] font-mono hover:bg-emerald-900/60 transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-live-ping" />
                <span className="font-bold">IN TRIP</span>
                <span className="text-emerald-400/80">({(activeTrip.distance_m / 1000).toFixed(1)} km)</span>
              </Link>
            )}

            <button
              onClick={() => setScoreAuditOpen(true)}
              className="inline-flex items-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-2.5 py-1 rounded-md text-[11px] font-mono text-zinc-300 hover:text-white transition-colors cursor-pointer"
            >
              <FileText size={12} className="text-emerald-400" />
              <span>Audit Breakdown</span>
            </button>

            <button
              onClick={() => setDriverDrawerOpen(true)}
              className="inline-flex items-center gap-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-2.5 py-1 rounded-md text-[11px] font-mono text-zinc-300 hover:text-white transition-colors cursor-pointer"
            >
              <Edit2 size={12} className="text-sky-400" />
              <span>Edit Driver</span>
            </button>

            <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 px-2.5 py-1 rounded-md text-[11px] font-mono text-zinc-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE</span>
              <span suppressHydrationWarning className="text-zinc-500">
                ({isMounted && lastUpdated ? lastUpdated.toLocaleTimeString() : 'Syncing'})
              </span>
            </div>
          </div>
        </div>

        {/* Driver Profile Card */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md p-5 flex flex-col gap-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-bold text-white font-sans">
                  {driver?.name || (loading ? 'Loading driver...' : 'Unnamed Driver')}
                </h1>
                <span
                  className={`px-2 py-0.5 rounded-sm text-[10px] font-mono font-semibold uppercase ${
                    activeTrip
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                      : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                  }`}
                >
                  {activeTrip ? 'On Trip' : 'Standby'}
                </span>
              </div>

              {/* Driver Meta Info */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-zinc-400 font-mono">
                {driver?.licence_ref && (
                  <div>
                    <span className="text-zinc-500">Lic: </span>
                    <span className="text-zinc-200">{driver.licence_ref}</span>
                  </div>
                )}

                <div className="flex items-center gap-1.5">
                  <Car size={13} className="text-sky-400" />
                  {vehicle?.plate ? (
                    <span className="text-zinc-200">
                      {vehicle.plate} <span className="text-zinc-500">({vehicle.make} {vehicle.model})</span>
                    </span>
                  ) : (
                    <span className="text-zinc-500">No Vehicle Assigned</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <Cpu size={13} className="text-emerald-400" />
                  {device?.device_id ? (
                    <Link
                      href={`/hardware/${device.device_id}`}
                      className="text-emerald-400 hover:underline font-bold"
                    >
                      {device.device_id}
                    </Link>
                  ) : (
                    <span className="text-zinc-500">No Device Assigned</span>
                  )}
                </div>
              </div>
            </div>

            {/* Real-time Safety Score Summary */}
            <div
              onClick={() => setScoreAuditOpen(true)}
              title="Click to inspect itemized continuous scoring audit"
              className={`flex items-center gap-4 px-4 py-3 rounded-md border ${scoreBorderColor} ${scoreBgColor} font-mono self-start md:self-auto cursor-pointer hover:border-zinc-700 transition-colors`}
            >
              <div>
                <div className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider">
                  Canonical Safety Score
                </div>
                <div className={`text-2xl font-bold tracking-tight ${scoreColor}`}>
                  {currentScore.toFixed(1)}
                  <span className="text-xs text-zinc-500 font-normal ml-1">/ 100</span>
                </div>
              </div>
              <div className="border-l border-zinc-800 pl-3.5 text-right text-[11px] space-y-0.5">
                <div className="text-zinc-400 font-medium">
                  {deductions.length === 0 ? 'Pristine Record' : `${deductions.length} Infractions`}
                </div>
                <div className={deductions.length > 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400'}>
                  {deductions.length > 0
                    ? `-${deductions.reduce((sum, d) => sum + d.penalty, 0).toFixed(1)} pts penalty`
                    : '100% Zero Penalty'}
                </div>
              </div>
            </div>
          </div>

          {/* Exposure & Lifetime Stats Ribbon */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 border-t border-zinc-800/80 pt-3">
            <div className="bg-zinc-900/40 p-2.5 rounded-md border border-zinc-800/60">
              <span className="text-[10px] text-zinc-500 uppercase font-mono block">Total Distance</span>
              <span className="text-sm font-bold font-mono text-white">{totalDistanceKm} km</span>
            </div>
            <div className="bg-zinc-900/40 p-2.5 rounded-md border border-zinc-800/60">
              <span className="text-[10px] text-zinc-500 uppercase font-mono block">Trips Logged</span>
              <span className="text-sm font-bold font-mono text-white">{totalTripsCount}</span>
            </div>
            <div className="bg-zinc-900/40 p-2.5 rounded-md border border-zinc-800/60">
              <span className="text-[10px] text-zinc-500 uppercase font-mono block">Driving Hours</span>
              <span className="text-sm font-bold font-mono text-white">{totalMovingHours} hrs</span>
            </div>
            <div className="bg-zinc-900/40 p-2.5 rounded-md border border-zinc-800/60">
              <span className="text-[10px] text-zinc-500 uppercase font-mono block">Infractions / 100km</span>
              <span className="text-sm font-bold font-mono text-white">{eventsPer100km}</span>
            </div>
            <div className="bg-zinc-900/40 p-2.5 rounded-md border border-zinc-800/60 col-span-2 sm:col-span-1">
              <span className="text-[10px] text-zinc-500 uppercase font-mono block">Road Roughness</span>
              <span className="text-sm font-bold font-mono text-sky-400">{roadRoughness} m/s²</span>
            </div>
          </div>

          {/* Active Trip Telematics Bar */}
          {activeTrip && (
            <div className="bg-emerald-950/30 border border-emerald-800/50 rounded-md p-3 flex flex-wrap items-center justify-between gap-3 font-mono text-xs">
              <div className="flex items-center gap-3">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-live-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-zinc-300">
                  <span className="font-semibold text-emerald-400">Active Trip #{activeTrip.id.slice(0, 8)}</span>
                  <span suppressHydrationWarning>
                    Started: <strong className="text-white">{isMounted && activeTrip.started_at ? new Date(activeTrip.started_at).toLocaleTimeString() : (activeTrip.started_at ? activeTrip.started_at.slice(11, 19) : 'Recent')}</strong>
                  </span>
                  <span>
                    Distance: <strong className="text-white">{(activeTrip.distance_m / 1000).toFixed(1)} km</strong>
                  </span>
                  <span>
                    Speed: <strong className="text-emerald-400">{activeTrip.avg_speed_kmh.toFixed(1)} km/h</strong>
                  </span>
                </div>
              </div>

              <Link
                href={`/trips/${activeTrip.id}`}
                className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1 text-xs transition-colors"
              >
                <Navigation size={11} />
                <span>Replay Route</span>
                <ArrowRight size={11} />
              </Link>
            </div>
          )}
        </div>

        {/* Main 2-Column Dashboard: Safety Factors & Incident Deductions */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column (5 Cols): 5 Safety Pillars & Score Trend */}
          <div className="lg:col-span-5 space-y-4">
            {/* 5 Safety Factors (Supporting Analytics) */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-400" />
                  <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
                    5-Factor Pillars <span className="text-[10px] text-zinc-500 font-normal lowercase">(supporting analytics)</span>
                  </h2>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">0-100 Rating</span>
              </div>

              <div className="space-y-3">
                {factorList.map((factor) => {
                  const score = factor.score;
                  const barColor =
                    score >= 90 ? 'bg-emerald-500' : score >= 75 ? 'bg-amber-500' : 'bg-rose-500';
                  const textColor =
                    score >= 90 ? 'text-emerald-400' : score >= 75 ? 'text-amber-400' : 'text-rose-400';

                  return (
                    <div key={factor.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div>
                          <span className="font-medium text-zinc-200">{factor.meta.label}</span>
                          <p className="text-[10px] text-zinc-500">{factor.meta.desc}</p>
                        </div>
                        <span className={`font-mono font-bold text-xs ${textColor}`}>
                          {score.toFixed(0)} <span className="text-zinc-600 text-[10px]">/ 100</span>
                        </span>
                      </div>
                      <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden border border-zinc-800/50">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                          style={{ width: `${Math.max(4, score)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Score History / Trend Sparkline (Supporting Analytics) */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-2">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-zinc-400" />
                  <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Score Trend <span className="text-[10px] text-zinc-500 font-normal lowercase">(supporting analytics)</span>
                  </span>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">12h Timeline</span>
              </div>

              <div className="h-28 w-full pt-2">
                {timelineData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                      <defs>
                        <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="hour" stroke="#52525b" tick={{ fontSize: 9 }} />
                      <YAxis domain={[60, 100]} stroke="#52525b" tick={{ fontSize: 9 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#09090b',
                          borderColor: '#27272a',
                          borderRadius: '4px',
                          fontSize: '11px',
                        }}
                      />
                      <Area type="monotone" dataKey="score" stroke="#22c55e" strokeWidth={1.5} fill="url(#scoreGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-500 font-mono text-[11px]">
                    No historical score fluctuations recorded yet.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column (7 Cols): Deductions & Fairly Excluded Events */}
          <div className="lg:col-span-7 space-y-4">
            {/* Attributed Penalty Deductions */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 flex flex-col">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5 mb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className={deductions.length > 0 ? 'text-amber-400' : 'text-zinc-400'} />
                  <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
                    Attributed Penalty Deductions
                  </h2>
                </div>
                <span className="text-[10px] text-zinc-400 font-mono">
                  {deductions.length} {deductions.length === 1 ? 'penalty event' : 'penalty events'}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[320px]">
                {deductions.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-2">
                    <div className="p-3 rounded-full bg-emerald-950/40 border border-emerald-800/40 text-emerald-400">
                      <CheckCircle2 size={24} />
                    </div>
                    <p className="text-white font-medium text-xs">Pristine 24-Hour Driving Record</p>
                    <p className="text-zinc-500 text-[11px] max-w-sm">
                      No safety infractions, harsh events, or preventable impacts attributed to this driver. Score is operating at 100.0 baseline.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {deductions.map((d, idx) => {
                      const meta = formatEventType(d.type);
                      const rowKey = d.id ? `deduct-${d.id}-${idx}` : `deduct-${idx}`;

                      return (
                        <div
                          key={rowKey}
                          className="bg-zinc-900/50 border border-zinc-800/80 rounded-md p-3 flex items-center justify-between gap-3 hover:bg-zinc-900 transition-colors"
                        >
                          <div className="flex items-start gap-2.5">
                            <span
                              className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                              style={{ backgroundColor: meta.dotColor }}
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-white text-xs">{meta.label}</span>
                                <span
                                  className={`px-1.5 py-0.2 rounded-xs text-[9px] font-mono font-bold uppercase ${
                                    d.severity === 'critical'
                                      ? 'bg-rose-950 text-rose-400 border border-rose-800/60'
                                      : d.severity === 'high'
                                      ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                                      : 'bg-zinc-800 text-zinc-300'
                                  }`}
                                >
                                  {d.severity}
                                </span>
                              </div>
                              <div className="flex items-center gap-2.5 text-[10px] text-zinc-500 font-mono mt-0.5">
                                <span suppressHydrationWarning className="flex items-center gap-1">
                                  <Clock size={10} className="text-zinc-600" />
                                  {isMounted && d.occurredAt
                                    ? new Date(d.occurredAt).toLocaleTimeString()
                                    : (d.occurredAt ? String(d.occurredAt).slice(11, 19) : '—')}
                                </span>
                                <span>•</span>
                                <span>State: {d.opState}</span>
                                <span>•</span>
                                <span>Decay: {d.decayFactor}x</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right font-mono shrink-0">
                            <span className="text-rose-400 font-bold text-xs">-{d.netPenalty.toFixed(1)}</span>
                            <span className="text-zinc-600 text-[10px] block">pts penalty</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* §8 Fairly Excluded Events (Road Defect & Sensor Protections) */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 flex flex-col">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5 mb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-sky-400" />
                  <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
                    Arbitrated & Excluded Events (§8 Fairness Filter)
                  </h2>
                </div>
                <span className="text-[10px] text-zinc-400 font-mono">
                  {excludedEvents.length} protected
                </span>
              </div>

              <div className="flex-1 overflow-y-auto max-h-[220px]">
                {excludedEvents.length === 0 ? (
                  <div className="p-4 text-center text-zinc-500 font-mono text-[11px]">
                    No external road anomalies or sensor artifacts required arbitration in this window.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {excludedEvents.map((ex, idx) => {
                      const meta = formatEventType(ex.type);
                      const exKey = ex.id ? `ex-${ex.id}-${idx}` : `ex-${idx}`;

                      return (
                        <div
                          key={exKey}
                          className="bg-zinc-900/30 border border-zinc-800/60 rounded-md p-2.5 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className="w-2 h-2 rounded-full mt-1 shrink-0"
                              style={{ backgroundColor: meta.dotColor }}
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-zinc-200">{meta.label}</span>
                                <span className="text-[9px] px-1 py-0.2 rounded-xs bg-sky-950 text-sky-400 border border-sky-800/60 font-mono font-bold">
                                  0.0 PTS PENALTY
                                </span>
                              </div>
                              <p className="text-[10px] text-zinc-500 mt-0.5">{ex.reason}</p>
                            </div>
                          </div>

                          <span suppressHydrationWarning className="text-[10px] font-mono text-zinc-600 shrink-0">
                            {isMounted && ex.occurredAt ? new Date(ex.occurredAt).toLocaleTimeString() : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Driver Registration & Edit Drawer */}
      <DriverDrawer
        isOpen={driverDrawerOpen}
        onClose={() => setDriverDrawerOpen(false)}
        driver={driver}
        vehicles={vehicles}
        onSave={handleSaveDriver}
        onDelete={handleDeleteDriver}
      />

      {/* Score Audit Slide-over Drawer */}
      <ScoreAuditDrawer
        isOpen={scoreAuditOpen}
        onClose={() => setScoreAuditOpen(false)}
        driverName={driver?.name || 'Driver'}
        vehiclePlate={vehicle?.plate || 'No Vehicle'}
        currentScore={currentScore}
        events={events}
      />
    </div>
  );
}
