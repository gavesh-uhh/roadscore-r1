# 🚗 RoadScore Dashboard — Exhaustive Implementation Specification

A comprehensive, multi-view enterprise dashboard for Fleet Operations, Safety Officers, Civil Infrastructure Engineers, and Drivers. Built with **Next.js 14 (App Router)**, **Supabase Auth & Realtime**, and **OpenStreetMap (Leaflet / Deck.gl)**.

---

## 📐 1. Full Navigation Hierarchy & Sitemap

```
├── 🔒 Auth & Onboarding (/login, /auth/callback)
├── 📊 1. Operations Command Center (/)
│    ├── Tab 1: Live Fleet Map & Incident Radar
│    └── Tab 2: Real-time Telemetry Stream Ticker
├── 🏎️ 2. Drivers & Safety Leaderboard (/drivers)
│    ├── Tab 1: Fleet Driver Leaderboard & Rankings
│    └── Tab 2: Driver Profile & Scorecard (/drivers/[id])
│         ├── Sub-Tab A: Safety Score Breakdown & Radar
│         ├── Sub-Tab B: Penalty History & Exposure
│         └── Sub-Tab C: Attributed Driving Events
├── 🎬 3. Trips Explorer & 4D Replay (/trips)
│    ├── Tab 1: Filterable Trips Directory
│    └── Tab 2: Interactive 4D Trip Replay (/trips/[id])
│         ├── Route Map Scrubber (OpenStreetMap)
│         ├── Synchronized Multi-Channel Oscilloscope
│         └── Event Evidence Inspector Drawer
├── 🛣️ 4. Road Quality & Defect Radar (/road-network)
│    ├── Tab 1: H3 Spatial Surface Roughness Map (Res 12)
│    ├── Tab 2: Confirmed Road Defects Inventory
│    └── Tab 3: Hazard Predictions & Traversal Verification Matrix
├── ⚡ 5. Hardware Diagnostics & Oscilloscope (/hardware)
│    ├── Tab 1: Device Fleet Registry & Status Grid
│    ├── Tab 2: Live 1 Hz Telemetry Scope (Raw vs Calibrated IMU)
│    └── Tab 3: Hardware Anomaly Log (Mount Shifts, Drops, Reboots)
└── ⚙️ 6. System Settings & Governance (/settings)
     ├── Tab 1: User Roles & Supabase RLS Rules
     └── Tab 2: Engine Thresholds & Rule Versioning
```

---

## 🎨 2. Exhaustive Specification of Every View & Tab

### VIEW 1: Operations Command Center (`/`)
> **Purpose**: High-level live situational awareness for fleet dispatchers and operations managers.

#### Key UI Layout & Panels:
1. **Top KPI Metrics Bar**:
   - **Active Fleet**: Active devices online vs total registered (e.g., `3 / 6 online`).
   - **Total Distance Today**: Sum of $km$ driven in last 24h across all closed/open trips.
   - **Fleet Average RoadScore**: Live weighted average score across active drivers (e.g., `88.4 / 100`).
   - **Critical Incidents**: Counter of critical events today (`collision_suspected`, `severe_impact`).
2. **Main Panel — Live Fleet Map (OpenStreetMap)**:
   - **OpenStreetMap Raster Tile Layer** with custom dark theme styling.
   - **Live Vehicle Markers**: Real-time position pins mapped from `public.telemetry` via Supabase Realtime channel `postgres_changes`.
   - **Heading Indicator**: Vehicle pins rotated by GPS heading ($0^\circ - 360^\circ$).
   - **Speed-Coded Trailing Polyline**: Last 5 minutes of driving trailing behind each active vehicle, color-coded by speed ($0-30\,\text{km/h}$ green, $30-70\,\text{km/h}$ blue, $>70\,\text{km/h}$ orange/red).
3. **Right Sidebar Panel — Real-Time Incident Ticker**:
   - Live streaming list of detected events as they occur.
   - Badge styling for severity (`info`, `low`, `medium`, `high`, `critical`).
   - Click event card -> Center map on event coordinates and open evidence drawer.

---

### VIEW 2: Drivers & Safety Scorecard (`/drivers` & `/drivers/[id]`)
> **Purpose**: Safety performance management, risk profiling, and driver coaching.

#### Tab 1: Fleet Driver Leaderboard (`/drivers`)
- **Filter Bar**: Date range picker (Today, 7 Days, 30 Days, Custom), Vehicle filter, Search by name/ID.
- **Sortable Driver Table**:
  - Driver Name & Avatar
  - Assigned Vehicle & Device ID
  - **RoadScore (0–100 Badge)**: Color-coded badge (🟢 $85-100$, 🟡 $70-84$, 🔴 $<70$).
  - **Total Distance ($km$)** & **Total Driving Time ($hours$)**.
  - **Event Frequency**: Penalty events per $100\,\text{km}$ driven.
  - Action: "View Full Scorecard" button.

#### Tab 2: Individual Driver Profile & Scorecard (`/drivers/[id]`)
- **Sub-Tab A: Safety Score Breakdown & Radar**:
  - **Overall Gauge**: Large circular gauge showing overall RoadScore ($0–100$).
  - **5-Factor Radar Chart**:
    1. **Longitudinal Smoothness** (Harsh braking / accel penalties)
    2. **Cornering Stability** (Sharp turns & swerving penalties)
    3. **Speed Compliance** (Speeding over P85 segment norms)
    4. **Road Risk Adaptation** (Driving slow over rough roads)
    5. **Driver Fatigue & Eco** (Continuous driving $>2h$, excessive idling)
- **Sub-Tab B: Penalty & Exposure Table**:
  - Itemized breakdown of deductions per event type.
  - Exposure normalization metric: $\text{Deduction} = \frac{\text{Event Weight} \times \text{Severity Multiplier}}{\text{Exposure Distance } (100\,\text{km}) \times k}$.
- **Sub-Tab C: Attributed Driving Events Stream**:
  - Filterable feed of events attributed to this driver.
  - Showing event timestamp, location, magnitude ($\text{m/s}^2$ or $\text{deg/s}$), and attribution confidence score ($0.0 - 1.0$).

---

### VIEW 3: Trips Explorer & 4D Replay (`/trips` & `/trips/[id]`)
> **Purpose**: In-depth post-trip audit, route visualization, and incident evidence inspection.

#### Tab 1: Trips Directory (`/trips`)
- **Trips Table**:
  - Trip ID (deterministic hash)
  - Driver & Vehicle Name
  - Start Time & End Time
  - Distance ($m / km$) & Duration ($\text{min}$)
  - Max Speed & Avg Speed ($\text{km/h}$)
  - GPS Coverage Percentage
  - Trip Status (`open`, `closed`, `abandoned`)
  - Action: "Replay Trip" button.

#### Tab 2: Interactive 4D Trip Replay View (`/trips/[id]`)
- **Split Screen Layout**: Top Map + Bottom Timeline & Charts + Right Drawer.
- **Top Panel — OpenStreetMap Route Replay**:
  - Complete GPS path polyline.
  - Animated vehicle marker following the route during playback.
  - Pinned event icons on map at exact event coordinates (`harsh_brake`, `pothole_impact`, `swerve`, `collision_crash`).
- **Bottom Panel — Synchronized Playback Control Bar**:
  - **Scrubber Controls**: Play, Pause, Step Forward/Backward, Speed Selector ($1\times, 2\times, 5\times, 10\times$).
  - **Scrub Bar Slider**: Dragging slider moves vehicle marker on map and syncs chart cursors.
  - **Multi-Channel Oscilloscope Charts**:
    - **Chart 1 — Speed Profile**: Speed ($\text{km/h}$) over time with segment P85 speed limit baseline.
    - **Chart 2 — 3-Axis Accel RMS ($g$)**: Vertical vs Horizontal peak acceleration.
    - **Chart 3 — Gyro Yaw Rate ($\text{deg/s}$)**: Rotational cornering energy.
    - **Chart 4 — Microphone Peak (dB / counts)**: Acoustic impact spikes.
- **Right Slide-over Drawer — Event Evidence Inspector**:
  - Opens when clicking an event marker on map or timeline.
  - **50 Hz Inner-Window IMU Waveform**: Plot showing raw 50 Hz accelerometer/gyroscope samples inside the 1-second telemetry window.
  - **Arbitration Verdict**:
    - Verdict: `Driver Event` vs `Road Defect`.
    - Attribution Confidence Score (e.g., $94\%$).
    - Evidence JSON Payload Viewer with copy button.

---

### VIEW 4: Road Quality & Defect Radar (`/road-network`)
> **Purpose**: Infrastructure monitoring, pothole detection, and predictive hazard warnings for civil works & navigation.

#### Tab 1: H3 Spatial Surface Roughness Heatmap (`/road-network`)
- **Uber H3 Hexagonal Grid (Res 12, ~9.4m edge)** overlaid on OpenStreetMap.
- **Color Metric — Roughness Index ($0 - 100$)**:
  - 🟢 **Smooth Road** ($0 - 25$): $g_{\text{rms}} < 1.2\,\text{m/s}^2$.
  - 🟡 **Moderate Surface Wear** ($26 - 55$): $1.2 \le g_{\text{rms}} < 2.5\,\text{m/s}^2$.
  - 🟠 **Rough Road / Pothole Zone** ($56 - 80$): $2.5 \le g_{\text{rms}} < 4.0\,\text{m/s}^2$.
  - 🔴 **Severe Degradation** ($81 - 100$): $g_{\text{rms}} \ge 4.0\,\text{m/s}^2$.
- **Interactive Hexagon Inspector Modal**:
  - Click any H3 cell on map -> Displays cell statistics:
    - H3 Cell Index (e.g., `8c601460395a3ff`)
    - Pass Count (Total vehicle passes) & Distinct Devices Count
    - Roughness Index & Normalized $g_{\text{rms}}$
    - Spike Count & Defect Confidence Percentage
    - Segment 85th Percentile Speed ($\text{P85 km/h}$)

#### Tab 2: Confirmed Road Defects Inventory (`/road-network/defects`)
- **Active Defects Table**:
  - Defect ID & Location Coordinates (`lat`, `lon`)
  - Severity (`minor`, `moderate`, `severe`, `critical`)
  - Multi-pass Confidence Score ($0.0 - 1.0$)
  - Distinct Devices Count (Must be $\ge 3$ for fleet confirmation)
  - Spike Rate ($\text{spikes / pass}$)
  - First Seen & Last Seen Timestamps
  - Status (`active`, `repaired`, `false_positive`)

#### Tab 3: Hazard Predictions & Traversal Verification Matrix (`/road-network/predictions`)
- **Clear, Human-Readable Hazard Predictions**:
  - Visualizes real-time forward-looking raycast predictions issued by the engine.
  - **Forward Prediction Cone Map Overlay**: Visualizes the $15\,\text{second}$ trajectory cone ($50m - 400m$ horizon) extending ahead of active vehicles.
- **Prediction Outcome Verification Matrix**:
  - Displays prediction performance and validation status:
    - 🎯 **Matched / Traversed**: Vehicle passed target cell and confirmed defect or hazard.
    - 🔄 **Avoided / Swerved**: Driver received warning prediction and successfully swerved around defect.
    - ❌ **False Positive**: Prediction issued but no physical hazard encountered on traversal.
    - ⏱️ **Timed Out / Miss**: Vehicle turned off route before reaching target cell.
  - **Accuracy Metrics**: Precision, Recall, and Traversal Verification Rate.

---

### VIEW 5: Real-Time MCU Hardware Oscilloscope (`/hardware`)
> **Purpose**: Microcontroller health monitoring, sensor calibration, and firmware diagnostics.

#### Tab 1: Device Fleet Registry (`/hardware`)
- **Grid of Registered Hardware Devices**:
  - Device ID (`dev-esp32-001`, `ROADSCORE_001`, etc.)
  - Assigned Vehicle & Driver
  - Active Status Indicator (Green online dot / Grey offline)
  - Full Scale Ranges: Accelerometer ($\pm 2g, \pm 4g, \pm 8g, \pm 16g$), Gyroscope ($\pm 250, \pm 500, \pm 1000, \pm 2000\,\text{dps}$)
  - Firmware Version (e.g., `1.0.0-mcu`)

#### Tab 2: Live 1 Hz Telemetry Oscilloscope (`/hardware/scope`)
- **Real-Time Streaming Charts** (subscribing to 1 Hz telemetry feed):
  - **Raw vs Calibrated Accelerometer ($g$)**: $a_x, a_y, a_z$ traces.
  - **Gyroscope Angular Rates ($\text{deg/s}$)**: Yaw rate, pitch rate, roll rate.
  - **Calibration Gravity Angle**: Gravity reference vector orientation ($^\circ$).
  - **WiFi RSSI & Packet Dropped Counter**: Network signal strength ($\text{dBm}$) & MCU queue drops.

#### Tab 3: Hardware Anomaly Log (`/hardware/anomalies`)
- **Log Stream of Hardware Integrity Events**:
  - `mount_shifted`: Mount displaced $> 15^\circ$ while driving.
  - `sensor_stuck`: MPU6050 frozen counts.
  - `low_sample_rate`: Sampling rate $< 40\,\text{Hz}$.
  - `power_reboot`: Device watchdog reboot or power cycle.

---

### VIEW 6: System Settings & Governance (`/settings`)
> **Purpose**: RLS security rules, user management, and engine threshold versioning.

#### Tab 1: User Roles & RLS Permissions
- Manage user roles: Fleet Manager, Safety Officer, Civil Engineer, Driver.
- Configure Supabase Row-Level Security policies.

#### Tab 2: Engine Rule Versioning (`RULE_VERSION`)
- View active engine thresholds version (e.g., `2026.08.09-r1`).
- Side-by-side threshold viewer (Longitudinal, Lateral, Impact, Speeding, Arbitration).

---

## 🗄️ 3. Directory Structure for `web/` App

```
web/
├── package.json
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.ts
├── public/
│   └── favicon.ico
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                           // View 1: Operations Command Center
    │   ├── login/
    │   │   └── page.tsx                       // Auth Login
    │   ├── auth/
    │   │   └── callback/route.ts              // Supabase Auth Callback
    │   ├── drivers/
    │   │   ├── page.tsx                       // View 2: Driver Leaderboard
    │   │   └── [id]/page.tsx                  // View 2: Driver Profile & Scorecard
    │   ├── trips/
    │   │   ├── page.tsx                       // View 3: Trips Directory
    │   │   └── [id]/page.tsx                  // View 3: 4D Trip Replay View
    │   ├── road-network/
    │   │   ├── page.tsx                       // View 4: H3 Surface Quality Heatmap
    │   │   ├── defects/page.tsx               // View 4: Confirmed Defects Inventory
    │   │   └── predictions/page.tsx           // View 4: Predictions & Traversal Matrix
    │   ├── hardware/
    │   │   ├── page.tsx                       // View 5: Device Registry Grid
    │   │   ├── scope/page.tsx                 // View 5: Live 1 Hz Telemetry Scope
    │   │   └── anomalies/page.tsx             // View 5: Hardware Anomaly Log
    │   └── settings/
    │       └── page.tsx                       // View 6: Settings & Rule Versioning
    ├── components/
    │   ├── common/
    │   │   ├── Navbar.tsx
    │   │   ├── Sidebar.tsx
    │   │   └── KpiCard.tsx
    │   ├── map/
    │   │   ├── OSMMap.tsx                     // Leaflet OpenStreetMap wrapper
    │   │   ├── LiveFleetLayer.tsx             // Realtime vehicle markers
    │   │   ├── TripRouteLayer.tsx             // Replay polyline & event pins
    │   │   ├── H3HexagonLayer.tsx             // Deck.gl / Leaflet H3 polygon renderer
    │   │   └── PredictionConeLayer.tsx        // Prediction raycast cone
    │   ├── replay/
    │   │   ├── PlaybackControls.tsx           // Scrubber controls (Play/Pause, speed)
    │   │   ├── MultiOscilloscope.tsx          // Speed, Accel, Gyro, Mic charts
    │   │   └── EvidenceDrawer.tsx             // 50 Hz inner-window IMU evidence
    │   ├── drivers/
    │   │   ├── ScoreGauge.tsx                 // Circular RoadScore gauge
    │   │   └── SafetyRadarChart.tsx           // 5-factor radar chart
    │   └── hardware/
    │       └── RealtimeScope.tsx              // Live IMU stream scope
    ├── lib/
    │   ├── supabase/
    │   │   ├── client.ts                      // Browser Supabase client
    │   │   ├── server.ts                      // SSR Server Supabase client
    │   │   └── middleware.ts                  // Auth session refresh middleware
    │   ├── h3.ts                              // H3 hexagon geometry helpers
    │   └── utils.ts
    └── types/
        └── database.types.ts                  // Auto-generated Supabase TS types
```

---

## 🚀 4. Step-by-Step Implementation Roadmap

| Phase | Milestone | Key Deliverables |
| :---: | :--- | :--- |
| **1** | **Project Setup & Auth** | Initialize Next.js 14 in `web/`, install Leaflet, Supabase SSR, Recharts, `h3-js`. Build `/login` & auth middleware. |
| **2** | **Operations Dashboard** | Build `/` with live OpenStreetMap view, active vehicle markers connected to Supabase Realtime, and KPI cards. |
| **3** | **Driver Leaderboard & Scorecard** | Build `/drivers` leaderboard and `/drivers/[id]` profile with 0–100 circular gauge, 5-factor radar chart, and penalty breakdown. |
| **4** | **4D Trip Replay View** | Build `/trips` directory and `/trips/[id]` replay with animated vehicle marker, timeline scrubber, multi-chart oscilloscope, and 50 Hz evidence drawer. |
| **5** | **H3 Surface Heatmap & Predictions** | Build `/road-network` with H3 hexagonal grid colored by Roughness Index ($g_{\text{rms}}$), defect inventory, and prediction verification matrix. |
| **6** | **Hardware Scope & Polish** | Build `/hardware` with live 1 Hz IMU telemetry oscilloscope streaming real-time readings, anomaly log, and UI theme polish. |

