import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const tripId = decodeURIComponent(id);

    if (!tripId) {
      return NextResponse.json({ error: 'Trip ID is required' }, { status: 400 });
    }

    const supabase = await createClient();

    // Fetch existing trip record
    const { data: trip, error: fetchErr } = await supabase
      .from('trips')
      .select('*')
      .eq('id', tripId)
      .limit(1)
      .maybeSingle();

    if (fetchErr) {
      return NextResponse.json(
        { error: `Database query failed: ${fetchErr.message}` },
        { status: 500 }
      );
    }

    if (!trip) {
      return NextResponse.json(
        { error: `Trip '${tripId}' not found` },
        { status: 404 }
      );
    }

    const nowIso = new Date().toISOString();
    const startedAtMs = trip.started_at ? new Date(trip.started_at).getTime() : Date.now();
    const durationS = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));

    // Update trip in Supabase
    const { data: updated, error: updateErr } = await supabase
      .from('trips')
      .update({
        ended_at: nowIso,
        duration_s: durationS,
        status: 'closed',
      })
      .eq('id', tripId)
      .select()
      .single();

    if (updateErr) {
      return NextResponse.json(
        { error: `Failed to update trip: ${updateErr.message}` },
        { status: 500 }
      );
    }

    // Try notifying the telemetry engine if available
    const engineUrl = process.env.ENGINE_URL || 'http://127.0.0.1:8080';
    if (trip.device_id) {
      try {
        await fetch(`${engineUrl}/admin/trips/force-close`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: trip.device_id }),
          signal: AbortSignal.timeout(1500),
        });
      } catch {
        // Engine might be running separately or offline; database is updated
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Trip finalized and closed successfully',
      trip: updated,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
