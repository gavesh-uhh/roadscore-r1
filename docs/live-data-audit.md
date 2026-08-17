# RoadScore-R1 — Comprehensive Live Data Integrity Audit

**Date:** 2026-08-17  
**Branch:** `audit/live-data`  
**Purpose:** Identify every instance where RoadScore-R1 uses hardcoded, synthetic, or fallback data instead of real-world telemetry, OpenStreetMap/OSRM routing, and Supabase H3 spatial observations.

---

## Executive Summary

The audit investigated the end-to-end data pipelines across `web`, `engine`, `db`, and `mcu`. The primary integrity violations were concentrated in the routing engine (`web/src/lib/routing/osrmEngine.ts`) and its consumer UI (`web/src/app/routing/page.tsx`):
1. **Synthetic Route Geometry Fallback**: Generation of quadratic Bezier curves masquerading as real road paths when external routing fails.
2. **Fabricated Route Metrics**: Route distance and duration calculated using fixed multiplication heuristics (`1.08x`, `1.04x`, `dist * 2.0 + 2`) rather than OSRM network metrics.
3. **Manufactured Safety & Pothole Values**: Safe route preset hardcoding `defectHits = 0` and capping `avgRoughness = 14.2`, and balanced route using half of fast route's defect count.
4. **Unfounded Roughness Baseline Priors**: Missing H3 observations silently defaulted to hardcoded roughness values (`12.5`, `38.0`, `42.0`) instead of returning an `Insufficient data` state.
5. **Flawed Coverage Metric**: Route coverage percentage was calculated against arbitrary polyline vertex counts rather than deduplicated traversed H3 cells.

---

## Data Provenance & Pipeline Matrix

| Component / Metric | Live Source | Current Implementation | Integrity Status | Required Action |
| :--- | :--- | :--- | :--- | :--- |
| **Route Geometry** | OSRM / OpenStreetMap | OSRM API with Bezier fallback `generateFallbackStreetPath` | ⚠️ Fallback Fabricates Geometry | Remove Bezier fallback; fail gracefully with "Routing unavailable" |
| **Route Distance** | OSRM Route Summary | OSRM primary, but Safe (`1.08x`) and Balanced (`1.04x`) multiply Fast distance | ❌ Fabricated Multipliers | Use actual OSRM alternative route distance |
| **Route Duration** | OSRM Route Summary | Synthetic formula: `dist * 2.0 + 2`, `dist * 1.9 + 1` | ❌ Fabricated Heuristic | Use actual OSRM duration or mark explicitly as estimated |
| **Traversed H3 Cells** | `latLngToCell(lat, lon, 12)` along OSRM path | Sampled per polyline vertex | ⚠️ Inaccurate deduplication | Deduplicate H3-12 cells along sampled route geometry |
| **Road Roughness** | Supabase `road_cells.roughness_index` | Matched cells average; defaults to 12.5 / 38.0 on empty | ❌ Hardcoded Baseline Priors | Return `null` / "Insufficient data" when unobserved |
| **Defects / Potholes** | Supabase `road_defects` & `road_cells.spike_count` | Proximity check, but overridden for Safe (`0`) and Balanced (`fast/2`) | ❌ Forced & Fabricated Values | Calculate strictly from matched H3 cells and defect locations |
| **Route Coverage %** | Traversed observed cells / total traversed cells | `matchedCells / polyline.length * 100` | ⚠️ Distorted Calculation | `(observedH3Cells / totalRouteH3Cells) * 100` |
| **Driver 24h Score** | Supabase `driving_events` | Continuous exponential decay scoring engine | ✅ Verified Live | Preserve continuous scoring calculation |
| **Road Quality Map** | Supabase `road_cells` + `h3-js` | Direct boundary rendering via `cellToBoundary` | ✅ Verified Live | Ensure spatial queries scale with route/viewport |
| **Trip Telemetry Replay** | Supabase `telemetry` + `driving_events` | Real sensor samples with query fallback by timestamp | ✅ Verified Live (Graceful DB Fallback) | Document timestamp fallback |

---

## Suspicious & Non-Live Data Item Inventory

### 1. Fallback Route Geometry Generator
* **Value:** `generateFallbackStreetPath(start, end, curveOffset, points)`
* **File:** `web/src/lib/routing/osrmEngine.ts:144-169`
* **Current Source:** Synthetic quadratic Bezier curve with orthogonal offset.
* **Classification:** Fallback / Fabricated
* **User-Facing:** Yes — displayed on map as a genuine road route.
* **Required Change:** Delete `generateFallbackStreetPath`. If OSRM is unreachable or returns no route, return `null` and set route state to `unavailable`. Never render synthetic coordinates as roads.

### 2. Distance Multipliers for Route Alternatives
* **Value:** `safeDistKm = Number((fastDistKm * 1.08).toFixed(1))` and `balancedDistKm = Number((fastDistKm * 1.04).toFixed(1))`
* **File:** `web/src/lib/routing/osrmEngine.ts:322, 347`
* **Current Source:** Fixed multiplication factors (1.08 and 1.04).
* **Classification:** Hardcoded / Fabricated
* **User-Facing:** Yes — displayed in route summary cards as real kilometers.
* **Required Change:** Obtain actual route distances from distinct OSRM route alternatives or waypoints. If unavailable, do not invent distance multipliers.

### 3. Route Duration Heuristics
* **Value:** `safeDurationMins = Math.round(safeDistKm * 2.0 + 2)`, `balancedDurationMins = Math.round(balancedDistKm * 1.9 + 1)`, `fastDurationMins = Math.round(fastDistKm * 1.8)`
* **File:** `web/src/lib/routing/osrmEngine.ts:290, 323, 348`
* **Current Source:** Hardcoded minute multipliers per km.
* **Classification:** Hardcoded Heuristic
* **User-Facing:** Yes — displayed in route summary cards (e.g., "14m").
* **Required Change:** Use OSRM's `durationS` (converted to minutes). If OSRM duration is missing, calculate duration using road segment speed limits (or P85 fleet speeds) and mark explicitly as estimated.

### 4. Hardcoded Roughness Baseline Priors (12.5, 38.0, 42.0)
* **Value:** `isSafePreset ? 12.5 : 38.0`
* **File:** `web/src/lib/routing/osrmEngine.ts:243-247`
* **Current Source:** Default ternary operator when `matchedCells === 0`.
* **Classification:** Hardcoded Prior
* **User-Facing:** Yes — yields artificial smoothness scores (e.g., 87%) on routes with zero observation history.
* **Required Change:** When `matchedCells === 0`, set `avgRoughness: null`, `smoothnessScore: null`, `coverageStatus: 'unmapped'`. UI must display "Insufficient data" or "Unobserved", not a fabricated score.

### 5. Forced Zero Potholes and Capped Low Roughness for Safe Route
* **Value:** `if (isSafePreset) { defectHits = 0; avgRoughness = Math.min(avgRoughness, 14.2); }`
* **File:** `web/src/lib/routing/osrmEngine.ts:249-252`
* **Current Source:** Preset-specific override logic.
* **Classification:** Forced / Fabricated
* **User-Facing:** Yes — guarantees Safe route reports 0 defects and low roughness even if telemetry reports severe defects or has no data.
* **Required Change:** Remove forced overrides. Safe route metrics must reflect actual H3 cell data and defects traversed by the route.

### 6. Fabricated Balanced Route Defects & Smoothness
* **Value:** `potholesHit: Math.max(0, Math.min(2, Math.floor(fastStats.potholesHit / 2)))` and `smoothnessScore: Math.min(92, Math.max(78, Math.round((safeStats.smoothnessScore + fastStats.smoothnessScore) / 2 + 6)))`
* **File:** `web/src/lib/routing/osrmEngine.ts:360-361`
* **Current Source:** Mathematical blending of other routes' stats.
* **Classification:** Hardcoded / Fabricated Formula
* **User-Facing:** Yes — synthetic defect count and smoothness score.
* **Required Change:** Compute balanced route metrics directly and independently from its own intersected H3 cells and defects.

### 7. Flawed Coverage Percentage
* **Value:** `coveragePct = Math.min(100, Math.round((matchedCells / Math.max(1, polyline.length)) * 100))`
* **File:** `web/src/lib/routing/osrmEngine.ts:258`
* **Current Source:** Vertex count ratio.
* **Classification:** Derived (Flawed Logic)
* **User-Facing:** Yes — displays misleading coverage percentages (e.g., "76% Verified").
* **Required Change:** Map route geometry into unique H3-12 cells. Compute coverage as `(matchedUniqueCells / totalUniqueRouteCells) * 100`.

### 8. Static Claims of "0 Potholes" in Legend and Descriptions
* **Value:** `"Zero severe pothole exposure"`, `"Safe Route (0 Potholes)"`
* **File:** `web/src/lib/routing/osrmEngine.ts:330`, `web/src/app/routing/page.tsx:492`
* **Current Source:** Static copy.
* **Classification:** Hardcoded String
* **User-Facing:** Yes.
* **Required Change:** Update copy to dynamic text based on actual observation evidence or neutral descriptive labels (e.g., "Optimized for road smoothness based on fleet telemetry").

### 9. Arbitrary 1000 Cell Limit on Routing Page Load
* **Value:** `supabase.from('road_cells').select('*').limit(1000)`
* **File:** `web/src/app/routing/page.tsx:51`
* **Current Source:** Unfiltered query with static limit 1000.
* **Classification:** Sub-optimal Query
* **User-Facing:** No direct display, but risks dropping cells along routes if database exceeds 1000 records.
* **Required Change:** Query Supabase with `in('h3_12', routeH3Cells)` for the specific cells traversed by candidate routes, or fetch relevant bounding cells.

---

## Action Plan for Subsequent Agents

1. **Agent 2 — Routing (`fix/routing`)**:
   - Refactor `osrmEngine.ts` to request real alternative routes from OSRM (`alternatives=true` or via distinct street-level waypoints).
   - Strictly extract geometry, distance, and duration from OSRM responses.
   - Delete `generateFallbackStreetPath` and synthetic distance/duration formulas.
   - Handle routing failures gracefully with an explicit error state (`Routing unavailable`) without synthetic geometry.

2. **Agent 3 — Road Intelligence (`fix/road-intelligence`)**:
   - Implement true H3 route sampling: convert route polyline to a set of deduplicated H3-12 cells traversed.
   - Query Supabase `road_cells` and `road_defects` for the specific H3 cells along the route.
   - Compute road metrics (roughness, potholes, coverage) strictly from matched observations.
   - When cells have no observations: return `null` / `Insufficient data`. Remove baseline roughness priors (12.5, 38.0, 42.0) and forced zero defects.
   - Update UI in `routing/page.tsx` to handle `null` / "Insufficient data" states gracefully and display truthful metrics.

3. **Agent 4 — Final Integration (`test/live-data-integration`)**:
   - Run typecheck, unit tests, and build.
   - Run static grep checks to verify zero fabricated multipliers and fake geometry generators remain.
   - Verify full end-to-end telemetry and routing pipeline.
