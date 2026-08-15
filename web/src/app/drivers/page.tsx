'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { createClient } from '@/lib/supabase/client';
import {
  Users,
  ShieldCheck,
  AlertTriangle,
  Car,
  Search,
  Plus,
  ArrowRight,
  Edit2,
  Trash2,
  Calendar,
  X,
  Navigation,
} from 'lucide-react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  getFleetData,
  createDriver,
  updateDriver,
  deleteDriver,
} from '@/lib/fleet/api';
import { DriverRecord, VehicleRecord, DeviceRecord } from '@/lib/fleet/types';
import { DriverDrawer } from '@/components/fleet/DriverDrawer';
import { calculateContinuousScore24h, TelematicsEvent } from '@/lib/scoring/continuousEngine';
import { ScoreAuditDrawer } from '@/components/scoring/ScoreAuditDrawer';

interface ActiveTripInfo {
  id: string;
  started_at: string;
  distance_m: number;
  avg_speed_kmh: number;
  status: string;
}

interface DriverRow extends DriverRecord {
  active_trip: ActiveTripInfo | null;
  assigned_vehicle_plate?: string | null;
  score24h: number;
  total_distance_km: number;
  total_trips: number;
  events_per_100km: number;
  road_roughness_avg: number;
  assigned_device_id?: string | null;
}

export default function DriversLeaderboard() {
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'matrix'>('leaderboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [telematicsEvents, setTelematicsEvents] = useState<TelematicsEvent[]>([]);
  const [auditDriver, setAuditDriver] = useState<DriverRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  // Drawer state
  const [driverDrawerOpen, setDriverDrawerOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<DriverRecord | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const fleet = await getFleetData(supabase);
      setVehicles(fleet.vehicles);
      setDevices(fleet.devices);

      // Fetch dynamic trips, telematics events, and canonical engine scores
      const [tripsRes, eventsRes, telemetryRes, scoresRes] = await Promise.all([
        supabase.from('trips').select('*').order('started_at', { ascending: false }),
        supabase.from('driving_events').select('*'),
        supabase.from('telemetry').select('device_id, accel_cal').order('server_received_at', { ascending: false }).limit(200),
        supabase.from('scores').select('*').order('period_end', { ascending: false }),
      ]);

      const allTrips = tripsRes.data || [];
      const allScores = scoresRes.data || [];
      const allEvents: TelematicsEvent[] = (eventsRes.data || []).map((e: any) => ({
        id: e.id,
        event_key: e.event_key,
        type: e.type,
        severity: e.severity,
        occurred_at: e.occurred_at,
        magnitude: e.magnitude,
        magnitude_unit: e.magnitude_unit,
        attributed_to_driver: e.attributed_to_driver,
        driver_id: e.driver_id,
        device_id: e.device_id,
      }));
      const allTelemetry = telemetryRes.data || [];
      setTelematicsEvents(allEvents);

      // Identify open / active trips
      const openTrips = allTrips.filter((t: any) => {
        const st = String(t.status || '').toLowerCase();
        return (st === 'open' || !t.ended_at) && st !== 'closed' && st !== 'abandoned';
      });

      const mapped: DriverRow[] = fleet.drivers.map((d) => {
        const assignedDev = d.assigned_device_id;
        
        // Match trips and events by driver_id or assigned device
        const driverTrips = allTrips.filter(
          (t: any) => t.driver_id === d.id || (assignedDev && t.device_id === assignedDev)
        );
        const driverEvents = allEvents.filter(
          (e) => e.driver_id === d.id || (assignedDev && e.device_id === assignedDev)
        );

        // Check canonical engine score first
        const canonicalScoreRow = allScores.find(
          (s: any) =>
            (s.subject_type === 'driver' && s.subject_id === d.id) ||
            (assignedDev && s.subject_type === 'device' && s.subject_id === assignedDev)
        );

        // Find current active trip if any
        const activeTripData = openTrips.find(
          (t: any) => t.driver_id === d.id || (assignedDev && t.device_id === assignedDev)
        );

        const active_trip: ActiveTripInfo | null = activeTripData ? {
          id: String(activeTripData.id || activeTripData.trip_id || ''),
          started_at: String(activeTripData.started_at || ''),
          distance_m: Number(activeTripData.distance_m || 0),
          avg_speed_kmh: Number(activeTripData.avg_speed_kmh || ((activeTripData.avg_speed_mps || 0) * 3.6)),
          status: String(activeTripData.status || 'open'),
        } : null;

        // Compute continuous 24h decay safety score from active driving events
        const score24h = calculateContinuousScore24h(driverEvents);

        // Calculate total distance and trips
        const total_distance_km = driverTrips.reduce(
          (acc: number, t: any) => acc + (Number(t.distance_m) || 0) / 1000,
          0
        );
        const total_trips = driverTrips.length;

        // Incident rate per 100km for driver-attributed violations
        const driverPenaltiesCount = driverEvents.filter((e) => e.attributed_to_driver !== false).length;
        const events_per_100km = total_distance_km > 0
          ? Number((driverPenaltiesCount / (total_distance_km / 100)).toFixed(1))
          : 0;

        // Calculate device road roughness average (RMS m/s2)
        const driverTel = assignedDev ? allTelemetry.filter((tel: any) => tel.device_id === assignedDev) : [];
        let roughness = 0.15;
        if (driverTel.length > 0) {
          const sumRms = driverTel.reduce((acc: number, row: any) => {
            const vRms = Number(row.accel_cal?.vertical_rms) || 0;
            return acc + vRms;
          }, 0);
          roughness = Number((sumRms / driverTel.length).toFixed(2));
        }

        return {
          ...d,
          score24h,
          total_distance_km: Number(total_distance_km.toFixed(1)),
          total_trips,
          events_per_100km,
          road_roughness_avg: roughness,
          active_trip,
        };
      });

      setDrivers(mapped);
    } catch (err) {
      console.error('Error loading driver roster:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    setIsMounted(true);
    loadData(true);

    const channel = supabase
      .channel('drivers_leaderboard_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driving_events' }, () => loadData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => loadData(false))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry' }, () => loadData(false))
      .subscribe();

    const interval = setInterval(() => {
      loadData(false);
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [loadData, supabase]);

  const filteredDrivers = useMemo(() => {
    return drivers.filter((d) => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        d.name.toLowerCase().includes(q) ||
        (d.licence_ref && d.licence_ref.toLowerCase().includes(q)) ||
        (d.assigned_vehicle_plate && d.assigned_vehicle_plate.toLowerCase().includes(q)) ||
        (d.assigned_device_id && d.assigned_device_id.toLowerCase().includes(q));

      return matchesSearch;
    });
  }, [drivers, searchTerm]);

  const scatterData = useMemo(() => {
    return filteredDrivers.map((d) => ({
      name: d.name,
      roadRoughness: d.road_roughness_avg,
      eventRate: d.events_per_100km,
      score: d.score24h,
    }));
  }, [filteredDrivers]);

  const handleSaveDriver = async (formData: {
    name: string;
    licence_ref: string;
    assign_vehicle_id: string;
  }) => {
    if (editingDriver) {
      await updateDriver(supabase, editingDriver.id, formData);
    } else {
      await createDriver(supabase, formData);
    }
    await loadData();
  };

  const handleDeleteDriver = async (id: string) => {
    await deleteDriver(supabase, id);
    await loadData();
  };

  // Fleet aggregate metrics
  const avgSafetyScore = drivers.length > 0
    ? drivers.reduce((acc, d) => acc + d.score24h, 0) / drivers.length
    : 100;
  const inTripCount = drivers.filter((d) => !!d.active_trip).length;
  const assignedCount = drivers.filter((d) => d.assigned_vehicle_id).length;

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header
        title="Drivers"
        subtitle="Driver safety metrics, risk scores, and profile analysis"
      />

      {/* Navigation View Switcher */}
      <div className="bg-zinc-950 border-b border-zinc-800/80 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1 bg-black p-1 rounded-lg border border-zinc-800 text-xs font-medium">
          <button
            onClick={() => setActiveTab('leaderboard')}
            className={`relative px-3 py-1 rounded-md transition-colors ${
              activeTab === 'leaderboard'
                ? 'text-white font-semibold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {activeTab === 'leaderboard' && (
              <motion.span
                layoutId="drivers-tab-pill"
                className="absolute inset-0 bg-zinc-800 rounded-md shadow-xs"
                transition={{ type: 'spring', bounce: 0.15, duration: 0.25 }}
              />
            )}
            <span className="relative z-10">Roster & Safety</span>
          </button>
          <button
            onClick={() => setActiveTab('matrix')}
            className={`relative px-3 py-1 rounded-md transition-colors ${
              activeTab === 'matrix'
                ? 'text-white font-semibold'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            {activeTab === 'matrix' && (
              <motion.span
                layoutId="drivers-tab-pill"
                className="absolute inset-0 bg-zinc-800 rounded-md shadow-xs"
                transition={{ type: 'spring', bounce: 0.15, duration: 0.25 }}
              />
            )}
            <span className="relative z-10">Risk Scatter Matrix</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5 font-mono text-[11px] text-zinc-400">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/50 text-emerald-400 font-bold">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="animate-live-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            {inTripCount} In Active Trip
          </span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
            <Users size={11} className="text-zinc-500" />
            {drivers.length} Drivers
          </span>
        </div>
      </div>

      <div className="p-5 space-y-4 w-full">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-4 space-y-1.5 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
                <Users size={13} className="text-zinc-400" />
                Total Drivers
              </span>
              <span className="text-[10px] font-mono text-zinc-500">Registry</span>
            </div>
            <p className="text-2xl font-bold font-mono text-white tracking-tight">{drivers.length}</p>
            <p className="text-zinc-500 text-[11px]">Enrolled telematics drivers</p>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-4 space-y-1.5 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
                <ShieldCheck size={13} className="text-emerald-400" />
                Fleet Safety Average
              </span>
              <span className="text-[10px] font-mono text-emerald-400/80">Rolling 24h</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold font-mono text-emerald-400 tracking-tight">
                {avgSafetyScore.toFixed(1)}
              </span>
              <span className="text-xs font-mono text-zinc-500">/ 100</span>
            </div>
            <div className="w-full bg-zinc-900 rounded-full h-1 overflow-hidden mt-1">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: `${Math.min(100, Math.max(0, avgSafetyScore))}%` }}
              />
            </div>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-4 space-y-1.5 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
                <Navigation size={13} className="text-emerald-400" />
                Active Trips
              </span>
              <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live Feed
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold font-mono text-emerald-400 tracking-tight">
                {inTripCount}
              </span>
              <span className="text-xs font-mono text-zinc-500">/ {drivers.length} in progress</span>
            </div>
            <p className="text-zinc-500 text-[11px]">Drivers actively moving right now</p>
          </div>

          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-4 space-y-1.5 relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
                <Car size={13} className="text-sky-400" />
                Vehicle Coverage
              </span>
              <span className="text-[10px] font-mono text-sky-400/80">
                {drivers.length > 0 ? Math.round((assignedCount / drivers.length) * 100) : 0}%
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold font-mono text-sky-400 tracking-tight">
                {assignedCount}
              </span>
              <span className="text-xs font-mono text-zinc-500">/ {drivers.length} paired</span>
            </div>
            <p className="text-zinc-500 text-[11px]">Active vehicle pairings</p>
          </div>
        </div>

        {/* Filter Controls & Action Bar */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={13} className="absolute left-3 top-2.5 text-zinc-500" />
            <input
              type="text"
              placeholder="Search driver name, license, vehicle plate, device..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-black text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-700 pl-8 pr-8 py-1.5 rounded-md border border-zinc-800 w-full font-mono transition-colors"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-zinc-400 text-xs font-mono">
              Showing <strong className="text-white">{filteredDrivers.length}</strong> of {drivers.length} drivers
            </span>

            <button
              onClick={() => {
                setEditingDriver(null);
                setDriverDrawerOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-md bg-white text-black hover:bg-zinc-200 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Plus size={13} />
              <span>Register Driver</span>
            </button>
          </div>
        </div>

        {/* Content Body Switcher */}
        {activeTab === 'leaderboard' ? (
          <div className="bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-900/60 text-zinc-400 border-b border-zinc-800 text-[11px] uppercase tracking-wider font-semibold font-mono">
                    <th className="px-3.5 py-2.5">Driver Name</th>
                    <th className="px-3.5 py-2.5">License Ref</th>
                    <th className="px-3.5 py-2.5">Assigned Vehicle</th>
                    <th className="px-3.5 py-2.5">Trip Status</th>
                    <th className="px-3.5 py-2.5">Safety Score</th>
                    <th className="px-3.5 py-2.5">Trips / Distance</th>
                    <th className="px-3.5 py-2.5">Registered Date</th>
                    <th className="px-3.5 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-zinc-300 font-sans">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-zinc-500 font-mono">
                        Loading driver roster...
                      </td>
                    </tr>
                  ) : filteredDrivers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-zinc-500 font-mono">
                        No driver records found matching search.
                      </td>
                    </tr>
                  ) : (
                    filteredDrivers.map((d) => (
                      <tr key={d.id} className="hover:bg-zinc-900/50 transition-colors">
                        {/* Driver Name */}
                        <td className="px-3.5 py-2 font-semibold text-white whitespace-nowrap">
                          {d.name}
                        </td>

                        {/* License Ref */}
                        <td className="px-3.5 py-2 font-mono text-zinc-400 text-[11px] whitespace-nowrap">
                          {d.licence_ref || '—'}
                        </td>

                        {/* Assigned Vehicle - compact single line */}
                        <td className="px-3.5 py-2 font-mono whitespace-nowrap">
                          {d.assigned_vehicle_plate ? (
                            <div className="inline-flex items-center gap-2">
                              <span className="px-1.5 py-0.5 rounded-sm bg-zinc-900 border border-zinc-800 text-zinc-200 text-[11px] inline-flex items-center gap-1">
                                <Car size={11} className="text-zinc-400" />
                                {d.assigned_vehicle_plate}
                              </span>
                              {d.assigned_device_id && (
                                <span className="text-[10px] text-emerald-400 font-mono">
                                  ({d.assigned_device_id})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-zinc-500 text-[11px]">No vehicle</span>
                          )}
                        </td>

                        {/* Trip Status (Active vs Idle) */}
                        <td className="px-3.5 py-2 font-mono whitespace-nowrap">
                          {d.active_trip ? (
                            <Link
                              href={`/trips/${d.active_trip.id}`}
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-emerald-950/80 border border-emerald-700/60 text-emerald-400 hover:bg-emerald-900/60 transition-colors text-[10px] font-bold"
                            >
                              <span className="relative flex h-1.5 w-1.5 shrink-0">
                                <span className="animate-live-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                              </span>
                              <span>IN TRIP</span>
                              <span className="text-emerald-500/80 font-normal">
                                ({((d.active_trip.distance_m || 0) / 1000).toFixed(1)} km)
                              </span>
                            </Link>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-zinc-900 border border-zinc-800 text-zinc-500 text-[10px] font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 shrink-0" />
                              <span>IDLE</span>
                            </span>
                          )}
                        </td>

                        {/* Safety Score - compact single line */}
                        <td className="px-3.5 py-2 font-mono font-bold whitespace-nowrap">
                          <span
                            onClick={() => setAuditDriver(d)}
                            title="Click to view itemized score deduction audit"
                            className={`px-2 py-0.5 rounded-sm text-[10px] cursor-pointer transition-transform hover:scale-105 inline-block ${
                              d.score24h >= 90
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                                : d.score24h >= 75
                                ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                                : 'bg-rose-950 text-rose-400 border border-rose-800/60'
                            }`}
                          >
                            {d.score24h.toFixed(1)} / 100
                          </span>
                        </td>

                        {/* Trips / Distance - compact single line */}
                        <td className="px-3.5 py-2 text-zinc-300 font-mono whitespace-nowrap">
                          {d.total_trips} trips ({d.total_distance_km.toFixed(1)} km)
                        </td>

                        {/* Registered Date - compact single line */}
                        <td className="px-3.5 py-2 font-mono text-zinc-400 text-[11px] whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <Calendar size={11} className="text-zinc-500" />
                            <span suppressHydrationWarning>{isMounted && d.created_at ? new Date(d.created_at).toLocaleDateString() : (d.created_at ? d.created_at.slice(0, 10) : '—')}</span>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="px-3.5 py-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setEditingDriver(d);
                                setDriverDrawerOpen(true);
                              }}
                              title="Edit Driver"
                              className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
                            >
                              <Edit2 size={13} />
                            </button>

                            <button
                              onClick={() => handleDeleteDriver(d.id)}
                              title="Delete Driver"
                              className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-900 transition-colors cursor-pointer"
                            >
                              <Trash2 size={13} />
                            </button>

                            <Link
                              href={`/drivers/${d.id}`}
                              className="px-2 py-0.5 rounded-md bg-zinc-900 text-white border border-zinc-800 font-medium text-xs hover:bg-zinc-800 transition-colors inline-flex items-center gap-1"
                            >
                              <span>Scorecard</span>
                              <ArrowRight size={11} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-zinc-950/80 border border-zinc-800/80 rounded-lg p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                  Risk Scatter Matrix
                </h3>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Correlation of road roughness (m/s² RMS) against penalty anomaly frequency (incidents / 100km)
                </p>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">
                Bubble Size = Driver Safety Index
              </span>
            </div>

            <div className="h-80 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <XAxis
                    dataKey="roadRoughness"
                    name="Road Roughness Index"
                    stroke="#52525b"
                    tick={{ fontSize: 10 }}
                    unit=" RMS"
                  />
                  <YAxis
                    dataKey="eventRate"
                    name="Incidents / 100km"
                    stroke="#52525b"
                    tick={{ fontSize: 10 }}
                    unit=" /100km"
                  />
                  <ZAxis dataKey="score" range={[60, 200]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#09090b',
                      borderColor: '#27272a',
                      borderRadius: '6px',
                      fontSize: '11px',
                    }}
                  />
                  <Scatter data={scatterData} fill="#10b981">
                    {scatterData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.score >= 90 ? '#10b981' : entry.score >= 75 ? '#f59e0b' : '#ef4444'}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Score Audit Slide-over Drawer */}
      {auditDriver && (
        <ScoreAuditDrawer
          isOpen={!!auditDriver}
          onClose={() => setAuditDriver(null)}
          driverName={auditDriver.name}
          vehiclePlate={auditDriver.assigned_vehicle_plate || 'No Vehicle'}
          currentScore={auditDriver.score24h}
          events={
            auditDriver.assigned_device_id
              ? telematicsEvents.filter(
                  (e) =>
                    e.driver_id === auditDriver.id ||
                    e.device_id === auditDriver.assigned_device_id
                )
              : telematicsEvents.filter((e) => e.driver_id === auditDriver.id)
          }
        />
      )}
    </div>
  );
}

