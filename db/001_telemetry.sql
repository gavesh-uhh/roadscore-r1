-- =============================================================================
-- RoadScore — 001_telemetry.sql
-- Ingestion table schema, indexes, Realtime publication & RLS policies
-- =============================================================================

-- Main telemetry ingestion table (1 Hz per active MCU device)
create table if not exists public.telemetry (
  id                 bigint generated always as identity primary key,

  device_id          text        not null,
  seq                bigint,                    -- per-boot sequence counter
  ts                 timestamptz,               -- GPS UTC timestamp (null if no fix)
  uptime_ms          bigint      not null,
  window_ms          integer     not null,
  samples            integer     not null,      -- inner 50 Hz samples in window

  -- Self-describing calibration frame
  calibration        jsonb       not null,      -- { gravity_ref, state, age_ms }

  -- Raw sensor samples (16-bit MPU counts)
  accel_raw          jsonb       not null,      -- { x, y, z }
  gyro_raw           jsonb       not null,      -- { x, y, z }

  -- Calibrated window aggregates
  accel_cal          jsonb       not null,      -- { vertical_rms, vertical_peak, horizontal_peak, magnitude_peak }
  gyro_cal           jsonb       not null,      -- { yaw_rate_peak, pitch_rate_peak, roll_rate_peak, magnitude_peak }

  mic                jsonb,                      -- { rms, peak }
  gps                jsonb,                      -- { fix, lat, lon, speed_kmh, heading, altitude, sats, hdop }

  wifi_rssi          integer,
  accel_fs_g         integer,                    -- hardware accelerometer full-scale range (e.g. 2, 4, 8, 16)
  gyro_fs_dps        integer,                    -- hardware gyroscope full-scale range (e.g. 250, 500, 1000, 2000)
  fw_version         text,                       -- firmware semver string
  dropped_posts      bigint,                     -- MCU firmware network drop counter
  server_received_at timestamptz not null default now()
);

-- Fast "latest rows for a device" lookups
create index if not exists telemetry_device_time_idx
  on public.telemetry (device_id, server_received_at desc);

-- Expression index for quick lat/lon extraction
create index if not exists telemetry_gps_idx
  on public.telemetry (((gps->>'lat')::float8), ((gps->>'lon')::float8));

-- Sweeper index: enables fast interval scan by server_received_at for Engine backfill
create index if not exists telemetry_recv_idx
  on public.telemetry (server_received_at);

-- -----------------------------------------------------------------------------
-- Realtime & Row Level Security (RLS)
-- -----------------------------------------------------------------------------

-- Enable Supabase Realtime streaming on telemetry table
alter publication supabase_realtime add table public.telemetry;

-- Enable RLS
alter table public.telemetry enable row level security;

-- Policy: allow anonymous insertion from device firmware
create policy "devices can insert telemetry"
  on public.telemetry
  for insert
  to anon
  with check (true);

-- Policy: allow clients / dashboard to read telemetry
create policy "clients can read telemetry"
  on public.telemetry
  for select
  to anon, authenticated
  using (true);
