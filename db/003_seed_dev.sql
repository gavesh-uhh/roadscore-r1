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
