import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { computeCanonicalScore } from '@/lib/scoring/canonicalEngine';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const driverId = resolvedParams.id;
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const distanceOverride = searchParams.get('distanceKm');

    const supabase = await createClient();

    // 1. Fetch driver and assigned device
    const { data: driver } = await supabase
      .from('drivers')
      .select('id, name')
      .eq('id', driverId)
      .maybeSingle();

    if (!driver) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 });
    }

    const { data: device } = await supabase
      .from('devices')
      .select('device_id')
      .eq('driver_id', driverId)
      .maybeSingle();

    const assignedDeviceId = device?.device_id;

    // 2. Fetch trips for distance calculation
    let tripsQuery = supabase.from('trips').select('*');
    if (assignedDeviceId) {
      tripsQuery = tripsQuery.or(`driver_id.eq.${driverId},device_id.eq.${assignedDeviceId}`);
    } else {
      tripsQuery = tripsQuery.eq('driver_id', driverId);
    }

    if (from) tripsQuery = tripsQuery.gte('started_at', from);
    if (to) tripsQuery = tripsQuery.lte('started_at', to);

    const { data: trips } = await tripsQuery;
    const allTrips = trips || [];

    const calculatedDistanceKm = allTrips.reduce(
      (sum: number, t: any) => sum + (Number(t.distance_m) || 0) / 1000,
      0
    );

    const distanceKm = distanceOverride != null ? Number(distanceOverride) : calculatedDistanceKm;

    // 3. Fetch driving events
    const filterClauses = [`driver_id.eq.${driverId}`];
    if (assignedDeviceId) {
      filterClauses.push(`device_id.eq.${assignedDeviceId}`);
    }
    let eventsQuery = supabase
      .from('driving_events')
      .select('*')
      .or(filterClauses.join(','))
      .or('attributed_to_driver.eq.true,category.eq.driver,type.ilike.driver.%');

    if (from) eventsQuery = eventsQuery.gte('occurred_at', from);
    if (to) eventsQuery = eventsQuery.lte('occurred_at', to);

    const { data: events } = await eventsQuery;
    const allEvents = events || [];

    // 4. Compute canonical score
    const result = computeCanonicalScore({
      distanceKm,
      events: allEvents,
      subjectType: 'driver',
      subjectId: driverId,
    });

    return NextResponse.json({
      score: result.score,
      distanceKm: result.distanceKm,
      penalty: result.penalty,
      events: result.eventsCount,
      driverId,
      name: driver.name,
      trips: allTrips.length,
      breakdown: result.breakdown,
      ruleVersion: result.ruleVersion,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
