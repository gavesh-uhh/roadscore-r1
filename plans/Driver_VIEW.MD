# RoadScore Driver View & Real-Time Co-Pilot HUD (`/driver`)
**Design Specification & Implementation Plan**

---

## 1. Executive Summary & Product Vision

The **Driver View** (`/driver`) is a high-performance, mobile-first, real-time driver cockpit designed to pair with any vehicle's RoadScore telematics unit (ESP32). 

Instead of acting as an oppressive monitoring tool, Driver View serves as an **active, intelligent in-cabin co-pilot** that:
1. **Protects Vehicle Hardware:** Warns drivers 50–300 meters before unseen potholes, unmarked speed bumps, and sharp hairpin curves.
2. **Defends Driver Fairness:** Automatically exonerates drivers in real time when harsh maneuvers are triggered to avoid hazards or traffic (*"Fairness Shield"*).
3. **Improves Passenger Comfort & Fuel Economy:** Provides a live visual Smoothness Gyro-Orb and eco-glide coasting advisories.
4. **Delivers High-Fidelity Assistance:** Features dual-engine directional audio (speech synthesis + acoustic chimes) and a 1-tap inverted **Windshield HUD Mode** for night driving.

---

## 2. Architecture & Data Flow

```
   ┌─────────────────────────────────────────────────────────┐
   │             ESP32 Telematics Unit (Vehicle)             │
   │  MPU6050 (50Hz) + MAX4466 Mic + NEO-6M GPS (1Hz)        │
   └────────────────────────────┬────────────────────────────┘
                                │ Realtime HTTP POST
                                ▼
   ┌─────────────────────────────────────────────────────────┐
   │             RoadScore Engine (Node.js/SSE)              │
   │  - Kinematic Normalization (a_long, a_lat, yaw)        │
   │  - Look-Ahead Cone (ahead.ts, H3 Res 12 matching)       │
   │  - Spatial Arbitration (Road Defect vs Driver Penalty)   │
   │  - SSE Broadcast Server (GET /events/live)              │
   └────────────────────────────┬────────────────────────────┘
                                │ Sub-second SSE Stream + Supabase Realtime Fallback
                                ▼
   ┌─────────────────────────────────────────────────────────┐
   │              Web Client (/driver Cockpit)               │
   │  ┌───────────────────────────────────────────────────┐  │
   │  │ 1. Quick-Pair & Device Session Manager            │  │
   │  │ 2. 300m Forward Lookahead Radar & Countdown Engine│  │
   │  │ 3. Ambient G-Force Smoothness Gyro-Orb            │  │
   │  │ 4. Smart Assist Card Engine (Fairness, Eco, Rest) │  │
   │  │ 5. Dual Audio Engine (Web Speech + Web Audio API) │  │
   │  │ 6. 1-Tap Mirrored Windshield HUD Mode             │  │
   │  └───────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────┘
```

---

## 3. Core UI Layout & Visual Specifications

### 3.1 Mobile Portrait / Cockpit Layout

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

### 3.2 Landscape Cockpit / Tablet Layout
* **Left Panel (50% width):** Large Forward Hazard Radar with 3D perspective pitch and animated road lane markings.
* **Right Panel (50% width):** Large Speedometer, Smoothness Gyro-Orb, Live Trip Metrics, and Smart Assist Cards stack.

---

## 4. Key Functional Modules

### 4.1 Quick-Pair & Device Session Manager
* **Dropdown & QR Scanner:** Easily pair with any registered device (`ROADSCORE_001`, `ROADSCORE_002`, etc.) or scan the QR code on the hardware unit.
* **Persistent Memory:** Stores paired `deviceId` and `driverId` in browser `localStorage` for automatic 1-tap re-connection on every launch.
* **Live Connection Pulse:** Displays real-time ping latency ($<150\text{ms}$) and connection state (`LIVE`, `RECONNECTING`, `OFFLINE`).

### 4.2 300m Forward Lookahead Radar & Real-Time Countdowns
* **Data Ingest:** Streams predictions generated by `ahead.ts` via the SSE live stream.
* **Hazard Timeline Representation:**
  - 🕳️ **Potholes / Road Defects:** Displays distance countdown ($140\text{m} \to 100\text{m} \to 60\text{m} \to 20\text{m}$), severity color, and lane orientation (*Left / Center / Right*).
  - ⚠️ **Speed Bumps:** Displays distance and target glide speed (e.g. `20 km/h`).
  - 🔄 **Curve Advisory:** Displays dynamic recommended entry speed before sharp turns.
  - 🌧️ **Slippery Road / Standing Water:** Alerts for hydroplaning risk.
* **Dynamic Interpolation:** Smooth 60 FPS CSS/Canvas tick interpolation between 1 Hz GPS packet updates so the countdown moves smoothly.

### 4.3 Ambient G-Force Smoothness Gyro-Orb
* **Kinematics:** Translates normalized longitudinal ($a_{\text{long}}$) and lateral ($a_{\text{lat}}$) accelerations into a 2D floating orb:
  $$\Delta x = \text{clamp}(a_{\text{lat}} / 4.0, -1, 1) \times R$$
  $$\Delta y = \text{clamp}(-a_{\text{long}} / 4.0, -1, 1) \times R$$
* **Color Aura Progression:**
  - **Emerald Green ($< 0.20\text{g}$):** Perfect chauffeur-grade smoothness.
  - **Amber Glow ($0.20\text{g} - 0.35\text{g}$):** Warning threshold — gently alert driver before reaching deduction limits.
  - **Rose Pulse ($> 0.35\text{g}$):** Harsh maneuver threshold.

### 4.4 Smart Assist Card Engine
Contextual cards that slide into view based on incoming stream telemetry and roadside context:
1. **Fairness Shield Pop-Up:** Triggered when an impact or harsh brake is recognized as hazard avoidance:
   > *"Harsh braking recognized as hazard avoidance. 0 points deducted! Safe defensive driving."*
2. **Eco-Glide Coasting:** Triggered when forward traffic or red light queue is detected within 300m:
   > *"Traffic queue 200m ahead — Lift throttle now and coast to save brakes & fuel."*
3. **Mountain Descent Brake Guard:** Triggered on continuous elevation drop ($dh/dt < -15\text{m/min}$ for $>1\text{km}$):
   > *"Steep downhill for 3 km — Shift to lower gear to avoid brake overheating."*
4. **Micro-Sleep Fatigue Alert:** Triggered after 2 hours continuous driving or upon detecting $1–2\text{Hz}$ yaw twitch patterns:
   > *"Fatigue pattern detected — Rest stop with refreshments in 2.1 km."*
5. **Window / Dust Threat Warning:** Triggered when window Helmholtz resonance is active and unpaved/dusty road is 200m ahead:
   > *"Approaching unpaved dusty road in 200m — Roll up windows recommended."*

### 4.5 Dual Audio Engine (Speech Synthesis + Directional Chimes)
* **Web Speech API (`speechSynthesis`):** Natural spoken voice prompts with configurable rate and pitch.
* **Web Audio API (`AudioContext`):** High-clarity synthesized directional chimes (stereo panning left/right for hazard avoidance).
* **Mute & Volume Controls:** 1-tap accessible on the main HUD.

### 4.6 1-Tap Mirrored Windshield HUD Mode
* **CSS Mirror Transform:** Applies `transform: scaleX(-1)` and forces `#000000` pitch-black background with high-contrast fluorescent green/amber typography.
* **Usage:** Driver places the mobile device on the dashboard beneath the windshield glass. The screen reflection provides a crystal-clear floating Head-Up Display at night without double-glare.
* **Wake Lock API:** Automatically acquires `navigator.wakeLock.request('screen')` so the screen never dims or locks while driving.

---

## 5. Technical Implementation Steps

### Phase 1: Core Page & Pairing Architecture
1. Create `web/src/app/driver/page.tsx` with responsive layout container and header navigation.
2. Implement `web/src/components/driver/DevicePairModal.tsx` supporting device selection and localStorage caching.
3. Integrate `Screen Wake Lock API` to prevent display sleep during active sessions.

### Phase 2: Streaming Telemetry & Forward Radar
1. Connect to `/api/events/live` (or direct Engine SSE) for sub-second telemetry feeds.
2. Build `web/src/components/driver/ForwardRadar.tsx` showing the 300m forward hazard timeline.
3. Implement `web/src/components/driver/SmoothnessOrb.tsx` rendering the physics-based G-force gyro orb.

### Phase 3: Smart Cards & Audio Synthesis
1. Build `web/src/components/driver/SmartAssistCards.tsx` to handle contextual card triggers and animations.
2. Implement `web/src/lib/audio/driverVoice.ts` integrating Web Speech API and Web Audio directional chimes.
3. Add the Fairness Shield instant exoneration trigger listener.

### Phase 4: Windshield HUD Mode & Mobile Optimization
1. Implement 1-tap `isHudMode` toggle applying mirrored CSS transforms and ultra-high contrast dark theme.
2. Implement responsive orientation detection (Portrait vs. Landscape auto-layout).
3. Test touch targets for large, glanceable, in-vehicle ergonomics.

---

## 6. Verification & Acceptance Criteria
* **Pairing:** Reconnects within $< 500\text{ms}$ upon page reload without asking for re-pairing.
* **Latency:** Hazard countdowns and G-force orb update with $< 200\text{ms}$ latency from hardware telemetry emission.
* **Audio:** Voice callouts trigger once per hazard at $60\text{m}$ distance without repeating or overlapping.
* **HUD Mode:** Renders crisp, reversed typography and high-contrast visuals suitable for windshield reflection in dark environments.
* **Screen Lock:** Mobile screen stays active and illuminated throughout a 2-hour driving session.
