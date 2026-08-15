'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { createClient } from '@/lib/supabase/client';
import { ArrowRight, Route, ShieldCheck, Activity, Square, CheckCircle2, Loader2 } from 'lucide-react';

interface TripRow {
  trip_id: string;
  device_id: string;
  started_at: string;
  ended_at: string | null;
  distance_m: number;
  duration_s: number;
  max_speed_kmh: number;
  avg_speed_kmh: number;
  status: string;
}

export default function TripsExplorer() {
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isMounted, setIsMounted] = useState(false);
  const [closingTripIds, setClosingTripIds] = useState<Set<string>>(new Set());
  const supabase = createClient();

  const loadTrips = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(50);

      if (data && !error) {
        const mappedData: TripRow[] = data.map((r: any) => ({
          trip_id: String(r.id || r.trip_id || ''),
          device_id: String(r.device_id || ''),
          started_at: String(r.started_at || ''),
          ended_at: r.ended_at ? String(r.ended_at) : null,
          distance_m: Number(r.distance_m ?? 0),
          duration_s: Number(r.duration_s ?? 0),
          max_speed_kmh: Number(r.max_speed_kmh ?? ((r.max_speed_mps || 0) * 3.6)),
          avg_speed_kmh: Number(r.avg_speed_kmh ?? ((r.avg_speed_mps || 0) * 3.6)),
          status: String(r.status || 'Active'),
        }));
        setTrips(mappedData);
      }
    } catch {
      // DB error handler
    }
  }, [supabase]);

  useEffect(() => {
    setIsMounted(true);
    loadTrips();

    // Auto-poll trip updates every 5 seconds
    const interval = setInterval(loadTrips, 5000);
    return () => clearInterval(interval);
  }, [loadTrips]);

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

  const filteredTrips = trips.filter((t) => {
    const tripId = String(t.trip_id || '').toLowerCase();
    const deviceId = String(t.device_id || '').toLowerCase();
    const query = searchTerm.toLowerCase();

    return tripId.includes(query) || deviceId.includes(query);
  });

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header
        title="Trips Directory"
        subtitle="Fleet trip logs and trajectory replay"
      />

      <div className="p-5 space-y-4 w-full">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Recorded Trips</span>
            <p className="text-xl font-bold font-mono text-white">{trips.length}</p>
            <p className="text-zinc-500 text-[10px]">Total recorded trips</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
              <span>Active in Progress</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </span>
            <p className="text-xl font-bold font-mono text-emerald-400">
              {trips.filter((t) => {
                const st = String(t.status || '').toLowerCase();
                return (st === 'open' || !t.ended_at) && st !== 'closed' && st !== 'abandoned';
              }).length}
            </p>
            <p className="text-zinc-500 text-[10px]">Auto-finalizing on 90s dwell / 120s idle</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Total Distance</span>
            <p className="text-xl font-bold font-mono text-white">
              {(trips.reduce((acc, t) => acc + (t.distance_m || 0), 0) / 1000).toFixed(1)} km
            </p>
            <p className="text-zinc-500 text-[10px]">Sum of fleet distance</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Average Fleet Speed</span>
            <p className="text-xl font-bold font-mono text-sky-400">
              {(trips.reduce((acc, t) => acc + (t.avg_speed_kmh || 0), 0) / (trips.length || 1)).toFixed(1)} km/h
            </p>
            <p className="text-zinc-500 text-[10px]">GPS moving speed average</p>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 flex items-center justify-between">
          <input
            type="text"
            placeholder="Search by Trip ID or Device ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-black text-xs text-white placeholder-zinc-500 focus:outline-none px-3 py-1.5 rounded-md border border-zinc-800 w-80 font-mono"
          />

          <span className="text-zinc-400 text-xs font-mono">
            Showing {filteredTrips.length} of {trips.length} Trips
          </span>
        </div>

        {/* Trips Table */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-900/60 text-zinc-400 border-b border-zinc-800 uppercase text-[11px] font-semibold tracking-wider">
                <th className="p-3">Trip ID</th>
                <th className="p-3">Device ID</th>
                <th className="p-3">Started At</th>
                <th className="p-3">Duration</th>
                <th className="p-3">Distance</th>
                <th className="p-3">Avg / Max Speed</th>
                <th className="p-3">Status & Auto-Closure</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 text-zinc-300 font-sans">
              {filteredTrips.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-zinc-500">
                    No trip records found.
                  </td>
                </tr>
              ) : (
                filteredTrips.map((trip) => {
                  const tripIdStr = String(trip.trip_id || '');
                  const durationMin = ((trip.duration_s || 0) / 60).toFixed(0);
                  const distanceKm = ((trip.distance_m || 0) / 1000).toFixed(1);
                  const avgSpeedKmh = (trip.avg_speed_kmh || 0).toFixed(1);
                  const maxSpeedKmh = (trip.max_speed_kmh || 0).toFixed(1);
                  const st = String(trip.status || '').toLowerCase();
                  const isOpen = (st === 'open' || !trip.ended_at) && st !== 'closed' && st !== 'abandoned';
                  const isClosing = closingTripIds.has(tripIdStr);

                  return (
                    <tr key={tripIdStr} className="hover:bg-zinc-900/50 transition-colors">
                      <td className="p-3 font-semibold text-white font-mono">
                        {tripIdStr.length > 16 ? `${tripIdStr.slice(0, 16)}...` : tripIdStr}
                      </td>
                      <td className="p-3 text-white font-medium font-mono">{trip.device_id || 'N/A'}</td>
                      <td suppressHydrationWarning className="p-3 text-zinc-400 font-mono">
                        {isMounted && trip.started_at ? new Date(trip.started_at).toLocaleTimeString() : (trip.started_at ? trip.started_at.slice(11, 19) : '')}
                      </td>
                      <td className="p-3 text-zinc-300 font-mono">{durationMin} mins</td>
                      <td className="p-3 text-white font-semibold font-mono">{distanceKm} km</td>
                      <td className="p-3 text-zinc-300 font-mono">{avgSpeedKmh} / {maxSpeedKmh} km/h</td>
                      <td className="p-3 font-mono">
                        {isOpen ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-[10px] font-bold bg-emerald-950/80 border border-emerald-700/60 text-emerald-400 uppercase w-fit">
                              <span className="relative flex h-1.5 w-1.5 shrink-0">
                                <span className="animate-live-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                              </span>
                              ACTIVE / IN TRIP
                            </span>
                            <span className="text-[9px] text-zinc-500 font-mono">
                              90s stationary or 120s idle timeout
                            </span>
                          </div>
                        ) : st === 'closed' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-semibold bg-zinc-900 border border-zinc-800 text-zinc-400 uppercase">
                            <CheckCircle2 size={11} className="text-emerald-500" />
                            COMPLETED
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-sm text-[10px] font-medium bg-zinc-900 border border-zinc-800 text-zinc-500 uppercase">
                            {trip.status}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="inline-flex items-center gap-2 justify-end">
                          {isOpen && (
                            <button
                              onClick={() => handleEndTrip(tripIdStr)}
                              disabled={isClosing}
                              className="px-2.5 py-1 rounded-md bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/80 font-medium text-xs transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
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
                            <span>Replay</span>
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
  );
}

