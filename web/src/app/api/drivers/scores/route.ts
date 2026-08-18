import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { computeCanonicalScore, computeFleetScore } from '@/lib/scoring/canonicalEngine';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const supabase = await createClient();

    // 1. Fetch drivers, devices, vehicles, trips, and events in parallel
    let tripsQuery = supabase.from('trips').select('*').order('started_at', { ascending: false });
    let eventsQuery = supabase
      .from('driving_events')
      .select('*')
      .or('attributed_to_driver.eq.true,category.eq.driver,type.ilike.driver.%')
      .order('occurred_at', { ascending: false });

    if (from) {
      tripsQuery = tripsQuery.gte('started_at', from);
      eventsQuery = eventsQuery.gte('occurred_at', from);
    }
    if (to) {
      tripsQuery = tripsQuery.lte('started_at', to);
      eventsQuery = eventsQuery.lte('occurred_at', to);
    }

    const [driversRes, devicesRes, vehiclesRes, tripsRes, eventsRes] = await Promise.all([
      supabase.from('drivers').select('*'),
      supabase.from('devices').select('*'),
      supabase.from('vehicles').select('*'),
      tripsQuery,
      eventsQuery,
    ]);

    const driversList = driversRes.data || [];
    const devicesList = devicesRes.data || [];
    const vehiclesList = vehiclesRes.data || [];
    const tripsList = tripsRes.data || [];
    const eventsList = eventsRes.data || [];

    // Map lookups
    const deviceByDriverId = new Map<string, string>();
    const vehiclePlateByDriverId = new Map<string, string>();

    for (const dev of devicesList) {
      if (dev.driver_id) {
        deviceByDriverId.set(dev.driver_id, dev.device_id);
        if (dev.vehicle_id) {
          const veh = vehiclesList.find((v) => v.id === dev.vehicle_id);
          if (veh) vehiclePlateByDriverId.set(dev.driver_id, veh.plate_number || veh.model || 'Assigned');
        }
      }
    }

    // Open / active trips
    const openTrips = tripsList.filter((t: any) => {
      const st = String(t.status || '').toLowerCase();
      return (st === 'open' || !t.ended_at) && st !== 'closed' && st !== 'abandoned';
    });

    // 2. Compute canonical score for each driver
    const driverScores = driversList.map((d: any) => {
      const assignedDev = deviceByDriverId.get(d.id);
      const vehiclePlate = vehiclePlateByDriverId.get(d.id) || d.assigned_vehicle_plate || 'Unassigned';

      const driverTrips = tripsList.filter(
        (t: any) => t.driver_id === d.id || (assignedDev && t.device_id === assignedDev)
      );

      const driverEvents = eventsList.filter(
        (e: any) => e.driver_id === d.id || (assignedDev && e.device_id === assignedDev)
      );

      const distKm = driverTrips.reduce(
        (sum: number, t: any) => sum + (Number(t.distance_m) || 0) / 1000,
        0
      );

      const activeTrip = openTrips.find(
        (t: any) => t.driver_id === d.id || (assignedDev && t.device_id === assignedDev)
      );

      const res = computeCanonicalScore({
        distanceKm: distKm,
        events: driverEvents,
        subjectType: 'driver',
        subjectId: d.id,
      });

      const scorableCount = driverEvents.filter((e: any) => e.attributed_to_driver !== false).length;
      const eventsPer100km = distKm > 0 ? Number(((scorableCount / distKm) * 100).toFixed(1)) : 0;

      return {
        driverId: d.id,
        name: d.name,
        score: res.score,
        distanceKm: res.distanceKm,
        penalty: res.penalty,
        events: res.eventsCount,
        trips: driverTrips.length,
        eventsPer100km,
        status: activeTrip ? ('In Trip' as const) : ('Idle' as const),
        has_active_trip: Boolean(activeTrip),
        active_trip_id: activeTrip ? String(activeTrip.id || activeTrip.trip_id || '') : null,
        assigned_device_id: assignedDev || null,
        assigned_vehicle_plate: vehiclePlate,
        breakdown: res.breakdown,
      };
    });

    // 3. Compute canonical Fleet Score (not simple average!)
    const totalFleetDistanceKm = tripsList.reduce(
      (sum: number, t: any) => sum + (Number(t.distance_m) || 0) / 1000,
      0
    );

    const fleetScoreResult = computeFleetScore({
      totalDistanceKm: totalFleetDistanceKm,
      events: eventsList,
    });

    const activeDriversCount = driverScores.filter((d) => d.has_active_trip).length;

    return NextResponse.json({
      fleet: {
        score: fleetScoreResult.score,
        totalDistanceKm: fleetScoreResult.totalDistanceKm,
        totalPenalty: fleetScoreResult.totalPenalty,
        totalEvents: fleetScoreResult.eventsCount,
        totalTrips: tripsList.length,
        activeDrivers: activeDriversCount,
      },
      drivers: driverScores,
      ruleVersion: fleetScoreResult.ruleVersion,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
