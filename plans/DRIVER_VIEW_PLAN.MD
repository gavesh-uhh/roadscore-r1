# RoadScore Driver View & Real-Time Co-Pilot HUD (`/driver`)
**Streamlined Demo Specification & Implementation Plan**

---

## 1. Executive Summary & Product Vision

The **Driver View** (`/driver`) is a high-performance, mobile-first, real-time driver cockpit designed to pair with any vehicle's RoadScore telematics unit (ESP32) or run in self-contained presentation mode via the built-in **Simulation Studio**.

Instead of acting as a punitive monitoring tool, Driver View serves as an **intelligent in-cabin co-pilot** powered by **TrueScore™**:
1. **TrueScore™ Shield (Automatic Exoneration):** Defends the driver in real time when harsh maneuvers are performed to avoid road hazards (*"Harsh brake recognized as pothole avoidance — 0 points deducted!"*).
2. **Hazard Horizon (300m Perspective Radar):** Renders a 60 FPS forward road horizon alerting drivers 50–300 meters before unseen potholes, unmarked speed bumps, and sharp curves.
3. **Ride Dynamics Orb:** A physics-damped 3D floating G-meter mapping longitudinal and lateral forces ($a_{\text{long}}, a_{\text{lat}}$) with dynamic emerald/amber/crimson aura feedback.
4. **Eco-Glide Coasting Assistant:** Coaches drivers to lift off the throttle early before traffic queues and intersections to save fuel and reduce brake wear.
5. **Dual Voice & Acoustic Chime Engine:** Directional stereo chimes with a strict priority-preempted text-to-speech engine for eyes-up cabin safety.
6. **1-Tap Windshield HUD Mode:** Flips the entire cockpit display horizontally (`scaleX(-1)`) with pure OLED `#000000` dark mode for reflection off the vehicle windshield at night.
7. **Simulation Studio Drawer (`[ 🧪 Simulation Studio ]`):** A collapsible control panel for instant 1-click demonstrations of all real-time driving scenarios without requiring physical road travel.

---

## 2. Streamlined Demo Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      DATA SOURCES                           │
│  Option A: Live ESP32 via Engine SSE (GET /events/live)     │
│  Option B: In-Browser Simulation Studio (1-Click Triggers)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ Real-time Telemetry & Hazards
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              WEB CLIENT (/driver Cockpit)                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 1. Zero-Friction QR / URL Auto-Pairing (?device=...)  │  │
│  │ 2. One-Tap 'Launch Co-Pilot' (WakeLock + Audio Prime) │  │
│  │ 3. Hazard Horizon (60 FPS Canvas Perspective Radar)   │  │
│  │ 4. Ride Dynamics Orb (G-Force Physics Circle)         │  │
│  │ 5. TrueScore™ Live Trip Score & Exoneration Banners   │  │
│  │ 6. Dual Voice & Acoustic Chime Engine (TTS + Chimes)  │  │
│  │ 7. Eco-Glide Coasting Advisories                      │  │
│  │ 8. 1-Tap Windshield HUD Mode (CSS scaleX(-1))         │  │
│  │ 9. Simulation Studio Drawer (Presenter Controls)      │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Core Feature Specifications

### 3.1 Feature 1: TrueScore™ Shield (Automatic Exoneration)
* **Objective:** Prove to judges and drivers that RoadScore actively protects safe defensive driving rather than penalizing necessary hazard avoidance.
* **Trigger Mechanism:**
  - When a harsh brake ($a_{\text{long}} \le -3.0\text{ m/s}^2$) or sharp swerve occurs while approaching a known defect or road hazard within a 3-second window ($t - t_{\text{hazard}} \le 3.0\text{ s}$).
  - Exoneration flag `exonerated: true` is attached with `attributedToDriver: false`.
* **In-Cabin Cockpit Experience:**
  - Displays a high-contrast emerald shield banner with pulse animation:
    > 🛡️ **TrueScore™ Shield:** *"Harsh braking recognized as hazard avoidance — 0 points deducted! Safe defensive driving."*
  - Plays a gentle, reassuring double-harmonic chime (C5 $\rightarrow$ G5).
  - Keeps the **Live Trip Score** intact at $100/100$ with `+0 Deductions (Protected)`.

### 3.2 Feature 2: Hazard Horizon (300m Forward Perspective Radar)
* **Objective:** Give the cockpit a modern Tesla/Waymo-style lookahead visualization.
* **Visual Implementation:**
  - High-performance HTML5 Canvas / SVG road with vanishing point perspective and moving lane markings synchronized with current speed ($v_{\text{km/h}}$).
  - Approaching hazard markers with real-time distance countdowns:
    - 🔴 **Severe Pothole** (60m Ahead, Stay Right)
    - ⚠️ **Unmarked Speed Bump** (40m Ahead, Target: 20 km/h)
    - 🔄 **Sharp Hairpin Bend** (180m Ahead, Advised: 35 km/h)
    - 🌊 **Water Pooling / Rough Patch** (120m Ahead)

### 3.3 Feature 3: Ride Dynamics Orb (Smoothness G-Meter)
* **Objective:** Real-time feedback on passenger comfort and kinematic smoothness.
* **Physics & Visuals:**
  - Smoothly maps longitudinal acceleration ($a_{\text{long}}$) to Y-axis and lateral cornering force ($a_{\text{lat}} = v \cdot \omega$) to X-axis with spring-damper physics.
  - **Dynamic Aura Colors:**
    - **Emerald Glow (`#10B981`):** Smooth driving ($|G| \le 0.15\text{ g}$).
    - **Amber Glow (`#F59E0B`):** Moderate maneuver ($0.15\text{ g} < |G| \le 0.35\text{ g}$).
    - **Crimson Shockwave (`#F43F5E`):** Harsh event ($|G| > 0.35\text{ g}$).

### 3.4 Feature 4: Eco-Glide Coasting Assistant
* **Objective:** Coach drivers to lift off the throttle before queues to save fuel and brake pads.
* **Cockpit Experience:**
  - Slides in an emerald green banner with a coasting arrow:
    > 🟢 **Eco-Glide:** *"Traffic slowing in 200m — Lift throttle now and coast to glide smoothly."*
  - Live metric pill: `⚡ Ride Smoothness: 98%` • `⛽ +8% Eco-Efficiency`.

### 3.5 Feature 5: Priority Audio & Windshield HUD Mode
* **Priority Voice & Chime Engine:**
  - **Tier 1 (Safety Alerts):** Cancels any background chatter, plays directional stereo chime, and speaks urgent hazard warnings aloud (*"Caution: Pothole on left in 60 meters"*).
  - **Tier 2 (TrueScore™ Popups):** Chimes reassuringly and speaks positive feedback after hazard avoidance.
  - **Tier 3 (Eco Advisories):** Soft notification tone and visual dock banner.
* **1-Tap Windshield HUD Mode:**
  - Instantly inverts display horizontally (`transform: scaleX(-1)`) with pitch-black OLED `#000000` background for reflection off the car windshield at night.

---

## 4. Cockpit UI Layout & Component Breakdown

### 4.1 Mobile Portrait Cockpit Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🛡️ TRUESCORE™ ACTIVE             ⚡ SMOOTHNESS: 98%        ⛽ +8% ECO-SAVED  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                  ▲  HAZARD HORIZON (300m Lookahead)                         │
│                  │  [60 FPS Perspective Canvas]                             │
│                 [ ]  (Vehicle)                                              │
│                  │                                                          │
│                  ├─── ⚠️ Speed Bump in 45m (Target: 20 km/h)                 │
│        🕳️ [Left] └─── 🔴 Severe Pothole in 90m (Stay Right)                  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│   LIVE SPEED            RIDE DYNAMICS              LIVETRUESCORE™           │
│                                                                             │
│     54                  ╭──────────────╮                 98                 │
│    KM/H                 │   🟢  (G)    │               / 100                │
│  Limit: 60              ╰──────────────╯            +0 Deductions           │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 💡 SMART ASSIST CARD:                                                       │
│ "Harsh braking recognized as pothole avoidance — 0 pts deducted (Protected)"│
├─────────────────────────────────────────────────────────────────────────────┤
│ [ 🌙 Windshield HUD ]       [ 🎙️ Co-Pilot Voice ]   [ 🧪 Simulation Studio ]│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Component Breakdown (`web/src/components/driver/`)
1. `HazardHorizonRadar.tsx`: 300m perspective canvas road with moving lane lines and approaching hazard countdowns.
2. `RideDynamicsOrb.tsx`: Physics-damped floating G-meter orb mapping $a_{\text{long}}$ and $a_{\text{lat}}$.
3. `TrueScoreCards.tsx`: Animated slide-in alert queue (TrueScore™ Shield Exonerations & Eco-Glide Tips).
4. `SimulationStudioDrawer.tsx`: Presenter control panel with 1-click test triggers.
5. `DevicePairModal.tsx`: QR scanner and URL auto-pair handler (`?device=rs-device-01`).
6. `LaunchModal.tsx`: One-tap permission unlock for Web Audio context, Web Speech synthesis, and Screen Wake Lock.

---

## 5. In-Browser Simulation Studio (`[ 🧪 Simulation Studio ]`)

The Simulation Studio allows full end-to-end demonstrations from any laptop or mobile browser without requiring a live vehicle or physical road test:

| Control | Action Triggered in Cockpit |
| :--- | :--- |
| **Speed Slider ($0 - 120\text{ km/h}$)** | Updates speedometer and accelerates road canvas lane animation. |
| **`[ 🕳️ Trigger Pothole (60m) ]`** | Injects forward pothole onto radar horizon, starts distance countdown, and speaks audio warning. |
| **`[ ⚠️ Trigger Speed Bump (40m) ]`** | Injects speed bump alert with target speed prompt ($20\text{ km/h}$). |
| **`[ 🛡️ Slam Brakes & Exonerate ]`** | Simulates $-4.5\text{ m/s}^2$ harsh stop, triggers G-Orb shockwave, and pops up the TrueScore™ Shield exoneration banner. |
| **`[ 🟢 Trigger Eco-Glide Tip ]`** | Displays traffic queue coasting advisory. |
| **`[ 🌙 Toggle Windshield HUD ]`** | Tests CSS mirrored reflection mode with OLED dark theme. |

---

## 6. Implementation Milestones

* **Milestone 1 (Audio & Simulation Services):**
  - Implement `web/src/lib/audio/driverVoice.ts` (Web Speech TTS + Web Audio synth chimes with priority queue).
  - Implement `web/src/lib/sim/demoSimulator.ts` (Scenario generator for speed, hazards, and TrueScore™ events).

* **Milestone 2 (Cockpit UI Components):**
  - Build `HazardHorizonRadar.tsx` (60 FPS perspective canvas road with hazard markers).
  - Build `RideDynamicsOrb.tsx` (G-force physics orb).
  - Build `TrueScoreCards.tsx` (Exoneration shield and smart assist banners).
  - Build `SimulationStudioDrawer.tsx` (Collapsible presenter controls).
  - Build `LaunchModal.tsx` and `DevicePairModal.tsx` (Auto-pair from `?device=...`).

* **Milestone 3 (Page Assembly & Testing):**
  - Assemble `web/src/app/driver/page.tsx`.
  - Integrate Dual-Stream (Live Fastify SSE + Simulation Studio fallback).
  - Integrate Screen Wake Lock API and Mirrored Windshield HUD toggle.
  - Verify responsive mobile layout and audio synthesis across browsers.
