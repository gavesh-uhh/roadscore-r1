import { NextResponse } from 'next/server';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    if (body.confirmation !== 'PURGE_ALL_DATA') {
      return NextResponse.json(
        { error: 'Missing or invalid confirmation string. Required: PURGE_ALL_DATA' },
        { status: 400 }
      );
    }

    const databaseUrl = process.env.DATABASE_URL;

    if (databaseUrl) {
      // Fast atomic TRUNCATE CASCADE across all pipeline tables
      const sql = postgres(databaseUrl, { prepare: false });
      try {
        await sql`
          TRUNCATE TABLE 
            scores, 
            driving_events, 
            trips, 
            road_defects, 
            road_cells, 
            predictions, 
            engine_checkpoints, 
            telemetry_rollup_1m, 
            telemetry 
          CASCADE
        `;
      } finally {
        await sql.end();
      }
    } else {
      // Fallback via Supabase REST
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

      await supabase.from('scores').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('driving_events').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('trips').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('road_defects').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('predictions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      await supabase.from('road_cells').delete().neq('h3_12', '');
      await supabase.from('engine_checkpoints').delete().neq('consumer', '');
      await supabase.from('telemetry').delete().gte('id', 0);
    }

    return NextResponse.json({
      success: true,
      message: 'All telematics, trips, driving events, road cells, defects, and scores have been purged to 0. Fleet configuration (devices, vehicles, drivers) preserved.',
      purgedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Purge error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error while purging data' },
      { status: 500 }
    );
  }
}
