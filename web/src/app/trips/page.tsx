'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { createClient } from '@/lib/supabase/client';
import {
  ArrowRight,
  Route,
  Activity,
  Square,
  CheckCircle2,
  Loader2,
  Search,
  User,
  Car,
  Clock,
  Navigation,
} from 'lucide-react';

interface TripRow {
  trip_id: string;
  device_id: string;
  driver_id?: string | null;
  driver_name?: string | null;
  vehicle_id?: string | null;
  vehicle_plate?: string | null;
  vehicle_model?: string | null;
  started_at: string;
  ended_at: string | null;
  distance_m: number;
  duration_s: number | null;
  max_speed_kmh: number;
  avg_speed_kmh: number;
  status: 'open' | 'closed' | 'abandoned';
}

export default function TripsExplorer() {
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed' | 'abandoned'>('all');
  const [isMounted, setIsMounted] = useState(false);
  const [closingTripIds, setClosingTripIds] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const supabase = createClient();

  // Keep a 1s clock running for live elapsed time updates on active trips
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadTrips = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trips')
        .select(`
          *,
          drivers:driver_id(id, name),
          vehicles:vehicle_id(id, plate, make, model)
        `)
        .order('started_at', { ascending: false })
        .limit(100);

      if (data && !error) {
        const mappedData: TripRow[] = data.map((r: any) => {
          const rawStatus = String(r.status || '').toLowerCase();
          const status: 'open' | 'closed' | 'abandoned' =
            rawStatus === 'closed'
              ? 'closed'
              : rawStatus === 'abandoned'
              ? 'abandoned'
              : 'open';

          return {
            trip_id: String(r.id || r.trip_id || ''),
            device_id: String(r.device_id || ''),
            driver_id: r.driver_id || null,
            driver_name: r.drivers?.name || null,
            vehicle_id: r.vehicle_id || null,
            vehicle_plate: r.vehicles?.plate || null,
            vehicle_model: r.vehicles?.make && r.vehicles?.model ? `${r.vehicles.make} ${r.vehicles.model}` : null,
            started_at: String(r.started_at || ''),
            ended_at: r.ended_at ? String(r.ended_at) : null,
            distance_m: Number(r.distance_m ?? 0),
            duration_s: r.duration_s != null ? Number(r.duration_s) : null,
            max_speed_kmh: Number(r.max_speed_kmh ?? ((r.max_speed_mps || 0) * 3.6)),
            avg_speed_kmh: Number(r.avg_speed_kmh ?? ((r.avg_speed_mps || 0) * 3.6)),
            status,
          };
        });
        setTrips(mappedData);
      }
    } catch (err) {
      console.error('Failed to load trips:', err);
    }
  }, [supabase]);

  useEffect(() => {
    setIsMounted(true);
    loadTrips();

    // Supabase Realtime channel subscription for instant updates on trips
    const channel = supabase
      .channel('trips-realtime-sub')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => {
        loadTrips();
      })
      .subscribe();

    // Auto-poll fallback every 5 seconds
    const interval = setInterval(loadTrips, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [loadTrips, supabase]);

  const handleEndTrip = async (tripId: string) => {
    if (!tripId || closingTripIds.has(tripId)) return;
    setClosingTripIds((prev) => new Set(prev).add(tripId));

    try {
      const res = await fetch(`/api/trips/${encodeURIComponent(tripId)}/close`, {
        method: 'POST',
      });
      if (res.ok) {
        // Optimistic local update
        setTrips((prev) =>
          prev.map((t) =>
            t.trip_id === tripId
              ? { ...t, status: 'closed', ended_at: new Date().toISOString() }
              : t
          )
        );
      }
      await loadTrips();
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

  const getTripDurationFormatted = (trip: TripRow): string => {
    let seconds = 0;
    if (trip.ended_at && trip.duration_s != null && trip.duration_s > 0) {
      seconds = trip.duration_s;
    } else if (trip.started_at) {
      const startMs = new Date(trip.started_at).getTime();
      const endMs = trip.ended_at ? new Date(trip.ended_at).getTime() : now;
      seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
    }

    if (seconds < 60) {
      return `${seconds}s`;
    }
    const mins = Math.floor(seconds / 60);
    const remainderSec = seconds % 60;
    if (mins < 60) {
      return `${mins}m ${remainderSec}s`;
    }
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${remMins}m`;
  };

  const filteredTrips = useMemo(() => {
    return trips.filter((t) => {
      // Status filter
      if (statusFilter !== 'all') {
        const isOpen = (t.status === 'open' || !t.ended_at) && t.status !== 'closed' && t.status !== 'abandoned';
        if (statusFilter === 'open' && !isOpen) return false;
        if (statusFilter === 'closed' && t.status !== 'closed') return false;
        if (statusFilter === 'abandoned' && t.status !== 'abandoned') return false;
      }

      // Search term
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase();
      const tripId = String(t.trip_id || '').toLowerCase();
      const deviceId = String(t.device_id || '').toLowerCase();
      const driverName = String(t.driver_name || '').toLowerCase();
      const plate = String(t.vehicle_plate || '').toLowerCase();
      const model = String(t.vehicle_model || '').toLowerCase();

      return (
        tripId.includes(q) ||
        deviceId.includes(q) ||
        driverName.includes(q) ||
        plate.includes(q) ||
        model.includes(q)
      );
    });
  }, [trips, searchTerm, statusFilter]);

  const activeCount = trips.filter((t) => {
    return (t.status === 'open' || !t.ended_at) && t.status !== 'closed' && t.status !== 'abandoned';
  }).length;

  const totalDistanceKm = (trips.reduce((acc, t) => acc + (t.distance_m || 0), 0) / 1000).toFixed(1);
  const avgFleetSpeed = (
    trips.reduce((acc, t) => acc + (t.avg_speed_kmh || 0), 0) / (trips.length || 1)
  ).toFixed(1);

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header
        title="Trips Directory"
        subtitle="Fleet trip logs and trajectory replay"
      />

      <div className="p-5 space-y-4 w-full max-w-7xl mx-auto">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Recorded Trips</span>
            <p className="text-xl font-bold font-mono text-white">{trips.length}</p>
            <p className="text-zinc-500 text-[10px]">Total recorded trip segments</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <span>Active in Progress</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </span>
            <p className="text-xl font-bold font-mono text-emerald-400">{activeCount}</p>
            <p className="text-zinc-500 text-[10px]">Auto-finalizing on 90s stationary / 120s idle</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Total Distance</span>
            <p className="text-xl font-bold font-mono text-white">{totalDistanceKm} km</p>
            <p className="text-zinc-500 text-[10px]">Sum of fleet odometer exposure</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Average Fleet Speed</span>
            <p className="text-xl font-bold font-mono text-sky-400">{avgFleetSpeed} km/h</p>
            <p className="text-zinc-500 text-[10px]">GPS moving speed aggregate</p>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search Trip ID, Device, Driver, Plate..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-black text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-700 pl-8 pr-3 py-1.5 rounded-md border border-zinc-800 w-full font-mono"
            />
          </div>

          {/* Status Tab Filters */}
          <div className="flex items-center gap-1 bg-black p-1 rounded-md border border-zinc-800 self-start sm:self-auto font-mono text-[10px]">
            {(
              [
                { key: 'all', label: 'All Trips' },
                { key: 'open', label: 'Active' },
                { key: 'closed', label: 'Completed' },
                { key: 'abandoned', label: 'Abandoned' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  statusFilter === tab.key
                    ? 'bg-zinc-800 text-white font-bold'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <span className="text-zinc-400 text-xs font-mono shrink-0">
            Showing {filteredTrips.length} of {trips.length} Trips
          </span>
        </div>

        {/* Trips Table */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-900/60 text-zinc-400 border-b border-zinc-800 uppercase text-[11px] font-semibold tracking-wider font-mono">
                  <th className="p-3">Trip / Device</th>
                  <th className="p-3">Driver / Vehicle</th>
                  <th className="p-3">Started At</th>
                  <th className="p-3">Duration</th>
                  <th className="p-3">Distance</th>
                  <th className="p-3">Avg / Max Speed</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 text-zinc-300 font-sans">
                {filteredTrips.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-zinc-500 font-mono">
                      No trip records match the current filter.
                    </td>
                  </tr>
                ) : (
                  filteredTrips.map((trip, idx) => {
                    const tripIdStr = String(trip.trip_id || '');
                    const durationStr = getTripDurationFormatted(trip);
                    const distanceKm = ((trip.distance_m || 0) / 1000).toFixed(1);
                    const avgSpeedKmh = (trip.avg_speed_kmh || 0).toFixed(1);
                    const maxSpeedKmh = (trip.max_speed_kmh || 0).toFixed(1);
                    const st = trip.status;
                    const isOpen = (st === 'open' || !trip.ended_at) && st !== 'closed' && st !== 'abandoned';
                    const isClosing = closingTripIds.has(tripIdStr);
                    const rowKey = tripIdStr ? `trip-${tripIdStr}-${idx}` : `trip-${idx}`;

                    return (
                      <tr key={rowKey} className="hover:bg-zinc-900/50 transition-colors">
                        <td className="p-3 font-mono">
                          <div className="font-semibold text-white">
                            {tripIdStr.length > 18 ? `${tripIdStr.slice(0, 18)}...` : tripIdStr}
                          </div>
                          <div className="text-zinc-500 text-[10px] flex items-center gap-1">
                            <span>Device:</span>
                            <span className="text-zinc-300">{trip.device_id || 'N/A'}</span>
                          </div>
                        </td>

                        <td className="p-3">
                          <div className="flex items-center gap-1 text-zinc-200 font-medium">
                            <User size={11} className="text-zinc-500 shrink-0" />
                            <span>{trip.driver_name || 'Unassigned'}</span>
                          </div>
                          <div className="text-zinc-500 text-[10px] flex items-center gap-1 font-mono">
                            <Car size={10} className="text-zinc-600 shrink-0" />
                            <span>{trip.vehicle_plate || trip.vehicle_model || 'No Vehicle'}</span>
                          </div>
                        </td>

                        <td suppressHydrationWarning className="p-3 text-zinc-400 font-mono">
                          {isMounted && trip.started_at ? (
                            <div>
                              <div>{new Date(trip.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                              <div className="text-[10px] text-zinc-600">
                                {new Date(trip.started_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                              </div>
                            </div>
                          ) : (
                            trip.started_at ? trip.started_at.slice(11, 19) : '-'
                          )}
                        </td>

                        <td className="p-3 font-mono">
                          <div className="text-white font-medium flex items-center gap-1">
                            <Clock size={11} className="text-zinc-500" />
                            <span>{durationStr}</span>
                          </div>
                          {isOpen && (
                            <span className="text-[9px] text-emerald-400 block animate-pulse">
                              ticking live
                            </span>
                          )}
                        </td>

                        <td className="p-3 font-mono">
                          <span className="text-white font-semibold">{distanceKm} km</span>
                          <span className="text-zinc-500 text-[10px] block font-normal">
                            {(trip.distance_m || 0).toLocaleString()} m
                          </span>
                        </td>

                        <td className="p-3 text-zinc-300 font-mono">
                          <span className="text-sky-400 font-medium">{avgSpeedKmh}</span>
                          <span className="text-zinc-500"> / </span>
                          <span className="text-zinc-300">{maxSpeedKmh} km/h</span>
                        </td>

                        <td className="p-3 font-mono">
                          {isOpen ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-bold bg-emerald-950/80 border border-emerald-700/60 text-emerald-400 uppercase w-fit">
                                <span className="relative flex h-1.5 w-1.5 shrink-0">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                                </span>
                                IN PROGRESS
                              </span>
                              <span className="text-[9px] text-zinc-500 font-mono">
                                Live recording
                              </span>
                            </div>
                          ) : st === 'closed' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-semibold bg-zinc-900 border border-zinc-800 text-zinc-300 uppercase">
                              <CheckCircle2 size={11} className="text-emerald-500" />
                              COMPLETED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-sm text-[10px] font-medium bg-zinc-900 border border-zinc-800 text-amber-500 uppercase">
                              ABANDONED
                            </span>
                          )}
                        </td>

                        <td className="p-3 text-right">
                          <div className="inline-flex items-center gap-2 justify-end">
                            {isOpen && (
                              <button
                                onClick={() => handleEndTrip(tripIdStr)}
                                disabled={isClosing}
                                className="px-2.5 py-1 rounded-md bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/80 font-medium text-xs transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                                title="Manually finalize and close this trip immediately"
                              >
                                {isClosing ? (
                                  <Loader2 size={12} className="animate-spin text-rose-300" />
                                ) : (
                                  <Square size={10} className="fill-current" />
                                )}
                                <span>End Trip</span>
                              </button>
                            )}
                            <Link
                              href={`/trips/${tripIdStr}`}
                              className="px-2.5 py-1 rounded-md bg-zinc-900 text-white border border-zinc-800 font-medium text-xs hover:bg-zinc-800 transition-colors inline-flex items-center gap-1"
                            >
                              <span>Inspect</span>
                              <ArrowRight size={12} />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
