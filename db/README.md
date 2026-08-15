# 🗄️ RoadScore Database Setup & Migrations

This directory contains the complete PostgreSQL / Supabase schema, index optimizations, security policies (RLS), and development seed data for **RoadScore**.

---

## 📁 Directory Structure

```text
db/
├── 001_telemetry.sql       # Ingestion schema, indexes, Realtime publication & RLS
├── 002_engine_schema.sql   # Core pipeline tables (trips, events, road cells, scores)
├── 003_seed_dev.sql        # Seed data (dev driver, vehicle, devices dev-esp32-* and ROADSCORE_*)
├── setup_all.sql           # Combined single-file script for quick 1-click execution
└── README.md               # This setup guide
```

---

## 🚀 Setup Options

### Option 1: Supabase Dashboard SQL Editor (Fastest)

1. Open your **Supabase Project Dashboard**.
2. Navigate to **SQL Editor** in the left sidebar.
3. Click **New Query**.
4. Copy the entire contents of [`db/setup_all.sql`](./setup_all.sql) and paste it into the query window.
5. Click **Run**.

---

### Option 2: Command Line via `psql` / Postgres Connection String

Execute the combined setup script directly against your database using psql:

```bash
psql "$DATABASE_URL" -f db/setup_all.sql
```

Or execute individual migration files in order:

```bash
psql "$DATABASE_URL" -f db/001_telemetry.sql
psql "$DATABASE_URL" -f db/002_engine_schema.sql
psql "$DATABASE_URL" -f db/003_seed_dev.sql
```

---

### Option 3: Automated Migration Runner (`engine`)

The Engine backend includes an automated migration runner with transactional execution, advisory locking, and checksum tracking:

```bash
cd engine
npm run migrate
```

To run against a custom database URL:
```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/postgres" npm run migrate
```

To check migration status without applying changes:
```bash
npm run migrate -- --status
```

---

## 📊 Summary of Created Tables

| Table | Description |
|---|---|
| `public.telemetry` | 1 Hz telemetry stream from ESP32 MCU hardware & emulators |
| `public.devices` | Registered device identities & hardware scale calibrations (`accel_fs_g`, `gyro_fs_dps`) |
| `public.drivers` | Driver profiles and licence references |
| `public.vehicles` | Vehicle profiles and specifications |
| `public.trips` | Trip sessions bounded by reboot / 5m stationary timeouts |
| `public.driving_events` | Detected harsh acceleration, braking, cornering, impact, and defect events |
| `public.road_cells` | Spatial H3 index cells storing aggregated surface metrics |
| `public.road_defects` | Fleet-validated consensus road defects (potholes, severe bumps) |
| `public.predictions` | ML/heuristic predictions and probability classifications |
| `public.scores` | Computed safety & road quality scores per trip / vehicle |
| `public.engine_checkpoints` | Sweeper and realtime consumer watermarks |
| `public.schema_migrations` | Migration ledger tracking applied SQL files and checksums |
