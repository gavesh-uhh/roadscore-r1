# RoadScore Driver View V2 — Simulation Fixes & Cockpit Enrichment Plan
**Audit Report + Enhancement Specification for `/driver`**

---

## 1. Simulation System Audit (Findings & Root Causes)

A line-level review of `web/src/lib/sim/demoSimulator.ts` and `web/src/app/driver/page.tsx` surfaced **7 confirmed defects**, ordered by user impact:

### 🔴 BUG-1 — Every Studio trigger speaks twice
- **Root cause:** `triggerPothole(60)` / `triggerSpeedBump(40)` spawn hazards *inside* `HAZARD_ALERT_RADIUS_M` (150 m). The spawn emits `hazard-spawned` (→ page announces full speech). On the **very next tick**, the proximity check `!h.alertAnnounced && distanceM <= 150` re-emits `hazard-spawned` for the same hazard → identical speech queued a second time.
- **Symptom:** "Caution, severe pothole…" plays back-to-back twice per button press.
- **Fix:** Mark `alertAnnounced: true` at spawn when `distanceM <= HAZARD_ALERT_RADIUS_M`; introduce a distinct `hazard-approaching` event for hazards spawned *beyond* 150 m crossing the radius (chime-only re-alert, no repeated paragraph speech).

### 🔴 BUG-2 — "Slam Brakes & Exonerate" fails at low speed (deduction instead of Shield)
- **Root cause:** `arbitrateHarshManeuver()` runs 450 ms after the slam and computes hazard ETA from the **current** speed — but the harsh stop has already bled speed to near-zero, so ETA explodes (e.g. 22 m at 1.5 m/s ⇒ ETA 15 s > 4.5 s window) ⇒ hazard context missed ⇒ **−2 pts deduction**, the exact opposite of the demo story.
- **Fix:** Capture `maneuverSpeedMps` at the moment of the harsh input; arbitration exonerates when any hazard satisfies `ETA(maneuverSpeed) ≤ 4.5 s` **or** `distanceM ≤ 35 m` **or** passed ≤ 3 s ago. Guarantee-spawn distance becomes `min(30, max(12, speedMps × 2.0))` so it always lands inside the window, even at crawl speed.

### 🟠 BUG-3 — Cockpit looks dead on open ("not much content")
- **Root cause:** `targetSpeedKmh = 0`, empty horizon, empty card dock, orb pinned at center until the presenter opens the drawer and drags the slider.
- **Fix:** New **Auto-Drive Demo** mode (§3.6 below) + ambient default state so the cockpit is alive hands-free within seconds of launch.

### 🟠 BUG-4 — Slam deceleration is physically inconsistent (orb vs speedometer)
- **Root cause:** Speed integration uses `impulseALong × dt × 3` (≈ −13.5 m/s² effective) while the orb displays the stated −4.5 m/s². The speedometer crashes 3× faster than the G-meter indicates.
- **Fix:** Integrate `newV += impulseALong × dt` (true −4.5 m/s²) with a slower decay (`×0.35^dt`, ~1 s impulse) ⇒ believable ≈15 km/h speed bleed matching the orb.

### 🟡 BUG-5 — Live→Sim handoff jolt
- **Root cause:** When the SSE feed goes stale, `setLiveFeed(null)` releases to a stale slider target (often 0) ⇒ instant phantom −4.2 m/s² brake event.
- **Fix:** On release, snap `targetSpeedKmh = speedKmh` so the sim coasts from the last live speed.

### 🟡 BUG-6 — Proximity re-alert reuses `hazard-spawned` event type
- **Root cause:** The 150 m crossing re-emits the same event the page treats as "new hazard → full speech".
- **Fix:** New `SimEvent` variant `hazard-approaching` → page plays a short directional chime + optional terse speech ("Pothole, 100 meters") instead of repeating the full sentence.

### 🟡 BUG-7 — Trip & position do not exist in the sim model
- **Root cause:** The simulator tracks speed/G/hazards only — no lat/lon, no heading, no trip lifecycle — so a map or trip card has nothing to bind to.
- **Fix:** §3.2 Virtual GPS + §3.3 Trip Lifecycle (below).

---

## 2. Enrichment Goals (V2 Scope)

| # | Enhancement | User Value |
|---|---|---|
| E1 | **Live Trip Map panel** (Leaflet via existing `OSMMap`) | See *where* you are, where the trip started, and where hazards were encountered |
| E2 | **Trip Lifecycle status** (Idle → Active → Ended) | Answers "is the trip recording?" at a glance; header chip + stats card |
| E3 | **Auto-Drive Demo mode** (`▶ Play Demo Drive`) | Cockpit demos itself end-to-end, hands-free — fixes the "dead screen" first impression |
| E4 | **Journey Log feed** | Chronological, scrollable record of every cockpit event (warnings, shields, eco tips, trip start/stop) |
| E5 | **Score Breakdown bars** | Longitudinal / Lateral / Speed-Compliance / Eco sub-scores add analytic depth |
| E6 | **Radar ↔ Map view toggle** (+ side-by-side on `lg` screens) | Content density without clutter on mobile |

---

## 3. Technical Design

### 3.1 Simulator correctness fixes (Milestone M1)
Apply BUG-1…BUG-6 fixes in `demoSimulator.ts` + page event routing; extend smoke tests to lock regressions:
- exactly **one** `hazard-spawned` per trigger (no duplicate speech),
- slam at **20 km/h** still exonerates,
- live-feed release produces **no** G-spike (|a_long| step < 1 m/s²).

### 3.2 Virtual GPS (sim) & breadcrumbs (live)
- Simulator gains `position: { lat, lon, headingDeg }`, advanced each tick: heading follows a gentle procedural route (periodic turns), `lat/lon += v·dt` along heading. Turn rate ω couples into `a_lat = v·ω` so **map curves, radar weave, and orb deflection all agree physically**.
- Origin default: Colombo (`6.9271, 79.8612`); overridable via `?lat=&lon=` for localized demos.
- Live mode: breadcrumb trail built from `TelemetryPacket.gps` (append when moved > 5 m, cap 500 points).

### 3.3 Trip Lifecycle state machine
- **Sim:** trip auto-starts after speed > 5 km/h for 3 s; auto-ends after 10 s at ~0. Emits `trip-started` / `trip-ended` with stats `{ distanceM, durationS, eventsCount, hazardsCleared }`.
- **Live:** SSE `trip` frames (and `onTripChange` CDC) override the sim machine; fallback to speed heuristic when no frames arrive.
- Snapshot gains `trip: { active, startedAt, distanceM, durationS, eventsCount }` + `position`.

### 3.4 `TripMap.tsx` (new component)
- Wraps existing `OSMMap` (already dynamic-imported, SSR-safe, dark Vercel tiles via `globals.css`).
- Renders: ego marker (vehicle type + heading), trip **start pin**, breadcrumb `MapPolyline` (emerald), hazard markers (defect type), `EventPulse` ripples on harsh/exoneration moments.
- Props: `position`, `breadcrumbs`, `hazards`, `tripActive`, `startPosition`; `follow` (auto-recenter) with manual pan suppressing follow for 10 s.


### 3.5 Cockpit layout V2 (content density)
```
┌──────────────────────────────────────────────────────┐
│ TrueScore™ Active │ ⚡98% │ ⛽+8% │ ● TRIP ACTIVE 12:34│  ← header + trip chip (E2)
├──────────────────────────────────────────────────────┤
│ [ Radar | Map ] segmented toggle (E6)                 │
│  · HazardHorizonRadar (existing)                      │
│  · TripMap (new, E1)                                  │
├───────────────┬──────────────────┬───────────────────┤
│ SPEED 54 km/h │ RIDE DYNAMICS ORB │ TRUESCORE 98/100  │  ← existing instrument row
├───────────────┴──────────────────┴───────────────────┤
│ Trip Stats strip: ⏱ 12:34 · 🛣 4.2 km · ⚠ 2 cleared  │  ← new (E2)
│ Score Breakdown bars: Long|Lat|Speed|Eco (E5)         │
├──────────────────────────────────────────────────────┤
│ Smart Assist cards  +  Journey Log (scroll feed, E4)  │
├──────────────────────────────────────────────────────┤
│ [🌙 HUD] [🎙️ Voice] [🧪 Simulation Studio]            │
└──────────────────────────────────────────────────────┘
```
Drawer gains `▶ Auto-Drive Demo` toggle (E3). On `lg+`: radar and map render side-by-side (grid-cols-2), journey log in a right rail.

### 3.6 Auto-Drive Demo (E3)
Scripted loop in the simulator (`autoDrive: boolean`), timeline relative to activation:
1. `t+0s` ease to 54 km/h → 2. `t+4s` pothole 90 m → 3. approach → slam + exonerate
→ 4. `t+14s` speed bump 120 m → decelerate to 20 → 5. `t+22s` Eco-Glide queue
→ 6. `t+30s` hairpin + cornering load → 7. loop with ±jitter.
Pauses automatically while live feed is active; single tap stops.

### 3.7 Journey Log & Score Breakdown (E4/E5)
- `JourneyLog.tsx`: append-only feed fed by every `SimEvent` + live events (icon, timestamp, one-liner); 50-item ring buffer; auto-scroll.
- `ScoreBreakdown.tsx`: four animated mini-bars derived from sim accumulators (harsh counts, |G| exposure, speed-limit compliance %, ecoSavedPct).

---

## 4. Milestones

| MS | Scope | Validation |
|----|-------|-----------|
| **M1** | BUG-1…6 fixes + smoke-test locks | `tsc`, `eslint`, node smoke (16+ asserts), `next build` |
| **M2** | Virtual GPS + trip lifecycle + new SimEvents + snapshot fields | smoke: position advances, trip starts/ends, stats sane |
| **M3** | `TripMap.tsx` + view toggle + header trip chip + breadcrumbs | build + manual: map renders dark, trail grows, follow works |
| **M4** | `JourneyLog.tsx` + `ScoreBreakdown.tsx` + trip stats strip | lint/build; feed populates from every event |
| **M5** | Auto-Drive Demo + landscape/`lg` side-by-side polish | full demo dry-run, build, serve 200 |

**Non-goals (V2):** historical trip replay, multi-vehicle switching UI, offline tile caching.

---

## 5. Status
- [x] Audit complete (7 defects documented above)
- [x] M1 — simulation fixes *(implemented & validated: 24/24 smoke asserts, tsc, eslint, build)*
- [x] Feature audit pass #2 (see §6) — 2 audio defects found & fixed
- [ ] M2–M5 — pending implementation approval

---

## 6. Feature Audit Addendum (Pass #2 — full feature review)

Scope: all 10 new/modified files of the `/driver` feature. Method: line-level
review for correctness, leaks, races, SSR safety, a11y, security, and
conformance to `DRIVER_VIEW_PLAN.MD`.

### Fixed in this pass
| ID | Severity | Defect | Fix |
|----|----------|--------|-----|
| A-1 | 🟠 Medium | **Speech preemption state desync** (`driverVoice.ts`): a preempted utterance's async `onend` cleared `speaking/currentTier` for its *replacement*, breaking all subsequent preemption (overlapping voices possible) | Track `currentUtter` identity; `done()` is ignored unless it belongs to the occupying utterance |
| A-2 | 🟡 Low-Med | **Web Audio node leak**: every chime left a GainNode (+StereoPanner) permanently connected to the master bus | `autoDisconnect()` detaches each chime's chain via the last-stopping oscillator's `onended` |

### Verified correct (no action)
- Engine harsh-brake `magnitude` is `m/s2` (positive) — live ingestion negation is correct.
- StrictMode double-mount safe: sim instances cleaned up; no duplicate announcements.
- Card queue bounded (max 3, timers cleared on dismiss/unmount); canvas loops use refs + DPR-aware resize; rAF auto-pauses when tab hidden.
- SSR safety: all `window`/`navigator` access guarded or behind effects/gestures.
- Security: device ID input rendered as text only; QR payload parsed, never navigated to; no injection surface.
- Plan conformance: every §3.x feature, all six §4.2 components, and all §5 drawer controls delivered (plus 2 extra triggers).

### Known limitations (accepted, documented)
| ID | Note |
|----|------|
| L-1 | 20 Hz `setSnapshot` re-renders the cockpit tree — fine on target devices; throttle to 10 Hz + ref-driven canvases if low-end jank appears |
| L-2 | Unpaired cockpit accepts telemetry from **all** fleet devices (demo-friendly); consider first-seen-sticky pairing in production |
| L-3 | `announce()`'s delayed `speak()` (≤500 ms) survives `cancelAll()` unless voice is disabled — bounded, cosmetic |
| L-4 | `ecoSavedPct` accrues during a coast window even at standstill; hazards never "pass" while parked (both physical-ish, demo-acceptable) |
| L-5 | Wake Lock needs Safari 16.4+; QR scan needs `BarcodeDetector` (Chrome/Android) — both degrade gracefully with manual entry |
| L-6 | Canvas visuals are `aria-label`ed but not fully screen-reader equivalent (Hazard list as DOM is covered by V2 Journey Log, E4) |

