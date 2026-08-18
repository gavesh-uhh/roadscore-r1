import { NextResponse } from 'next/server';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || (body.confirmation === 'PURGE_ALL_DATA' ? 'PURGE_ALL_DATA' : null);

    if (!action || !['CLEAN_TRIPS', 'RESET_SCORES', 'PURGE_ALL_DATA'].includes(action)) {
      return NextResponse.json(
        {
          error:
            'Invalid or missing action. Supported actions: CLEAN_TRIPS, RESET_SCORES, PURGE_ALL_DATA',
        },
        { status: 400 }
      );
    }

    const databaseUrl = process.env.DATABASE_URL;

    if (databaseUrl) {
      const sql = postgres(databaseUrl, { prepare: false });
      try {
        if (action === 'CLEAN_TRIPS') {
          // Clean only trips
          await sql`TRUNCATE TABLE trips CASCADE`;
        } else if (action === 'RESET_SCORES') {
          // Clear only driver misconduct events & scores table to restore baseline 100
          await sql`
            DELETE FROM driving_events 
            WHERE category = 'driver' 
               OR type LIKE 'driver.%' 
               OR attributed_to_driver = true;
            TRUNCATE TABLE scores CASCADE;
          `;
        } else if (action === 'PURGE_ALL_DATA') {
          // Fast atomic TRUNCATE CASCADE across all pipeline tables
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
        }
      } finally {
        await sql.end();
      }
    } else {
      // Fallback via Supabase REST
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
      const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

      if (action === 'CLEAN_TRIPS') {
        await supabase.from('trips').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      } else if (action === 'RESET_SCORES') {
        await supabase
          .from('driving_events')
          .delete()
          .or('category.eq.driver,type.ilike.driver.%,attributed_to_driver.eq.true');
        await supabase.from('scores').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      } else if (action === 'PURGE_ALL_DATA') {
        await supabase.from('scores').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase
          .from('driving_events')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('trips').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase
          .from('road_defects')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase
          .from('predictions')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('road_cells').delete().neq('h3_12', '');
        await supabase.from('engine_checkpoints').delete().neq('consumer', '');
        await supabase.from('telemetry').delete().gte('id', 0);
      }
    }

    let message = '';
    if (action === 'CLEAN_TRIPS') {
      message = 'All trip history has been cleared. Driver profiles, telemetry, and road defects preserved.';
    } else if (action === 'RESET_SCORES') {
      message = 'All driver infractions cleared. Driver safety scores are restored to 100.0 baseline.';
    } else {
      message = 'All telematics, trips, driving events, road cells, defects, and scores have been purged to 0. Fleet configuration preserved.';
    }

    return NextResponse.json({
      success: true,
      action,
      message,
      executedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Data management action error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error while performing data management action' },
      { status: 500 }
    );
  }
}
