# RoadScore Driver View & Real-Time Co-Pilot HUD (`/driver`)
**Comprehensive Architectural Specification, Implementation, Testing & Audit Plan**

---

## 1. Executive Summary & Product Vision

The **Driver View** (`/driver`) is a high-performance, mobile-first, real-time driver cockpit designed to pair with any vehicle's RoadScore telematics unit (ESP32). 

Instead of acting as an oppressive monitoring tool, Driver View serves as an **active, intelligent in-cabin co-pilot** that:
1. **Protects Vehicle Hardware:** Warns drivers 50–300 meters before unseen potholes, unmarked speed bumps, and sharp hairpin curves.
2. **Defends Driver Fairness:** Automatically exonerates drivers in real time when harsh maneuvers are triggered to avoid hazards or traffic (*"Fairness Shield"*).
3. **Improves Passenger Comfort & Fuel Economy:** Provides a live visual Smoothness Gyro-Orb and eco-glide coasting advisories.
4. **Delivers High-Fidelity Assistance:** Features dual-engine directional audio (speech synthesis + acoustic chimes) and a 1-tap inverted **Windshield HUD Mode** for night driving.
5. **Contextual In-Cabin Threat Awareness:** Detects steep downhill descents (brake-fade risk), continuous driving fatigue, and open windows before entering dusty or unpaved road segments.
6. **Robust Offline & Autoplay Architecture:** Pre-fetches a 15 km spatial corridor into IndexedDB for zero-latency offline radar in tunnels, respects mobile audio autoplay policies with a 1-tap Co-Pilot Launcher, and includes an interactive in-browser Demo Simulator Drawer.

---

## 2. End-to-End System Architecture

```
   ┌─────────────────────────────────────────────────────────┐
   │             ESP32 Telematics Unit (Vehicle)             │
   │  - MPU6050: 50Hz Accel & Gyro dynamic 3D decomposition  │
   │  - MAX4466: 50Hz Acoustic RMS & Peak envelope           │
   │  - NEO-6M: 1Hz GPS UTC, Speed, Course, Lat/Lon, Alt     │
   └────────────────────────────┬────────────────────────────┘
                                │ 1 Hz HTTP POST Telemetry Stream
                                ▼
   ┌─────────────────────────────────────────────────────────┐
   │             RoadScore Engine (Node.js/SSE)              │
   │  ├─ Normalization: a_long least-squares, v·ω centripetal│
   │  ├─ Dynamic Lookahead Cone (ahead.ts, H3 Res 12 cells)  │
   │  ├─ Spatial Arbitration (attribute.ts, consensus)       │
   │  ├─ Duty & Gradient: Altitude dh/dt, Fatigue T_moving   │
   │  └─ SSE Broadcast Server (GET /events/live)             │
   └────────────────────────────┬────────────────────────────┘
                                │ Sub-second SSE Stream + Supabase Realtime Fallback
                                ▼
   ┌─────────────────────────────────────────────────────────┐
   │              Web Client (/driver Cockpit)               │
   │  ┌───────────────────────────────────────────────────┐  │
   │  │ 1. Quick-Pair & Device Session (localStorage)     │  │
   │  │ 2. One-Tap 'Start Co-Pilot' (WakeLock + AudioCtx) │  │
   │  │ 3. 15 km Corridor Local Defect Cache (IndexedDB)  │  │
   │  │ 4. 300m Lookahead Radar & Canvas Countdown (60FPS)│  │
   │  │ 5. G-Force Smoothness Gyro-Orb (a_long, a_lat)    │  │
   │  │ 6. Preemptive Priority Speech & Chime Engine      │  │
   │  │ 7. Smart Assist Engine (Fairness, Eco, Descent...)│  │
   │  │ 8. Mirrored Windshield HUD Mode + OLED Theme      │  │
   │  │ 9. In-Browser Demo & Simulation Drawer            │  │
   │  └───────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Specifications for All Smart Assistant Features

### 3.1 Feature 1: The "Fairness Shield" (Automatic Exoneration Pop-Up)
* **Objective:** Instantly reassure the driver that a sudden brake or swerve was recognized as hazard avoidance rather than reckless driving, eliminating score dispute stress.
* **Engine Implementation:**
  - In `engine/src/detect/longitudinal.ts` and `engine/src/detect/swerve.ts`:
  - When a harsh brake ($a_{\text{long}} \le -3.0\text{ m/s}^2$) or swerve occurs, the engine checks if a known road defect or rough segment was within the vehicle's forward cone in the preceding 3 seconds ($t - t_{\text{hazard}} \le 3.0\text{ s}$).
  - If verified, the candidate is flagged with `exonerated: true, reason: 'hazard_avoidance'` and `attributedToDriver: false`.
* **Client Behavior (`/driver`):**
  - Displays a prominent, calming emerald green card with a shield animation:
    > 🟢 **Fairness Shield:** *"Harsh braking recognized as hazard avoidance — 0 points deducted! Safe defensive driving."*
  - Plays a gentle, reassuring chime (low-pitch double harmonic).

### 3.2 Feature 2: Eco-Glide Coasting Assistant
* **Objective:** Reduce brake wear and save up to 15% on fleet fuel by coaching drivers to lift off the throttle early before traffic queues and intersections.
* **Engine Implementation:**
  - In `engine/src/predict/ahead.ts`:
  - Compares vehicle current speed ($v_{\text{current}}$) with the historical 85th-percentile speed (`speed_p85_kmh`) of target H3 cells 150m–300m ahead in the lookahead cone.
  - When $v_{\text{current}} \ge 45\text{ km/h}$ and $p85_{\text{ahead}} \le 25\text{ km/h}$ (indicating a traffic queue, roundabout, or congestion wave), `ahead.ts` emits:
    ```typescript
    {
      type: 'road.traffic_slowdown_ahead',
      distanceM: number,
      currentSpeedKmh: number,
      targetSpeedKmh: number,
      etaS: number
    }
    ```
* **Client Behavior (`/driver`):**
  - Renders a vibrant green "Eco-Glide" banner with a coasting arrow:
    > 🟢 **Eco-Glide:** *"Traffic slowing in 200m — Lift throttle now and coast to glide smoothly."*

### 3.3 Feature 3: Mountain Descent Brake-Fade Guard
* **Objective:** Prevent catastrophic brake failure on long mountain passes by alerting drivers before brake fluid boils and pads glaze.
* **Engine Implementation:**
  - In `engine/src/detect/duty.ts`:
  - Ingests `s.altitude` from GPS and computes the running vertical gradient over a 60-second window:
    $$\frac{dh}{dt} = \frac{\text{alt}(t) - \text{alt}(t - 60\text{s})}{60\text{s}}$$
  - If $\frac{dh}{dt} \le -15\text{ m/min}$ (descent) sustained over $\ge 1.0\text{ km}$ while light continuous deceleration is maintained ($a_{\text{long}} \in [-0.3, -1.5]\text{ m/s}^2$), it emits `road.steep_descent`.
* **Client Behavior (`/driver`):**
  - Displays a high-contrast amber mountain warning card:
    > ⚠️ **Brake Overheat Guard:** *"Steep 3 km descent — Shift to lower gear to engine-brake and protect pads."*

### 3.4 Feature 4: Fatigue & Microsleep Companion
* **Objective:** Detect the early onset of driver fatigue long before micro-sleep leads to lane departure or collision.
* **Engine Implementation:**
  - In `engine/src/detect/duty.ts`:
  - Tracks continuous movement duration $T_{\text{moving}}$. Emits `driver.continuous_driving` at $T_{\text{moving}} \ge 7,200\text{ s}$ (2 hours), escalating severity every additional hour until a verified rest break ($\ge 300\text{ s}$ stationary) occurs.
* **Client Behavior (`/driver`):**
  - Slides up an alert card with coffee cup icon and nearby rest area guidance:
    > ☕ **Fatigue Companion:** *"2.0 Hours Continuous Driving — Rest area with refreshments available in 2.1 km."*

### 3.5 Feature 5: Window & Dust / Water Threat Advisory
* **Objective:** Prevent cabin dust ingestion, mud spray, or passenger discomfort by reminding drivers to close windows before unpaved or flooded road segments.
* **Engine Implementation:**
  - Detects open window condition via microphone acoustic turbulence ($mic.rms \ge 3.0 \times \text{ambient}$ at $v \ge 40\text{ km/h}$).
  - In `ahead.ts`, when an upcoming H3 cell within 200m has a high roughness index ($R > R_{\text{median}}$) or active water pooling report, emits `road.dust_threat_ahead`.
* **Client Behavior (`/driver`):**
  - Displays a window prompt card:
    > 🪟 **Cabin Protection:** *"Approaching unpaved dusty road in 180m — Roll up windows recommended."*

---

## 4. Gap Resolutions & Advanced System Engineering

### 4.1 Mobile Audio Autoplay & Screen Wake Lock Acquisition
* **Mobile Browser Policy:** Mobile WebKit and Chromium strictly block Web Audio context playback and Web Speech synthesis unless initiated by an explicit user gesture.
* **Solution (`Start Co-Pilot Launch Modal`):**
  - When opening `/driver`, a sleek **"Tap to Launch Co-Pilot"** button is presented.
  - On tap, the event handler synchronously:
    1. Resumes the `AudioContext` (`if (ctx.state === 'suspended') ctx.resume()`).
    2. Initializes a silent 1ms speech synthesis utterance to prime `window.speechSynthesis`.
    3. Acquires screen wake lock via `navigator.wakeLock.request('screen')`.
    4. Automatically re-acquires the wake lock if the tab visibility state returns to `visible`.

### 4.2 Strict Priority Preemption for Voice & Visual Alerts
* **Problem:** Simultaneous triggers (e.g. approaching a pothole while an Eco-Glide tip is playing) cause overlapping garbled speech.
* **Solution (Preemptive Priority Hierarchy):**
  $$\text{Tier 1 (Safety Alerts)} > \text{Tier 2 (Fairness Popups)} > \text{Tier 3 (Coaching \& Advisories)}$$
  - **Tier 1 (Potholes, Speed Bumps, Sharp Curves):** Instantly calls `speechSynthesis.cancel()`, silencing any lower-priority speech and playing the safety alert immediately with directional stereo chimes.
  - **Tier 2 (Fairness Shield Exoneration):** Displays immediately and chimes after a 500ms safety buffer.
  - **Tier 3 (Eco-Glide, Mountain Descent, Window, Fatigue):** Queues in the bottom smart dock without interrupting safety speech.

### 4.3 15 km Corridor Local Defect Caching (Offline Tunnel Resilience)
* **Problem:** Cellular data drops in tunnels and rural mountain passes, breaking the live hazard radar.
* **Solution (`IndexedDB` Geo-Corridor Cache):**
  - On initial connection, `/driver` downloads all active road defects within a 15 km bounding box around the vehicle's starting coordinates into client `IndexedDB`.
  - If SSE/network disconnects, the client automatically falls back to local lookahead projection:
    - Ingests direct GPS coordinates from device stream.
    - Projects `coneCells()` locally in browser JavaScript against the cached IndexedDB defects.
    - Hazard radar continues running with zero downtime even with 0 bars of cell signal!

### 4.4 In-Browser Demo & Simulation Drawer
* **Problem:** Developers and stakeholders testing on indoor desks cannot trigger speed-dependent lookahead cones or mountain descents physically.
* **Solution (Collapsible Simulator Drawer):**
  - In `/driver`, a collapsible drawer (`[ 🧪 Demo Controls ]`) provides:
    - **Speed Slider ($0 - 120\text{ km/h}$)**: Simulates forward velocity.
    - **Trigger Pothole (60m Ahead)**: Injects a live mock prediction to test radar countdown and voice callout.
    - **Trigger Unmarked Speed Bump (40m Ahead)**: Tests speed bump target speed prompt.
    - **Trigger Harsh Brake Exoneration**: Injects a sudden brake event with Fairness Shield pop-up.
    - **Simulate Open Window Wind Noise**: Tests acoustic dust threat advisory.

---

## 5. Cockpit UI Layout & Component Architecture

### 5.1 Mobile Portrait Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🟢 FAIRNESS SHIELD ACTIVE         ⚡ ECO-SMOOTH: 98%        ⛽ +8% FUEL SAVED│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                  ▲  FORWARD ROAD RADAR (300m Horizon)                       │
│                  │                                                          │
│                 [ ]  (Your Vehicle)                                         │
│                  │                                                          │
│                  ├─── ⚠️ Unmarked Speed Bump in 60m (Target: 20 km/h)        │
│                  │                                                          │
│        🕳️ [Left] ├─── 🔴 Severe Pothole in 140m (Stay Right)                 │
│                  │                                                          │
│                  └─── 🔄 Sharp Right Bend in 280m (Advised: 35 km/h)        │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│   LIVE SPEED       SMOOTHNESS GYRO-ORB          LIVE TRIP SCORE             │
│                                                                             │
│     54             ╭──────────────╮                 96                      │
│    KM/H            │   🟢  (G)    │               / 100                     │
│  Limit: 60         ╰──────────────╯             +0 Deductions               │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 💡 SMART ASSIST CARD:                                                       │
│ "Traffic queue 200m ahead — Lift throttle now and coast to glide smoothly"  │
├─────────────────────────────────────────────────────────────────────────────┤
│ [ 🌙 Night HUD Mode ]            [ ☕ Rest Stop: 2.1km ]         [ 🎙️ Voice ON ] │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Component Breakdown (`web/src/components/driver/`)
1. `ForwardRadar.tsx`: 300m perspective canvas/SVG road with animated lane striping and approaching hazard markers (Potholes with Left/Center/Right tags, Speed bumps, Curves, and Water hazards).
2. `SmoothnessOrb.tsx`: Physics-driven floating gyro orb mapping $a_{\text{long}}$ and $a_{\text{lat}}$ with emerald/amber/rose aura glow.
3. `SmartAssistCards.tsx`: Animated slide-in notification queue prioritizing Safety Alerts > Fairness Shield > Eco Coaching.
4. `DevicePairModal.tsx`: Pairing selector with QR scanner, device search dropdown, and persistent localStorage sync.
5. `WindshieldHudOverlay.tsx`: CSS-mirrored inverted display mode with pure OLED `#000000` background and high-visibility neon phosphors.
6. `DemoSimulatorDrawer.tsx`: Interactive control panel for 1-click feature simulation.

---

## 6. Testing, Kinematic Verification & Audit Suite

### 6.1 Automated Unit & Kinematic Tests (`engine/test/driver-assist.test.ts`)
* **Test 1: Fairness Shield Exoneration:** Verify that when a harsh brake candidate occurs within 3s of a known lookahead defect cell, `attributedToDriver` is set to `false` and `exonerated: true` is attached.
* **Test 2: Eco-Glide Slowdown Trigger:** Verify that an approach towards an H3 cell with $p85 = 20\text{ km/h}$ from $v = 60\text{ km/h}$ generates `road.traffic_slowdown_ahead` at $d = 200\text{m}$.
* **Test 3: Mountain Descent Altitude Gradient:** Verify that feeding falling altitude samples ($dh/dt = -20\text{ m/min}$) over 60 seconds triggers `road.steep_descent`.
* **Test 4: Continuous Fatigue Timer:** Verify that feeding $T_{\text{moving}} = 7,205\text{ s}$ emits `driver.continuous_driving` and resets only after a $300\text{ s}$ zero-speed rest window.
* **Test 5: Window Wind Turbulence Correlation:** Verify that high acoustic RMS at speed combined with forward roughness triggers `road.dust_threat_ahead`.

### 6.2 Frontend Audio, Canvas, & Offline Tests
* **Audio Voice Callout Test:** Verify Web Speech API synthesizes spoken alerts at $60\text{m}$ distance exactly once (with deduplication).
* **Directional Chime Panning Test:** Verify Web Audio API pans stereo chimes to the left channel when a pothole is flagged on the left tire track.
* **Screen Wake Lock Resilience:** Verify `navigator.wakeLock` re-acquires lock if the browser tab loses and regains focus.
* **Mirrored HUD Transform:** Verify CSS transform `scaleX(-1)` flips text and canvas rendering for windshield reflection.
* **Offline Local Cache Test:** Verify `ForwardRadar` continues calculating distance countdowns when `navigator.onLine === false`.

---

## 7. Implementation Milestones

* **Milestone 1 (Engine Extensions):** Add slowdown prediction, mountain descent gradient, and hazard exoneration flags to `engine/src/predict/` and `engine/src/detect/`.
* **Milestone 2 (Unit & Kinematic Verification):** Build and run `engine/test/driver-assist.test.ts` (100% test pass).
* **Milestone 3 (Web Audio & Offline Cache):** Implement `web/src/lib/audio/driverVoice.ts` and `web/src/lib/cache/corridorDb.ts`.
* **Milestone 4 (Cockpit UI Components):** Build `ForwardRadar.tsx`, `SmoothnessOrb.tsx`, `SmartAssistCards.tsx`, `DevicePairModal.tsx`, and `DemoSimulatorDrawer.tsx`.
* **Milestone 5 (HUD Mode & Integration):** Assemble `web/src/app/driver/page.tsx`, integrate Wake Lock API, and verify responsive mobile layout.
