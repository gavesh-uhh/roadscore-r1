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
-- =============================================================================
-- 002_engine.sql — everything the engine derives from telemetry
-- =============================================================================
--
-- ENGINE-PLAN §4. `public.telemetry` is untouched here; these tables are built
-- *around* it, not in front of it. Nothing in this file is on the device's write
-- path, so a migration failure here can never cost us raw data.
--
-- Two properties are load-bearing across the whole schema and are asserted at
-- the database level rather than trusted to application code:
--
--   * `driving_events.event_key` is UNIQUE. It is a deterministic hash of
--     (device_id, boot_id, type, anchor_seq, rule_version). Realtime duplicates,
--     the sweeper's 10 s overlap re-scan, and a manual replay all collapse onto
--     the same row. Without this constraint the backfill path double-counts
--     penalties and a driver's score depends on how many times the engine
--     happened to restart — which is indefensible in a system whose stated goal
--     is transparent accountability.
--
--   * `rule_version` is stamped on every event and every score. Re-running new
--     thresholds over history produces a comparable, side-by-side set instead of
--     silently overwriting the old verdict. This is what makes a disputed event
--     auditable: you can show the driver both the old and the new judgement and
--     say which rules produced each.
--
-- Idempotency: everything is `if not exists` / `drop policy if exists` so the
-- migration runner can re-apply the file against a partially-migrated database
-- without manual cleanup.
-- =============================================================================

-- gen_random_uuid() lives here on stock Postgres; Supabase pre-installs it, but
-- a local dev database or a CI container may not have it.
create extension if not exists pgcrypto;


-- =============================================================================
-- identity
-- =============================================================================
--
-- Static `device_id → vehicle_id → driver_id` mapping, per the agreed scope.
-- Deliberately not temporal: a v2 that reassigns vehicles between drivers needs
-- validity intervals here and a point-in-time lookup at trip start. Today the
-- driver is snapshotted onto the trip row instead (see `trips.driver_id`), which
-- gives us the same audit property — a trip's attribution cannot be rewritten by
-- a later change to this table — without the join complexity.

create table if not exists public.drivers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  licence_ref text,
  created_at  timestamptz not null default now()
);

create table if not exists public.vehicles (
  id    uuid primary key default gen_random_uuid(),
  plate text unique,
  make  text,
  model text,
  year  int,
  constraint vehicles_year_sane check (year is null or (year between 1950 and 2100))
);

create table if not exists public.devices (
  -- Text, not uuid: this is the string the firmware puts in
  -- `telemetry.device_id`, and it must match byte-for-byte or the engine's
  -- unknown-device rejection (§3, poisoned-telemetry gate) fires on our own fleet.
  device_id    text primary key,
  vehicle_id   uuid references public.vehicles(id),
  driver_id    uuid references public.drivers(id),

  -- Firmware ask #1 has not landed, so the count→SI conversion factors live
  -- here per device rather than being hard-coded in the engine. The moment
  -- anyone widens the accelerometer range (§2.4, firmware ask #2) this row is
  -- the single place that has to change, and historical thresholds keep their
  -- meaning because events already written recorded SI magnitudes, not counts.
  accel_fs_g   numeric not null default 2,
  gyro_fs_dps  numeric not null default 250,

  installed_at timestamptz,
  active       bool not null default true,

  constraint devices_accel_fs_positive check (accel_fs_g  > 0),
  constraint devices_gyro_fs_positive  check (gyro_fs_dps > 0)
);

create index if not exists devices_vehicle_idx on public.devices (vehicle_id);
create index if not exists devices_driver_idx  on public.devices (driver_id);


-- =============================================================================
-- trips
-- =============================================================================
--
-- A trip is the exposure denominator for scoring (§8) as much as it is a UI
-- object: a 200 km motorway shift must not outscore a 5 km errand simply by
-- accumulating fewer events per kilometre, so `distance_m` and `duration_s` here
-- are the numbers §8 divides by.

create table if not exists public.trips (
  id         uuid primary key default gen_random_uuid(),
  device_id  text not null references public.devices(device_id),

  -- Snapshotted at trip start, not joined at read time. If a device is
  -- reassigned tomorrow, yesterday's trips keep yesterday's attribution.
  driver_id  uuid references public.drivers(id),
  vehicle_id uuid references public.vehicles(id),

  -- `${device_id}:${first uptime anchor}`. `seq` and `uptime_ms` are per-boot,
  -- so ordering is only meaningful within a boot_id — this column is what makes
  -- "order by (device_id, boot_id, seq)" a total order rather than a guess.
  boot_id    text not null,

  started_at timestamptz not null,
  ended_at   timestamptz,

  start_lat float8, start_lon float8,
  end_lat   float8, end_lon   float8,

  distance_m    float8 not null default 0,
  duration_s    int,
  moving_s      int not null default 0,
  idle_s        int not null default 0,
  max_speed_kmh float8,
  avg_speed_kmh float8,

  -- The exact `telemetry.id` range this trip was derived from. Cheap to store,
  -- and it is what turns "the engine says you braked hard" into "here are the
  -- 1 Hz rows, go and check". Same motivation as `driving_events.telemetry_ids`.
  telemetry_from bigint,
  telemetry_to   bigint,

  -- Fraction of rows that had a GPS fix. §8 excludes trips below 0.5 from daily
  -- rollups: without position we cannot compute distance, so the exposure
  -- denominator would be wrong and the score meaninglessly harsh.
  gps_coverage numeric,

  status text not null default 'open',

  constraint trips_status_valid       check (status in ('open', 'closed', 'abandoned')),
  constraint trips_gps_coverage_range check (gps_coverage is null or (gps_coverage between 0 and 1)),
  constraint trips_time_ordered       check (ended_at is null or ended_at >= started_at),
  constraint trips_distance_nonneg    check (distance_m >= 0)
);

create index if not exists trips_device_started_idx on public.trips (device_id, started_at desc);
create index if not exists trips_driver_started_idx on public.trips (driver_id, started_at desc);
-- The trip-close sweeper and the abandon job both ask "which trips are still
-- open?", which is a tiny fraction of the table forever. Partial index.
create index if not exists trips_open_idx on public.trips (device_id) where status = 'open';


-- =============================================================================
-- driving_events
-- =============================================================================

create table if not exists public.driving_events (
  id        uuid primary key default gen_random_uuid(),

  -- The idempotency key. See the header. UNIQUE is the whole point of the column.
  event_key text not null unique,

  trip_id   uuid references public.trips(id),
  device_id text not null,

  -- Not constrained to an enum on purpose. Adding a detector should be a code
  -- change plus a `rule_version` bump, not a schema migration and a deploy
  -- ordering problem — and an event type this database has never seen is
  -- exactly what a replay of a newer engine over old data produces. The prefix
  -- check below still enforces the one invariant that actually matters.
  type     text not null,
  category text not null,
  severity text not null,
  confidence numeric not null,

  occurred_at  timestamptz not null,
  -- 'gps' | 'anchored' | 'server' (§2.6). Stamped on every event so the
  -- dashboard can be honest about how well it knows when this happened, rather
  -- than presenting a server-clock guess with the same authority as a GPS fix.
  time_quality text not null,

  lat float8, lon float8,
  h3_12 text,
  heading_sector smallint,
  speed_kmh float8,

  -- SI, always. e.g. (-4.7, 'm/s2'). Storing the unit alongside the number is
  -- what lets a full-scale-range change (firmware ask #2) coexist with history.
  magnitude numeric,
  magnitude_unit text,

  -- True when the ±2 g axis railed (§2.4). Detection is reliable; severity is
  -- right-censored. §8 must use the capped severity and never extrapolate — a
  -- clipped reading is a lower bound, and treating a lower bound as a
  -- measurement would penalise the driver for the sensor's limits.
  severity_censored bool not null default false,

  -- The fairness switch. Only `true` events reach the score (§8). Road defects,
  -- undecided impacts and every integrity event are excluded here, in data, in
  -- one place, so the claim is auditable rather than asserted.
  attributed_to_driver bool not null default true,

  -- Set when arbitration (§7.3) says "road, not driver". Deliberately NOT a
  -- foreign key: events and their defect are written in the same batch, and the
  -- nightly re-arbitration job rewrites this column on historical rows. A FK
  -- would impose an insert ordering on the writer and turn a retroactive
  -- promotion into a lock-ordering problem for no integrity gain we cannot get
  -- from a periodic consistency check.
  road_defect_id uuid,

  -- The window that triggered it. The proposal's evidence claim (Ch. 1.3) is
  -- only as good as this column.
  evidence jsonb not null,
  -- The exact source rows. `evidence` is the engine's interpretation;
  -- `telemetry_ids` is the primary source it can be re-derived from. An event
  -- with an empty array is unfalsifiable, so it is not allowed to exist — see
  -- the CHECK below.
  telemetry_ids bigint[] not null,

  rule_version   text not null,
  engine_version text not null,
  created_at     timestamptz not null default now(),

  constraint driving_events_category_valid check (category in ('driver', 'road', 'integrity')),
  constraint driving_events_severity_valid check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  constraint driving_events_time_quality_valid check (time_quality in ('gps', 'anchored', 'server')),
  constraint driving_events_confidence_range check (confidence between 0 and 1),
  constraint driving_events_sector_range check (heading_sector is null or (heading_sector between 0 and 7)),

  -- An event that cannot name the rows it came from cannot be disputed, and an
  -- undisputable event is exactly what §4's audit argument promises not to
  -- produce. Cheap to enforce; impossible to retrofit once history exists.
  constraint driving_events_has_evidence check (array_length(telemetry_ids, 1) >= 1),

  -- The invariant worth enforcing: `type` is namespaced by `category`, so a
  -- 'road.defect_observation' can never be filed under 'driver' and slip into
  -- the penalty sum. This is the check that protects §8's fairness claim from a
  -- typo, without freezing the detector catalogue into the schema.
  constraint driving_events_type_matches_category
    check (type like (category || '.%')),

  -- The fairness claim, in the schema. Integrity events never penalise anyone
  -- (§6.7), and a road-category event is by definition the road's fault, not
  -- the driver's — arbitration expresses "this one *was* the driver" by
  -- rewriting the type to `driver.avoidable_impact`, which moves the category
  -- too (§7.3). Both directions enforced rather than documented, because "we
  -- promise the code does this" is an assertion and a CHECK is evidence.
  constraint driving_events_non_driver_not_attributed
    check (category = 'driver' or attributed_to_driver = false)
);

create index if not exists driving_events_trip_idx on public.driving_events (trip_id);
create index if not exists driving_events_device_time_idx
  on public.driving_events (device_id, occurred_at desc);
-- Partial: the road map only ever queries road-category events by cell, and
-- those are a minority of the table. Keeping integrity spam out of this index
-- keeps arbitration lookups small.
create index if not exists driving_events_road_cell_idx
  on public.driving_events (h3_12) where category = 'road';
-- Scoring reads exactly this slice: attributed driver events in a time window.
create index if not exists driving_events_scoring_idx
  on public.driving_events (device_id, occurred_at)
  where attributed_to_driver = true;


-- =============================================================================
-- fleet road map
-- =============================================================================
--
-- §7.1: H3 resolution 12 (~9.4 m edge, ~307 m²) — pothole scale. Keyed by
-- (cell, heading_sector) because the two directions of a road are different
-- lanes with different defects; a pothole in the northbound lane should not
-- excuse an impact taken southbound.
--
-- Position error (NEO-6M CEP 2.5–5 m, plus up to 16.7 m of travel during the
-- 1 s window at 60 km/h) is absorbed by querying the k-ring of radius 1 — seven
-- cells — at read time, NOT by coarsening the resolution. A coarser cell would
-- smear two adjacent potholes into one and destroy exactly the localisation
-- that makes the maintenance output useful.

create table if not exists public.road_cells (
  h3_12          text not null,
  heading_sector smallint not null,

  centroid_lat float8,
  centroid_lon float8,

  pass_count   int not null default 0,
  device_count int not null default 0,
  -- Passes where vertical_peak breached the impact threshold. spike_count /
  -- pass_count is the `spike_rate` that arbitration (§7.3) turns into a verdict.
  spike_count  int not null default 0,

  -- Welford accumulators over *speed-normalised* vertical RMS (§7.2). Welford
  -- rather than sum/sum-of-squares because this is updated incrementally
  -- forever and the naive form loses precision catastrophically once the mean
  -- is large relative to the variance.
  rough_mean numeric,
  rough_m2   numeric,

  -- IRI proxy, 0..100.
  roughness_index numeric,
  defect_confidence numeric not null default 0,

  -- Fleet p85 speed over this cell, the empirical norm the relative speeding
  -- detector uses (§6.5). Self-referential by construction; unusable until the
  -- cell has ≥20 passes from ≥3 distinct devices.
  speed_p85_kmh numeric,

  last_pass_at timestamptz,
  updated_at   timestamptz not null default now(),

  primary key (h3_12, heading_sector),

  constraint road_cells_counts_nonneg   check (pass_count >= 0 and device_count >= 0 and spike_count >= 0),
  constraint road_cells_spikes_bounded  check (spike_count <= pass_count),
  constraint road_cells_sector_range    check (heading_sector between 0 and 7),
  constraint road_cells_roughness_range check (roughness_index is null or (roughness_index between 0 and 100)),
  constraint road_cells_confidence_range check (defect_confidence between 0 and 1)
);

-- The prediction path (§7.4) scans "cells in the top decile of roughness" and
-- the maintenance view sorts by it. Partial, because a cell with no roughness
-- estimate yet is never a query target.
create index if not exists road_cells_roughness_idx
  on public.road_cells (roughness_index desc) where roughness_index is not null;
create index if not exists road_cells_updated_idx on public.road_cells (updated_at desc);


create table if not exists public.road_defects (
  id uuid primary key default gen_random_uuid(),

  h3_12          text not null,
  heading_sector smallint not null,
  lat float8, lon float8,

  confidence numeric not null,
  severity   text not null,

  -- `distinct_devices >= 3` is the guard against the confound in §7.3: a driver
  -- who habitually hits the same pothole on their daily commute would, in a
  -- small fleet, be the majority of passes and excuse their own bad driving.
  -- One device must never be able to establish fleet consensus alone.
  distinct_devices int not null,
  spike_rate       numeric not null,

  first_seen timestamptz,
  last_seen  timestamptz,
  status     text not null default 'active',

  -- One defect per lane-cell. This is what makes the upsert path an
  -- `on conflict do update` rather than an ever-growing pile of observations.
  unique (h3_12, heading_sector),

  constraint road_defects_status_valid   check (status in ('active', 'repaired', 'disputed')),
  constraint road_defects_severity_valid check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  constraint road_defects_confidence_range check (confidence between 0 and 1),
  constraint road_defects_spike_rate_range check (spike_rate between 0 and 1),
  constraint road_defects_sector_range   check (heading_sector between 0 and 7),
  -- The §7.3 consensus floor, enforced in the schema so no code path can write
  -- a "defect" that one device invented.
  constraint road_defects_consensus_floor check (distinct_devices >= 3)
);

create index if not exists road_defects_cell_idx on public.road_defects (h3_12);
-- The hazard-lookup query: active defects above the warning confidence.
create index if not exists road_defects_active_idx
  on public.road_defects (h3_12, heading_sector)
  where status = 'active';


-- =============================================================================
-- predictions — and, crucially, their evaluation
-- =============================================================================
--
-- The `outcome` columns are what make this a predictor rather than a warning
-- light. Resolving each prediction to hit / miss / not_traversed once the
-- vehicle has actually passed (or not passed) the target cell yields a real
-- precision/recall figure over real drives (§7.4) — quantitative evidence the
-- proposal's performance-testing chapter otherwise has no way to produce.
--
-- `not_traversed` is a distinct outcome, not a miss. If the driver turned off
-- the road we never learned whether the hazard was there, and folding those
-- into the denominator would understate precision for a reason that has nothing
-- to do with the predictor.

create table if not exists public.predictions (
  id        uuid primary key default gen_random_uuid(),
  device_id text not null,
  trip_id   uuid references public.trips(id),

  issued_at timestamptz not null,
  type      text not null,

  target_defect_id uuid references public.road_defects(id),
  target_h3_12 text,
  distance_m   numeric,
  eta_s        numeric,
  confidence   numeric,

  outcome            text not null default 'pending',
  outcome_event_id   uuid references public.driving_events(id),
  outcome_checked_at timestamptz,

  constraint predictions_type_valid    check (type in ('road.hazard_ahead', 'road.rough_segment_ahead')),
  constraint predictions_outcome_valid check (outcome in ('hit', 'miss', 'not_traversed', 'pending')),
  constraint predictions_confidence_range check (confidence is null or (confidence between 0 and 1)),
  constraint predictions_distance_nonneg  check (distance_m is null or distance_m >= 0),
  constraint predictions_eta_nonneg       check (eta_s is null or eta_s >= 0),
  -- A resolved prediction must say when it was resolved, or the precision/recall
  -- report cannot be reproduced against a point in time.
  constraint predictions_resolved_has_timestamp
    check (outcome = 'pending' or outcome_checked_at is not null)
);

create index if not exists predictions_device_issued_idx
  on public.predictions (device_id, issued_at desc);
create index if not exists predictions_trip_idx on public.predictions (trip_id);
-- The evaluator's work queue.
create index if not exists predictions_pending_idx
  on public.predictions (issued_at) where outcome = 'pending';
-- §7.4 step 6: never re-issue the same (device, defect) within one trip.
create unique index if not exists predictions_trip_defect_uniq
  on public.predictions (trip_id, target_defect_id)
  where trip_id is not null and target_defect_id is not null;


-- =============================================================================
-- scoring
-- =============================================================================

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),

  subject_type text not null,
  -- Text rather than uuid because the subject may be a device, whose id is the
  -- firmware's string. The polymorphism is deliberate and shallow.
  subject_id   text not null,

  period_start timestamptz not null,
  period_end   timestamptz not null,

  score numeric not null,

  -- The denominators from §8. Stored, not recomputed, so a score can be
  -- reconciled by hand years later even if the trip rows are archived.
  exposure_km  numeric,
  exposure_min numeric,

  -- Every contributing event id and its individual penalty, plus the events
  -- that were *excluded* and why. Non-negotiable: the proposal's transparent
  -- accountability goal means a driver must be shown exactly where the points
  -- went, and "which events did not count against me, and on what grounds" is
  -- the half of that answer that builds trust.
  breakdown jsonb not null,

  rule_version text not null,

  -- One score per subject per period per ruleset. Re-running new thresholds
  -- adds a row alongside the old verdict instead of destroying it.
  unique (subject_type, subject_id, period_start, period_end, rule_version),

  constraint scores_subject_type_valid check (subject_type in ('driver', 'device', 'trip')),
  constraint scores_range              check (score between 0 and 100),
  constraint scores_period_ordered     check (period_end > period_start),
  constraint scores_exposure_nonneg    check (
    (exposure_km  is null or exposure_km  >= 0) and
    (exposure_min is null or exposure_min >= 0)
  )
);

create index if not exists scores_subject_period_idx
  on public.scores (subject_type, subject_id, period_start desc);


-- =============================================================================
-- engine bookkeeping
-- =============================================================================
--
-- One row per consumer, holding the sweeper's watermark. This is what makes an
-- engine restart a resumption rather than a gap: telemetry keeps landing in
-- Postgres while we are down, and the sweeper backfills from here on the way up.
--
-- The row is also the advisory-lock subject for the two-replica concern in §9 —
-- see `withAdvisoryLock` in src/db/client.ts. Only one instance sweeps; the
-- others still serve Realtime and HTTP.

create table if not exists public.engine_checkpoints (
  consumer   text primary key,
  watermark  timestamptz not null,
  last_id    bigint,
  updated_at timestamptz not null default now()
);

insert into public.engine_checkpoints (consumer, watermark, last_id)
values ('sweeper', now() - interval '1 hour', null)
on conflict (consumer) do nothing;


-- =============================================================================
-- telemetry_rollup_1m  (§3, routing change #3, second half)
-- =============================================================================
--
-- 60:1 reduction. The dashboard's "last 30 days" chart does not want 2.6 M rows
-- per device; it wants a minute-resolution line, and reading it from a rollup is
-- the difference between a chart that renders and a query that times out.
--
-- A regular table, not a MATERIALIZED VIEW, and the choice is not incidental:
--
--   * `refresh materialized view` recomputes the whole thing. Over a growing
--     telemetry table that cost rises without bound, for data that is append-only
--     and never changes once written. `refresh ... concurrently` avoids the lock
--     but needs a unique index and still does the full scan.
--   * A table can be filled incrementally — only the minutes since the last
--     watermark — which is O(new rows) forever.
--   * A table survives `telemetry` partition detach. A materialized view over a
--     partitioned parent would lose the archived months on its next refresh,
--     which defeats the point of keeping a long-range summary at all.
--
-- The materialized-view form is left below as the alternative, because it is the
-- right answer if you would rather have zero incremental-maintenance code and
-- can afford the refresh.

create table if not exists public.telemetry_rollup_1m (
  device_id text not null,
  -- date_trunc('minute', server_received_at). Arrival time, not GPS time,
  -- because this rollup exists to summarise *what the database received* — it
  -- must stay well-defined for rows that never got a fix.
  minute    timestamptz not null,

  rows_n        int not null,
  -- Rows expected in a minute is 60; the shortfall is the upload-loss signal.
  gps_fix_n     int not null default 0,
  calibrated_n  int not null default 0,

  speed_kmh_avg numeric,
  speed_kmh_max numeric,

  -- Raw counts, deliberately. This table is a summary of the stored signal, not
  -- of the engine's interpretation of it: converting to SI here would bake the
  -- assumed full-scale range into the archive, which is precisely the failure
  -- mode firmware ask #1 exists to prevent.
  vert_rms_avg   numeric,
  vert_peak_max  numeric,
  horiz_peak_max numeric,
  yaw_rate_max   numeric,
  mic_rms_avg    numeric,

  -- Centroid of the minute, for a cheap coarse track without touching telemetry.
  lat_avg float8,
  lon_avg float8,

  primary key (device_id, minute)
);

create index if not exists telemetry_rollup_1m_minute_idx
  on public.telemetry_rollup_1m (minute desc);

-- Incremental fill. Idempotent by construction: re-running over an overlapping
-- window recomputes the same aggregate and overwrites it, so it is safe to call
-- with a generous overlap after a crash — the same overlap-and-overwrite
-- discipline the sweeper uses on `server_received_at` in 001.
--
--   select public.refresh_telemetry_rollup_1m(now() - interval '10 minutes', now());
--
create or replace function public.refresh_telemetry_rollup_1m(
  p_from timestamptz,
  p_to   timestamptz
) returns int
language plpgsql
as $$
declare
  n int;
begin
  insert into public.telemetry_rollup_1m as r (
    device_id, minute, rows_n, gps_fix_n, calibrated_n,
    speed_kmh_avg, speed_kmh_max,
    vert_rms_avg, vert_peak_max, horiz_peak_max, yaw_rate_max, mic_rms_avg,
    lat_avg, lon_avg
  )
  select
    t.device_id,
    date_trunc('minute', t.server_received_at)                      as minute,
    count(*)                                                        as rows_n,
    count(*) filter (where (t.gps->>'fix')::bool)                   as gps_fix_n,
    count(*) filter (where t.calibration->>'state' = 'calibrated')  as calibrated_n,
    avg((t.gps->>'speed_kmh')::numeric)                             as speed_kmh_avg,
    max((t.gps->>'speed_kmh')::numeric)                             as speed_kmh_max,
    avg((t.accel_cal->>'vertical_rms')::numeric)                    as vert_rms_avg,
    max((t.accel_cal->>'vertical_peak')::numeric)                   as vert_peak_max,
    max((t.accel_cal->>'horizontal_peak')::numeric)                 as horiz_peak_max,
    max((t.gyro_cal->>'yaw_rate_peak')::numeric)                    as yaw_rate_max,
    avg((t.mic->>'rms')::numeric)                                   as mic_rms_avg,
    avg((t.gps->>'lat')::float8)                                    as lat_avg,
    avg((t.gps->>'lon')::float8)                                    as lon_avg
  from public.telemetry t
  where t.server_received_at >= p_from
    and t.server_received_at <  p_to
  group by t.device_id, date_trunc('minute', t.server_received_at)
  on conflict (device_id, minute) do update set
    rows_n         = excluded.rows_n,
    gps_fix_n      = excluded.gps_fix_n,
    calibrated_n   = excluded.calibrated_n,
    speed_kmh_avg  = excluded.speed_kmh_avg,
    speed_kmh_max  = excluded.speed_kmh_max,
    vert_rms_avg   = excluded.vert_rms_avg,
    vert_peak_max  = excluded.vert_peak_max,
    horiz_peak_max = excluded.horiz_peak_max,
    yaw_rate_max   = excluded.yaw_rate_max,
    mic_rms_avg    = excluded.mic_rms_avg,
    lat_avg        = excluded.lat_avg,
    lon_avg        = excluded.lon_avg;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- The rejected alternative, for the record:
--
--   create materialized view public.telemetry_rollup_1m_mv as
--     select device_id, date_trunc('minute', server_received_at) as minute,
--            count(*) as rows_n, avg((gps->>'speed_kmh')::numeric) as speed_kmh_avg
--     from public.telemetry group by 1, 2;
--   create unique index on public.telemetry_rollup_1m_mv (device_id, minute);
--   refresh materialized view concurrently public.telemetry_rollup_1m_mv;
--
-- Simpler to write, and it is the wrong shape: the refresh cost is proportional
-- to all history rather than to the new minutes, and it cannot outlive a
-- detached partition.


-- =============================================================================
-- Row Level Security
-- =============================================================================
--
-- The engine connects with `service_role`, which BYPASSES RLS entirely. Nothing
-- below constrains the engine; it exists solely to constrain the dashboard.
--
-- Therefore: every table gets RLS enabled and exactly one `select` policy for
-- `authenticated`. There is deliberately NO insert, update or delete policy on
-- any of these tables. The absence is the security control — with RLS enabled
-- and no permissive policy for an action, that action is denied for every role
-- that is subject to RLS, no matter what table grants exist. A client that
-- could write here could fabricate its own driving events and its own score,
-- which is the one thing this schema exists to prevent.
--
-- Note the contrast with `public.telemetry`, whose `anon` insert policy with
-- `check (true)` is the hole described in §3 and in 001's closing note. These
-- tables do not repeat that mistake.
--
-- Scope caveat, stated rather than hidden: `authenticated` here means *any*
-- signed-in user can read *every* driver's events and scores. That is right for
-- a fleet-operator dashboard and wrong for a driver-facing app. The v2 policy is
-- a join through `devices`/`drivers` to `auth.uid()`; it is not written now
-- because there is no user↔driver mapping in this schema yet, and a policy that
-- looks like tenancy but is not would be worse than an honest open one.

do $$
declare
  t text;
  has_authenticated bool := exists (select 1 from pg_roles where rolname = 'authenticated');
  has_anon          bool := exists (select 1 from pg_roles where rolname = 'anon');
begin
  -- The `authenticated` / `anon` roles are Supabase's, not Postgres's. A local
  -- dev database or a CI container will not have them, and a migration that
  -- hard-fails there would mean the schema can only be built against a live
  -- Supabase project — which is exactly the coupling the replay harness exists
  -- to avoid. RLS is still ENABLED unconditionally, so the deny-by-default
  -- posture holds everywhere; only the grants are conditional.
  foreach t in array array[
    'drivers', 'vehicles', 'devices', 'trips', 'driving_events',
    'road_cells', 'road_defects', 'predictions', 'scores',
    'engine_checkpoints', 'telemetry_rollup_1m'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    if has_authenticated then
      -- Idempotent: drop-then-create so re-applying the migration converges.
      execute format('drop policy if exists %I on public.%I', t || '_read_authenticated', t);
      execute format(
        'create policy %I on public.%I for select to authenticated using (true)',
        t || '_read_authenticated', t
      );

      -- Explicit grants. RLS filters rows; it does not grant the privilege in
      -- the first place. Both are required, and SELECT is all either gets.
      execute format('grant select on public.%I to authenticated', t);
      execute format('revoke insert, update, delete on public.%I from authenticated', t);
    end if;

    if has_anon then
      -- `anon` gets nothing at all here. Contrast public.telemetry, where the
      -- inherited `with check (true)` insert policy is the §3 hole.
      execute format('revoke all on public.%I from anon', t);
    end if;
  end loop;
end;
$$;

-- `engine_checkpoints` is arguably operator-only rather than dashboard data,
-- but exposing the sweeper watermark read-only is genuinely useful ("how far
-- behind is the engine?") and leaks nothing.
-- =============================================================================
-- RoadScore — 003_seed_dev.sql
-- Deterministic seed for development & bench testing
-- =============================================================================

-- Drivers ---------------------------------------------------------------------
insert into public.drivers (id, name, licence_ref)
values
  ('00000000-0000-4000-8000-000000000001', 'Gavesh Saparamadu', 'GS-LIC-0001'),
  ('00000000-0000-4000-8000-000000000002', 'Simulated Driver 02', 'SIM-LIC-0002'),
  ('00000000-0000-4000-8000-000000000003', 'Simulated Driver 03', 'SIM-LIC-0003')
on conflict (id) do update set name = excluded.name, licence_ref = excluded.licence_ref;

-- Vehicles --------------------------------------------------------------------
insert into public.vehicles (id, plate, make, model, year)
values
  ('00000000-0000-4000-8000-000000000101', 'WP-CAD-4902', 'Toyota', 'Prius', 2020),
  ('00000000-0000-4000-8000-000000000102', 'WP-CBG-1102', 'Honda', 'Vezel', 2021),
  ('00000000-0000-4000-8000-000000000103', 'CP-CAA-8841', 'Nissan', 'Leaf', 2022)
on conflict (id) do update set plate = excluded.plate, make = excluded.make, model = excluded.model, year = excluded.year;

-- Devices ---------------------------------------------------------------------
insert into public.devices (device_id, vehicle_id, driver_id, accel_fs_g, gyro_fs_dps, installed_at, active)
values
  ('ROADSCORE_001', '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 2, 250, '2026-01-01T00:00:00Z', true),
  ('DUMMY-001',    '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000002', 2, 250, '2026-01-01T00:00:00Z', true),
  ('DUMMY-002',    '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000003', 2, 250, '2026-01-01T00:00:00Z', true)
on conflict (device_id) do update set
  vehicle_id = excluded.vehicle_id,
  driver_id = excluded.driver_id,
  accel_fs_g = excluded.accel_fs_g,
  gyro_fs_dps = excluded.gyro_fs_dps,
  active = excluded.active;

-- Sweeper Checkpoint ----------------------------------------------------------
insert into public.engine_checkpoints (consumer, watermark, last_id)
values ('sweeper', now() - interval '1 hour', null)
on conflict (consumer) do nothing;
