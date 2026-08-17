# RoadScore Simulator (`roadscore-sim`)

A standalone, keyboard-friendly multi-driver telemetry simulator and Terminal UI (TUI) for **RoadScore**.

---

## Key Features

1. **Real OpenStreetMap Road Geometry via OSRM**:
   - Queries real OSM driving geometries via OSRM (`/route/v1/driving/...`).
   - High-fidelity offline route cache for major Sri Lankan inter-city corridors (Colombo, Kandy, Galle, Negombo, Matara, Kurunegala, Battaramulla, etc.).
   - Exact distance-based linear interpolation along road segments, realistic heading/bearing transitions, and zero straight-line shortcuts.

2. **Multi-Driver Concurrent Simulation**:
   - Simulates 1, 5, 10+ drivers operating simultaneously without code changes.
   - Individual driver speed profiles: `normal`, `aggressive`, `cautious`, `worst`, `erratic`.
   - Independent driver controls (pause/resume single driver, inject event to specific driver).

3. **Physics & Sensor Telemetry Generation**:
   - MPU-6050 16-bit counts conversion matching MCU hardware firmware (`accel_fs_g: 2`, `gyro_fs_dps: 250`).
   - Dynamic centripetal lateral acceleration, longitudinal braking/acceleration forces, and angular yaw rate calculated directly from vehicle dynamics and road curvature.
   - Road surface vibrations and microphone RMS/peak acoustic modeling.
   - Spatial indexing: calculates real-time **H3 resolution 12** cells (`latLngToCell(lat, lon, 12)`).
   - Provenance tagging: `source: 'simulator'`, `fw_version: '1.0.0-sim'`.

4. **Live Ingestion into RoadScore Backend**:
   - Direct asynchronous ingestion to Supabase `public.telemetry` REST endpoint.
   - Non-blocking batch queue with automatic connection detection (`OK`, `SENDING`, `OFFLINE`).

5. **Interactive Keyboard TUI (Designed for Live Presentations & Demos)**:
   - Header with status badges (`STATUS: RUNNING`, `ROUTING: OK`, `SUPABASE: OK`, `SIM SPEED: 1x`).
   - Active fleet dashboard with progress bars, routes, live speeds, and H3 cells.
   - Interactive modals:
     - **Add Driver Wizard**: Location preset picker & live routing.
     - **Driver Detail View**: Live telemetry gauges, acceleration, vibration, heading, H3 cell.
     - **Event Trigger Popup**: Inject rough road, harsh braking, harsh acceleration, pothole impact, swerve, or clear event.
     - **Scenario Picker**: 5 instant preset scenarios.
     - **Telemetry Monitor**: Live stream matrix & event stream.
     - **Route Management**: Inspect pre-baked and cached OSM routes.
     - **Log Viewer**: Scrollable system logs with clear option.

---

## Quick Start

### Run Interactive TUI
```bash
npm run sim
# or
npm run sim:tui
```

### Run with Specific Scenario
```bash
npm run sim -- --scenario normal_fleet
npm run sim -- --scenario rough_road_discovery
npm run sim -- --scenario multiple_drivers
npm run sim -- --scenario hard_braking_event
npm run sim -- --scenario roadscore_coverage
```

### Headless Mode (For CI / Automated Load Testing)
```bash
npm run sim -- --headless --scenario multiple_drivers
```

---

## Keyboard Controls

| Key | Action |
| --- | --- |
| `SPACE` | Pause / Resume entire simulation |
| `A` | Open **Add Driver** wizard |
| `D` or `ENTER` | Open **Driver Detail** view |
| `R` | Open **Route Management** view |
| `S` | Open **Scenario Selector** modal |
| `P` | Pause / Resume selected driver |
| `E` | Open **Trigger Event** modal on selected driver |
| `T` | Open **Live Telemetry Monitor** |
| `L` | Open **Log Viewer** |
| `C` | Clear event logs |
| `+` / `-` | Increase / Decrease simulation speed (1x, 2x, 5x, 10x) |
| `↑` / `↓` | Navigate list items or scroll logs |
| `ESC` | Return to Dashboard / Close modal |
| `Q` or `Ctrl+C` | Gracefully quit simulator |

---

## Predefined Scenarios

1. **Normal Fleet**: 3 concurrent vehicles commuting on major Sri Lankan arterial corridors (Colombo, Kandy, Galle).
2. **Rough Road Discovery**: Traverses rough road sectors and pothole corridors, emitting high vibration and IMU spikes.
3. **Multiple Drivers (10 Vehicles)**: 10 concurrent independent vehicles across national inter-city expressways.
4. **Hard Braking & Aggressive Drive**: Heavy traffic simulation with sudden brake slams, rapid accelerations, and sharp cornering.
5. **RoadScore Coverage Demo**: Dispersed regional fleet maximizing H3 resolution-12 grid indexing coverage across Sri Lanka.
