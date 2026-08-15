# RoadScore (R1)

Edge telematics, crowd-sourced road quality intelligence, and transparent driver safety scoring.

RoadScore is an edge-to-cloud telematics and spatial analytics platform. It collects high-frequency inertial, GNSS, and acoustic telemetry from ESP32 edge units, processes kinematic event detection in Node.js/TypeScript, arbitrates road surface defects against driver misconduct via geospatial consensus, and computes transparent, mathematically verifiable safety scores in real time.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Edge ["1. Edge Hardware (ESP32)"]
        IMU["MPU-6050 (200 Hz IMU)"]
        GPS["NEO-6M GNSS (10 Hz GPS)"]
        MIC["Analog MEMS Mic (500 Hz)"]
        MCU["Firmware & Ring Buffer"]
        IMU & GPS & MIC --> MCU
    end

    subgraph Ingestion ["2. Transport & Ingestion"]
        HTTP["HTTPS / REST Ingest"]
        MCU -->|1 Hz Batch Payload| HTTP
    end

    subgraph Pipeline ["3. Detection & Arbitration Engine"]
        NORM["Normalizer & Integrity Gate"]
        DET_LONG["Longitudinal Detector"]
        DET_LAT["Lateral & Swerve Detector"]
        DET_SPD["Speed Compliance Detector"]
        DET_IMP["Impact Detector"]
        DET_DUTY["Duty & Idle Detector"]

        HTTP --> NORM
        NORM --> DET_LONG & DET_LAT & DET_SPD & DET_IMP & DET_DUTY

        ARB["Spatial Arbitration (H3 Res 12)"]
        SCORE["Section 8 Scoring Engine"]

        DET_IMP --> ARB
        DET_LONG & DET_LAT & DET_SPD & DET_DUTY --> SCORE
        ARB -->|Avoidable Impact Only| SCORE
    end

    subgraph Database ["4. Database (PostgreSQL / Supabase)"]
        DB_RAW["raw_telemetry"]
        DB_EVT["driving_events"]
        DB_DEF["road_defects"]
        DB_SCR["driver_scores"]

        NORM --> DB_RAW
        DET_LONG & DET_LAT & DET_SPD & DET_DUTY --> DB_EVT
        ARB --> DB_DEF
        SCORE --> DB_SCR
    end

    subgraph Frontend ["5. Web Dashboard (Next.js 16)"]
        UI_FLEET["Fleet Operations Map"]
        UI_DRIVERS["Driver Scorecards & Radar"]
        UI_TRIPS["Kinematic Trip Replay"]
        UI_DEFECTS["Road Defect Heatmap"]
        UI_HEALTH["Hardware Health Monitor"]

        Database --> Frontend
    end
```

---

## Monorepo Layout

| Directory | Stack | Responsibility |
| :--- | :--- | :--- |
| [`mcu/`](mcu) | C++ / PlatformIO / ESP32 | High-frequency sensor sampling, gravity baseline estimation, ring buffer storage, and TLS sync. |
| [`engine/`](engine) | Node.js 20+ / TypeScript / Vitest | Kinematic event detection, H3 spatial road mapping, defect arbitration, and scoring rollup. |
| [`web/`](web) | Next.js 16 / React 19 / Tailwind CSS | Fleet tracking, real-time driver scorecards, kinematic replay, and road quality visualizer. |
| [`db/`](db) | PostgreSQL / Supabase SQL | Relational schema, PostGIS/H3 geospatial indexes, RLS policies, and continuous scoring views. |

---

## 5-Factor Safety Pillars

Driving behavior is evaluated across five physically grounded dimensions (0–100 scale):

1. **Longitudinal Dynamics**: Evaluates longitudinal acceleration smoothness ($a_{\text{long}}$ decomposed from gravity baseline). Penalizes severe braking ($\le -3.0\text{ m/s}^2$) and abrupt acceleration ($\ge +2.5\text{ m/s}^2$). Suppresses false triggers during high-yaw turns.
2. **Cornering and Lateral Dynamics**: Evaluates centrifugal stability ($a_{\text{lat}} = v \cdot \omega$). Penalizes sharp turns ($\omega > 15^\circ/\text{s}$ at speed), excessive lateral load ($a_{\text{lat}} \ge 3.4\text{--}5.9\text{ m/s}^2$), and rapid slalom weaving ($\int |\omega|\,dt \ge 1.05\text{ rad}$).
3. **Speed Compliance**: Evaluates vehicle velocity against empirical 85th-percentile fleet baselines ($p_{85}$) within H3 spatial cells, accounting for local road surface conditions.
4. **Road Risk Adaptation**: Differentiates unavoidable road defects from negligent driving. Unmapped potholes are recorded as infrastructure observations without driver penalty. Traversing pre-mapped hazards at high speed without decelerating triggers `driver.avoidable_impact`.
5. **Eco and Operational Habits**: Evaluates operational duty cycle. Detects excessive stationary idling ($> 180\text{s}$ sustained with acoustic engine confirmation) and continuous driving fatigue ($> 2\text{ hours}$ without a mandatory rest break).

---

## Scoring Mathematics & Arbitration Rules

### Section 8 Fairness Guarantee
The engine enforces auditable attribution:
- Road defects (`road.pothole_impact`) and sensor anomalies (`integrity.*`) are excluded from driver penalties.
- Only events with `attributed_to_driver = true` reduce safety scores.
- Every score contains an auditable JSON breakdown detailing exact contributions, timestamps, physical magnitudes, and rule exclusions.

### Exposure Formula
Trip scores normalize penalties against distance driven:

$$\text{Score} = \text{clamp}\left(100 - \frac{100 \cdot \sum (\text{weight} \cdot \text{severity\_mult} \cdot \text{confidence})}{\text{exposure\_km} \cdot k}, 0, 100\right)$$

### Continuous 24-Hour Decay
Live driver scores incorporate a 12-hour exponential half-life:

$$\text{Penalty}(t) = \text{Base Penalty} \times e^{-\frac{\ln(2) \cdot \Delta t}{12\text{ hours}}}$$

---

## Quickstart

### Prerequisites
- Node.js 20 or higher
- npm 10 or higher
- PostgreSQL 15+ or Supabase instance
- PlatformIO CLI (optional, for ESP32 flashing)

---

### Development Startup

Run the development orchestrator from the repository root:

```bash
# Start Web UI (port 3000) and Engine Ingest (port 3001)
npm run dev
# or:
./dev.sh

# Start with Live Worst Driver Telemetry Streamer
npm run dev:worst

# Start with Clean Driver Penalties Streamer
npm run dev:penalties

# Start with Mixed Fleet Live Streamer
npm run dev:sim
```

---

### Database Initialization

Execute the SQL initialization script against your PostgreSQL / Supabase instance:

```sql
\i db/setup_all.sql
```

This creates schemas, spatial indexes, RLS policies, and continuous scoring views for `devices`, `trips`, `raw_telemetry`, `driving_events`, `road_defects`, and `driver_scores`.

---

### Engine Pipeline & Tests

```bash
cd engine
npm install
npm test              # Run 204 Vitest unit & integration tests
npm run typecheck     # Verify TypeScript types
```

---

### Web Dashboard

```bash
cd web
npm install
npm run dev           # Start Next.js development server on http://localhost:3000
npm run build         # Verify production build
```

---

### ESP32 Hardware Firmware

```bash
cd mcu
cp secrets.h.example secrets.h
# Edit WiFi credentials and ingestion API URL
./flash.sh /dev/ttyUSB0
```

---

## Simulation Presets

| Script | Preset | Description |
| :--- | :--- | :--- |
| `npm run sim:worst` | `worst-driver` | Severe braking ($-7.8\text{ m/s}^2$), hard acceleration ($+6.8\text{ m/s}^2$), high-speed cornering ($10.25\text{ m/s}^2$), and swerving. |
| `npm run sim:live:penalties` | `driver-penalties` | Isolated driver penalties on smooth pavement for threshold validation. |
| `npm run sim:live` | `mixed-fleet` | Mixed urban driving, road surface defects, and regular traffic maneuvers. |
| `npm run sim:scenarios` | `all` | Runs the full 11-scenario test battery sequentially against the detection pipeline. |

---

## Telemetry Payload Specification

1 Hz batch payload format sent by edge devices:

```json
{
  "device_id": "esp32-alpha-01",
  "firmware_version": "1.2.0",
  "seq": 1420,
  "timestamp": "2026-08-15T10:30:00.000Z",
  "lat": 6.524379,
  "lon": 3.379206,
  "speed_kmh": 64.5,
  "heading": 184.2,
  "flags": 15,
  "vertical_accel_mps2": 0.58,
  "horizontal_peak_mps2": 4.82,
  "magnitude_peak_mps2": 10.45,
  "yaw_rate_radps": 0.40,
  "pitch_rate_radps": 0.01,
  "roll_rate_radps": 0.02,
  "mic_rms": 184.5,
  "mic_peak": 360.0,
  "samples_count": 50,
  "wifi_rssi": -62
}
```

### Bitmask Flags
- `0x01` (`GPS_FIX`): Valid GNSS position lock.
- `0x02` (`GPS_USABLE`): HDOP $\le 3.5$, $\ge 4$ satellites.
- `0x04` (`ACCEL_VALID`): Accelerometer baseline and gravity vector calibrated.
- `0x08` (`GYRO_VALID`): Gyroscope zero-rate bias calibrated.
- `0x10` (`MIC_VALID`): Acoustic sensor operational.

---

## License

MIT License.
