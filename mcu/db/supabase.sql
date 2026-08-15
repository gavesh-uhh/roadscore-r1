-- ===========================================================================
-- RoadScore — Supabase schema
--
-- One row per device per second. The MCU POSTs to the PostgREST endpoint
-- (/rest/v1/telemetry); the INSERT is auto-broadcast over Realtime to any
-- subscribed client. Raw MPU data is kept alongside the calibrated stats so
-- the server can re-derive anything later.
-- ===========================================================================

create table if not exists public.telemetry (
  id                 bigint generated always as identity primary key,

  device_id          text        not null,
  seq                bigint,                    -- per-boot counter (detect drops)
  ts                 timestamptz,               -- GPS UTC, null until fix
  uptime_ms          bigint      not null,
  window_ms          integer     not null,
  samples            integer     not null,      -- inner samples this window

  -- Self-describing calibration frame.
  calibration        jsonb       not null,      -- { gravity_ref, state, age_ms }

  -- Raw last-sample (all six axes, verbatim).
  accel_raw          jsonb       not null,      -- { x, y, z }
  gyro_raw           jsonb       not null,      -- { x, y, z }

  -- Calibrated, gravity-aware window statistics.
  accel_cal          jsonb       not null,      -- { vertical_rms, vertical_peak,
                                                --   horizontal_peak, magnitude_peak }
  gyro_cal           jsonb       not null,      -- { yaw_rate_peak, magnitude_peak }

  mic                jsonb,                      -- { rms, peak }
  gps                jsonb,                      -- { fix, lat, lon, speed_kmh, ... }

  wifi_rssi          integer,
  server_received_at timestamptz not null default now()
);

-- Fast "latest rows for a device" queries.
create index if not exists telemetry_device_time_idx
  on public.telemetry (device_id, server_received_at desc);

-- Geo lookups (expression index on the extracted lat/lon).
create index if not exists telemetry_gps_idx
  on public.telemetry (((gps->>'lat')::float8), ((gps->>'lon')::float8));

-- ---------------------------------------------------------------------------
-- Realtime: broadcast INSERTs on this table to subscribed clients.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.telemetry;

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- If the device uses the anon key (recommended over service_role in firmware),
-- enable RLS and allow anonymous INSERTs. Tighten to taste (e.g. a check on
-- device_id, or a per-device signed token) before going to production.
-- ---------------------------------------------------------------------------
alter table public.telemetry enable row level security;

create policy "devices can insert telemetry"
  on public.telemetry
  for insert
  to anon
  with check (true);

-- Allow the dashboard (anon/auth) to read.
create policy "clients can read telemetry"
  on public.telemetry
  for select
  to anon, authenticated
  using (true);
