import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { computeFleetScore } from '@/lib/scoring/canonicalEngine';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const supabase = await createClient();

    let tripsQuery = supabase.from('trips').select('distance_m, started_at');
    let eventsQuery = supabase
      .from('driving_events')
      .select('*')
      .or('attributed_to_driver.eq.true,category.eq.driver,type.ilike.driver.%');

    if (from) {
      tripsQuery = tripsQuery.gte('started_at', from);
      eventsQuery = eventsQuery.gte('occurred_at', from);
    }
    if (to) {
      tripsQuery = tripsQuery.lte('started_at', to);
      eventsQuery = eventsQuery.lte('occurred_at', to);
    }

    const [tripsRes, eventsRes] = await Promise.all([tripsQuery, eventsQuery]);

    const trips = tripsRes.data || [];
    const events = eventsRes.data || [];

    const totalFleetDistanceKm = trips.reduce(
      (sum: number, t: any) => sum + (Number(t.distance_m) || 0) / 1000,
      0
    );

    const result = computeFleetScore({
      totalDistanceKm: totalFleetDistanceKm,
      events,
    });

    return NextResponse.json({
      score: result.score,
      totalDistanceKm: result.totalDistanceKm,
      totalPenalty: result.totalPenalty,
      contributionsCount: result.contributionsCount,
      eventsCount: result.eventsCount,
      tripsCount: trips.length,
      breakdown: result.breakdown,
      ruleVersion: result.ruleVersion,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
