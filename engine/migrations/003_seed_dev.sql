-- =============================================================================
-- 003_seed_dev.sql — minimal deterministic development fleet
-- =============================================================================
--
-- Fixed UUIDs, not `gen_random_uuid()`. Tests assert against these ids, the
-- replay harness's golden files embed them, and a seed that produced different
-- ids on every run would make every snapshot diff unreadable. The literals below
-- are deliberately human-scannable so a failing test's output is legible.
--
-- Three devices, and that number is not arbitrary: §7.3 refuses to declare a
-- road defect below `distinct_devices >= 3`, precisely so that one driver who
-- habitually hits the same pothole cannot establish fleet consensus alone and
-- excuse their own impacts. Two devices would leave that arbitration branch
-- permanently unreachable in development, which means the project's central
-- contribution would be untestable locally. Three is the smallest fleet that
-- can demonstrate ROAD DEFECT, DRIVER EVENT and UNDECIDED on the same code path.
--
-- Every statement is `on conflict do nothing`, so this file is safe to re-run
-- and safe to leave in the migration sequence against a database that already
-- has real data. It never updates an existing row — a developer who has
-- retuned `accel_fs_g` on a bench device keeps their change.
--
-- This is a DEV seed. It is numbered into the normal sequence for convenience;
-- if you would rather it never touched staging, skip it by name in the runner.
-- =============================================================================

-- one driver ------------------------------------------------------------------
insert into public.drivers (id, name, licence_ref)
values ('00000000-0000-4000-8000-000000000001', 'Dev Driver One', 'DEV-LIC-0001')
on conflict (id) do nothing;

-- one vehicle -----------------------------------------------------------------
insert into public.vehicles (id, plate, make, model, year)
values ('00000000-0000-4000-8000-000000000101', 'DEV-0001', 'Toyota', 'Corolla', 2016)
on conflict (id) do nothing;

-- three devices ---------------------------------------------------------------
--
-- All three point at the same vehicle and driver. That is physically odd and
-- procedurally correct for a bench setup: the arbitration path keys on
-- `device_id` alone (§7.3 counts *distinct devices* that passed a cell, not
-- distinct vehicles), so this is the cheapest configuration that exercises the
-- consensus branch. Note the trap it also documents — three units bolted into
-- one car are not three independent observations of a road surface, and using a
-- fleet like that for real calibration would manufacture consensus out of one
-- suspension. For the demo drive in §13, put them in three different cars.
--
-- `accel_fs_g` / `gyro_fs_dps` are left at the ±2 g / ±250 dps defaults because
-- that is what the firmware actually configures today (§2.1). When firmware ask
-- #2 lands on one unit, change it here first and confirm the engine's SI output
-- is unchanged — that is the regression test for the whole conversion layer.
insert into public.devices (device_id, vehicle_id, driver_id, accel_fs_g, gyro_fs_dps, installed_at, active)
values
  ('dev-esp32-001', '00000000-0000-4000-8000-000000000101',
                    '00000000-0000-4000-8000-000000000001', 2, 250, '2026-01-01T00:00:00Z', true),
  ('dev-esp32-002', '00000000-0000-4000-8000-000000000101',
                    '00000000-0000-4000-8000-000000000001', 2, 250, '2026-01-01T00:00:00Z', true),
  ('dev-esp32-003', '00000000-0000-4000-8000-000000000101',
                    '00000000-0000-4000-8000-000000000001', 2, 250, '2026-01-01T00:00:00Z', true)
on conflict (device_id) do nothing;

-- sweeper checkpoint ----------------------------------------------------------
--
-- 002 already inserts this row; repeated here so that a developer who truncated
-- their tables gets a working sweeper back without re-running 002. Backdated an
-- hour so a fresh local database immediately backfills whatever telemetry is
-- already sitting there rather than only seeing rows that arrive from now on.
insert into public.engine_checkpoints (consumer, watermark, last_id)
values ('sweeper', now() - interval '1 hour', null)
on conflict (consumer) do nothing;
