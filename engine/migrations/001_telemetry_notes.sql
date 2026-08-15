-- =============================================================================
-- 001_telemetry_notes.sql — routing changes to the EXISTING public.telemetry
-- =============================================================================
--
-- This file does NOT define `telemetry`. That table already exists, shipped in
-- `supabase.sql`, and the firmware POSTs into it directly via PostgREST. We
-- deliberately keep it that way (ENGINE-PLAN §3): telemetry must stay durable
-- when the engine is down, redeploying or crash-looping. The ESP32's post queue
-- is four entries deep and *drops* on overflow, so putting our own service in
-- the write path converts every engine hiccup into permanent, unrecoverable
-- data loss. The 50–150 ms of added latency is irrelevant for 1 Hz data.
--
-- What follows is only the set of changes the engine needs *around* that table.
-- Everything here is either applied immediately (the sweeper index) or left as
-- a commented, dated migration path with the reasoning attached, because the
-- reasoning is the deliverable.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The sweeper index  (§3, routing change #1) — APPLIED
-- -----------------------------------------------------------------------------
--
-- The backfill sweeper is not belt-and-braces. Supabase Realtime's
-- `postgres_changes` is best-effort: it drops messages on reconnect, on channel
-- error, and under load. Realtime buys us *latency*; the sweeper is what buys us
-- *completeness*. Its one query is a global scan ordered by arrival time:
--
--     select * from telemetry
--     where server_received_at > $watermark - interval '10 seconds'
--     order by server_received_at
--     limit 5000;
--
-- The existing `telemetry_device_time_idx` leads with `device_id`. A composite
-- btree can only be range-scanned on its leading column, so a predicate that
-- constrains `server_received_at` alone cannot use it — Postgres would have to
-- read every device's partition of the index (or, more likely, seq-scan the
-- heap and sort). At 86 400 rows per device per day that turns the sweep from a
-- bounded index range scan into a full table scan repeated every 5 seconds.
--
-- One index fixes it. It is also the index the retention/rollup jobs want, and
-- the one a future RANGE partition on `server_received_at` will want locally per
-- partition, so it is not wasted work later.

-- Precondition check, so a missing base table produces a sentence instead of
-- `relation "telemetry" does not exist` three files later. This migration
-- amends someone else's table; it does not own it.
do $$
begin
  if to_regclass('public.telemetry') is null then
    raise exception
      'public.telemetry does not exist. 001 amends the firmware''s existing table; apply supabase.sql (the device-facing schema) first.';
  end if;
end;
$$;

create index if not exists telemetry_recv_idx
  on public.telemetry (server_received_at);

-- Why the overlap window instead of a strict `>` cursor, recorded here because
-- it is a property of *this* column and belongs next to its index:
-- `server_received_at` defaults to `now()`, which in Postgres is transaction
-- START time, not commit time. Two concurrent inserts can therefore commit in
-- the opposite order to their timestamps. A naive `where server_received_at >
-- $watermark` cursor silently and permanently skips any row whose transaction
-- started before the watermark but committed after it. Re-scanning a 10 s
-- overlap and de-duplicating on `id` through a bounded LRU set closes that hole;
-- combined with the `driving_events.event_key` unique constraint in 002, a
-- replayed row is a no-op rather than a double-counted penalty.


-- -----------------------------------------------------------------------------
-- 2. `telemetry_gps_idx` is dead weight  (§3, routing change #4) — NOT APPLIED
-- -----------------------------------------------------------------------------
--
-- The existing index is, in effect:
--
--     create index telemetry_gps_idx on public.telemetry
--       (((gps->>'lat')::float8), ((gps->>'lon')::float8));
--
-- It cannot serve any query we actually want to run, and the reason is worth
-- spelling out because "we have a GPS index" reads as though spatial lookup is
-- solved when it is not.
--
-- A btree is a one-dimensional structure. It orders rows lexicographically:
-- first by lat, and only by lon *within a single exact lat value*. A bounding
-- box query —
--
--     where lat between 6.90 and 6.95 and lon between 79.85 and 79.90
--
-- — is a range on the leading column and a range on the second. Once the
-- leading column is a range rather than an equality, every distinct lat in
-- [6.90, 6.95] is a separate btree subtree, and the lon predicate can only be
-- applied as a filter *after* those entries have been read. Since lat is a
-- float8 derived from a 5-decimal GPS fix, "distinct lat values in the range"
-- is essentially "all of them". The planner reads the entire lat slice — a band
-- of the earth stretching around the whole globe — and discards ~everything on
-- the lon check. For a radius query it is worse still: distance is not
-- expressible as a prefix of a btree key at all.
--
-- So the index costs write amplification and disk on the hottest insert path in
-- the system and buys a scan that is only marginally better than sequential.
--
-- Two real fixes exist:
--   (a) PostGIS + a GiST index on `geography(Point)`. Correct, and the right
--       answer if the dashboard ever wants arbitrary polygon queries. Costs an
--       extension, a generated column, and a rebuild.
--   (b) Do the spatial work in the engine on H3 cell ids and index *those*, on
--       `road_cells` / `driving_events` / `road_defects`. An H3 id is a plain
--       text equality key; a k-ring neighbourhood is 7 equality lookups, which
--       a btree serves perfectly. No extension, no dependency, and it matches
--       how §7 already reasons about space.
--
-- This plan takes (b). `telemetry` therefore has no spatial query against it at
-- all, which makes the index pure cost. Left commented rather than executed
-- because dropping an index on a live table is a decision for a maintenance
-- window with the current query stats in front of you, not something a
-- first-run migration should do behind your back.
--
--   drop index if exists public.telemetry_gps_idx;


-- -----------------------------------------------------------------------------
-- 3. Monthly partitioning  (§3, routing change #3) — NOT APPLIED, TIME-CRITICAL
-- -----------------------------------------------------------------------------
--
-- >>> READ THIS BEFORE THE FLEET GROWS. <<<
--
-- At 1 Hz a single device writes 86 400 rows/day ≈ 2.6 M rows/month, and with
-- the jsonb blocks that is roughly 1.3 GB per device per month. Ten devices for
-- a semester is ~150 GB. The dashboard's long-range charts and the retention
-- policy both want to operate on whole months at a time.
--
-- Postgres cannot convert an existing table into a partitioned one in place.
-- `ALTER TABLE ... PARTITION BY` does not exist. The migration is always:
-- create a new partitioned parent, copy, swap names, re-point FKs, re-add the
-- table to the `supabase_realtime` publication. While the table is small that
-- is a few seconds of downtime. At 50 GB it is an hours-long copy holding locks,
-- against a table the firmware is actively inserting into with a 4-deep,
-- drop-on-overflow queue — i.e. the outage becomes data loss. The cost of this
-- migration grows monotonically with the data. Do it early or accept never
-- doing it.
--
-- Sketch of the swap, to be run in one transaction during a maintenance window:
--
--   begin;
--
--   create table public.telemetry_part (like public.telemetry including all)
--     partition by range (server_received_at);
--
--   -- One partition per month. In production these are created a month ahead
--   -- by a scheduled job (pg_cron) so an insert never lands with no partition.
--   create table public.telemetry_2026_08 partition of public.telemetry_part
--     for values from ('2026-08-01') to ('2026-09-01');
--   create table public.telemetry_2026_09 partition of public.telemetry_part
--     for values from ('2026-09-01') to ('2026-10-01');
--
--   -- A DEFAULT partition is a safety net, not a plan: rows that land in it
--   -- block the later ATTACH of the month they belong to, so drain it promptly.
--   create table public.telemetry_default partition of public.telemetry_part default;
--
--   insert into public.telemetry_part select * from public.telemetry;
--
--   alter table public.telemetry      rename to telemetry_legacy;
--   alter table public.telemetry_part rename to telemetry;
--
--   -- Realtime tracks the table by identity, so the publication must be redone.
--   alter publication supabase_realtime add table public.telemetry;
--
--   commit;
--
-- Retention, once partitioned, becomes metadata-only — the whole point:
--
--   alter table public.telemetry detach partition public.telemetry_2026_05;
--   -- then archive to object storage and `drop table`, or leave detached.
--
-- Compare with the unpartitioned equivalent, `delete from telemetry where
-- server_received_at < now() - interval '90 days'`, which writes a dead tuple
-- for every row, bloats the heap, and needs a VACUUM FULL (an ACCESS EXCLUSIVE
-- lock and a full rewrite) to actually return the disk. DETACH is instant.
--
-- Note also that partitioning strengthens §3's argument for `telemetry_recv_idx`
-- rather than replacing it: partition pruning removes whole months, but the
-- sweeper's `order by server_received_at limit 5000` still needs a local index
-- inside the current month's partition to avoid sorting it.


-- -----------------------------------------------------------------------------
-- 4. Note on the RLS hole  (§3, routing change #5)
-- -----------------------------------------------------------------------------
--
-- `telemetry`'s existing policy grants `anon` insert `with check (true)`.
-- Anyone holding the public anon key — which ships in every dashboard bundle —
-- can inject arbitrary rows. Because the road map is fleet-consensus (§7.3),
-- poisoned rows do not merely corrupt one device's history: they shift the
-- spike_rate on a shared cell and therefore change the driver-vs-road verdict
-- for *every* driver who crosses it. That is a scoring-integrity bug, not just
-- a data-quality one.
--
-- The real fix is a per-device signed token (device-scoped JWT, `with check
-- (device_id = auth.jwt()->>'device_id')`), which requires a firmware change to
-- carry the token and is therefore out of scope for this migration.
--
-- The engine-side mitigation is live now, in `normalize`'s plausibility gate:
-- reject `speed_kmh > 250`, lat/lon outside the operating bounding box,
-- `samples > 60`, and any `device_id` not present in `devices`. See
-- THRESHOLDS.plausibility. This does not stop the rows being *stored*; it stops
-- them reaching the road map, which is where the damage would be.
