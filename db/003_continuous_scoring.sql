-- Migration 003: Continuous 24/7 Driver Safety Scoring Schema

-- 1. Create rolling_window_type ENUM if not exists
DO $$ BEGIN
  CREATE TYPE rolling_window_type AS ENUM ('rolling_15m', 'rolling_24h', 'rolling_7d', 'rolling_30d');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Create continuous_score_windows table
CREATE TABLE IF NOT EXISTS public.continuous_score_windows (
  window_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  op_state TEXT NOT NULL CHECK (op_state IN ('DRIVING', 'STATIONARY_IDLE', 'YARD_MANEUVER', 'OFF_ROAD_PTO')),
  
  distance_km NUMERIC DEFAULT 0.0,
  idle_minutes NUMERIC DEFAULT 0.0,
  event_count INT DEFAULT 0,
  window_score NUMERIC(5,2) NOT NULL CHECK (window_score BETWEEN 0 AND 100),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_windows_driver_time 
ON public.continuous_score_windows (driver_id, window_start DESC);

-- 3. Extend drivers table
ALTER TABLE public.drivers 
  ADD COLUMN IF NOT EXISTS continuous_score_24h NUMERIC(5,2) DEFAULT 100.00,
  ADD COLUMN IF NOT EXISTS continuous_trend_15m NUMERIC(4,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS current_op_state TEXT DEFAULT 'STATIONARY_IDLE',
  ADD COLUMN IF NOT EXISTS total_idle_hours_today NUMERIC(6,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS yard_events_count_today INT DEFAULT 0;

-- 4. Extend driving_events table with driver_id reference
ALTER TABLE public.driving_events 
  ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES public.drivers(id);

CREATE INDEX IF NOT EXISTS idx_driving_events_driver_time 
ON public.driving_events (driver_id, occurred_at DESC);

-- 5. Create cached rolling_scores table
CREATE TABLE IF NOT EXISTS public.rolling_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  window_type rolling_window_type NOT NULL,
  score NUMERIC(5, 2) NOT NULL,
  exposure_km NUMERIC(10, 3) NOT NULL,
  exposure_min NUMERIC(10, 2) NOT NULL,
  breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rule_version TEXT NOT NULL DEFAULT 'v1.0.0',
  UNIQUE (driver_id, window_type, rule_version)
);

CREATE INDEX IF NOT EXISTS idx_rolling_scores_lookup 
ON public.rolling_scores (driver_id, window_type);

-- 6. View for Drivers Leaderboard
CREATE OR REPLACE VIEW public.view_drivers_leaderboard AS
SELECT 
  d.id,
  d.name,
  COALESCE(dev.device_id, 'unassigned') AS assigned_device,
  COALESCE(d.continuous_score_24h, 100.0) AS road_score,
  COALESCE(d.continuous_trend_15m, 0.0) AS trend_15m,
  COALESCE(d.current_op_state, 'STATIONARY_IDLE') AS current_op_state,
  COALESCE(rs.exposure_km, 0.0) AS total_distance_km,
  COALESCE(rs.exposure_min / 60.0, 0.0) AS total_driving_hours,
  CASE 
    WHEN COALESCE(rs.exposure_km, 0) > 0 THEN 
      (SELECT COUNT(*) FROM public.driving_events WHERE driver_id = d.id AND occurred_at >= NOW() - INTERVAL '7 days' AND attributed_to_driver = true) / (rs.exposure_km / 100.0)
    ELSE 0.0
  END AS events_per_100km,
  COALESCE((
    SELECT AVG(vert_rms_avg) 
    from public.telemetry_rollup_1m 
    where device_id = dev.device_id and minute >= NOW() - INTERVAL '7 days'
  ), 0.12) AS road_roughness_avg
FROM public.drivers d
LEFT JOIN public.devices dev ON dev.driver_id = d.id AND dev.active = true
LEFT JOIN public.rolling_scores rs ON rs.driver_id = d.id AND rs.window_type = 'rolling_7d';
