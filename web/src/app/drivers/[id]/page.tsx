'use client';

import { use, useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import {
  calculateContinuousScore24h,
  calculateFactorRadarScores,
  calculateDriverDeductions,
  generateScoreTimeline,
  TelematicsEvent,
  DeductionItem,
} from '@/lib/scoring/continuousEngine';
import { formatEventType } from '@/lib/events/format';
import { createClient } from '@/lib/supabase/client';
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  ShieldCheck,
  AlertTriangle,
  Cpu,
  Car,
  Clock,
  Navigation,
  CheckCircle2,
  TrendingUp,
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
  fatigueEco: { label: 'Eco & Operational Habits', desc: 'Excessive idle & depot maneuvering' },
};

export default function DriverScorecard({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const driverId = resolvedParams.id;

  const [driver, setDriver] = useState<any>(null);
  const [device, setDevice] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [activeTrip, setActiveTrip] = useState<ActiveTripSummary | null>(null);
  const [events, setEvents] = useState<TelematicsEvent[]>([]);
  const [timelineData, setTimelineData] = useState<{ hour: string; score: number }[]>([]);
  const [deductions, setDeductions] = useState<DeductionItem[]>([]);
  const [currentScore, setCurrentScore] = useState<number>(100.0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  const loadDriverData = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);

      // 1. Load driver record
      const { data: dData } = await supabase
        .from('drivers')
        .select('*')
        .eq('id', driverId)
        .single();

      if (dData) setDriver(dData);

      // 2. Load assigned device
      const { data: devData } = await supabase
        .from('devices')
        .select('*')
        .eq('driver_id', driverId)
        .maybeSingle();

      let assignedDeviceId: string | null = null;
      if (devData) {
        setDevice(devData);
        assignedDeviceId = devData.device_id;

        // 3. Load associated vehicle
        if (devData.vehicle_id) {
          const { data: vData } = await supabase
            .from('vehicles')
            .select('*')
            .eq('id', devData.vehicle_id)
            .maybeSingle();

          if (vData) setVehicle(vData);
        }
      }

      // 4. Load active trip if any for this driver or their assigned device
      const { data: tripsData } = await supabase
        .from('trips')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(20);

      if (tripsData) {
        const foundActive = tripsData.find((t: any) => {
          const matchDriver = t.driver_id === driverId || (assignedDeviceId && t.device_id === assignedDeviceId);
          const st = String(t.status || '').toLowerCase();
          const isOpen = (st === 'open' || !t.ended_at) && st !== 'closed' && st !== 'abandoned';
          return matchDriver && isOpen;
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
      }

      // 5. Load driving events for this driver (matching assigned device_id or driver's trip_ids)
      let eData: any[] = [];
      if (assignedDeviceId) {
        const { data, error: eErr } = await supabase
          .from('driving_events')
          .select('*')
          .eq('device_id', assignedDeviceId)
          .order('occurred_at', { ascending: false })
          .limit(200);

        if (eErr) {
          console.error('Error querying driving_events for device:', eErr);
        } else if (data) {
          eData = data;
        }
      } else if (tripsData && tripsData.length > 0) {
        const driverTripIds = tripsData
          .filter((t: any) => t.driver_id === driverId)
          .map((t: any) => t.id || t.trip_id)
          .filter(Boolean);

        if (driverTripIds.length > 0) {
          const { data, error: eErr } = await supabase
            .from('driving_events')
            .select('*')
            .in('trip_id', driverTripIds)
            .order('occurred_at', { ascending: false })
            .limit(200);

          if (!eErr && data) {
            eData = data;
          }
        }
      }

      const mappedEvents: TelematicsEvent[] = eData.map((e: any) => ({
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
      }));

      // Update state with events
      setEvents(mappedEvents);

      // Compute dynamic continuous score matching /drivers and /
      const score = calculateContinuousScore24h(mappedEvents);
      setCurrentScore(score);

      // Compute itemized deductions
      const itemizedDeductions = calculateDriverDeductions(mappedEvents);
      setDeductions(itemizedDeductions);

      // Compute score fluctuations timeline
      const timeline = generateScoreTimeline(mappedEvents);
      setTimelineData(timeline);
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

    // Supabase Realtime Channel for instant push updates
    const channel = supabase
      .channel(`realtime_driver_${driverId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'driving_events' },
        () => {
          loadDriverData(false);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips' },
        () => {
          loadDriverData(false);
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'telemetry' },
        () => {
          loadDriverData(false);
        }
      )
      .subscribe();

    const interval = setInterval(() => {
      loadDriverData(false);
    }, 2500);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [driverId, loadDriverData, supabase]);

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
            <div className={`flex items-center gap-4 px-4 py-3 rounded-md border ${scoreBorderColor} ${scoreBgColor} font-mono self-start md:self-auto`}>
              <div>
                <div className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider">
                  24h Safety Score
                </div>
                <div className={`text-2xl font-bold tracking-tight ${scoreColor}`}>
                  {currentScore.toFixed(1)}
                  <span className="text-xs text-zinc-500 font-normal ml-1">/ 100</span>
                </div>
              </div>
              <div className="border-l border-zinc-800 pl-3.5 text-right text-[11px] space-y-0.5">
                <div className="text-zinc-400 font-medium">
                  {deductions.length === 0 ? 'Clean 24h Baseline' : `${deductions.length} Infractions`}
                </div>
                <div className={deductions.length > 0 ? 'text-rose-400 font-semibold' : 'text-emerald-400'}>
                  {deductions.length > 0
                    ? `-${deductions.reduce((sum, d) => sum + d.netPenalty, 0).toFixed(1)} pts deducted`
                    : '100% Zero Penalty'}
                </div>
              </div>
            </div>
          </div>

          {/* Active Trip Telematics Bar (Only rendered when driver is in an active trip) */}
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
            {/* 5 Safety Factors */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={14} className="text-emerald-400" />
                  <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
                    5-Factor Safety Pillars
                  </h2>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">0-100 Score</span>
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

            {/* Score History / Fluctuations Sparkline */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-2">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-zinc-400" />
                  <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Score History (Past 12h)
                  </span>
                </div>
                <span className="text-[10px] text-zinc-500 font-mono">12h Decay Half-Life</span>
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

          {/* Right Column (7 Cols): Itemized Incident Deductions & Penalties */}
          <div className="lg:col-span-7 bg-zinc-950 border border-zinc-800 rounded-md p-4 flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className={deductions.length > 0 ? 'text-amber-400' : 'text-zinc-400'} />
                <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
                  Attributed Penalty Deductions
                </h2>
              </div>
              <span className="text-[10px] text-zinc-400 font-mono">
                {deductions.length} {deductions.length === 1 ? 'event' : 'events'} in 24h
              </span>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[300px]">
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
        </div>
      </div>
    </div>
  );
}
