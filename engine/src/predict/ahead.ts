/**
 * Hazard prediction — ENGINE-PLAN §7.4. "The 'predict' half of the brief, and it
 * needs no training data."
 *
 * Project the vehicle's path forward, collect the H3 cells the cone covers, and
 * warn about known defects and rough segments inside it. Everything here is
 * deterministic geometry against the fleet map built in §7.
 *
 * The plan is candid about the limitation and so is this file:
 * "Straight-line-with-cone projection is crude on curves — it will over-predict
 * into buildings on a bend. v2 snaps to OSM ways and follows road geometry. State
 * that limitation rather than hiding it." Every prediction carries that caveat in
 * its own record.
 */

import { latLngToCell } from 'h3-js';
import type { Prediction, Sample } from '../types.js';
import { Flags } from '../types.js';
import type { Thresholds } from '../config/thresholds.js';
import type { DeviceState } from '../domain/state.js';
import { DEG2RAD } from '../config/thresholds.js';
import { predictionId } from '../util/hash.js';
import { cellKey, type RoadMap } from '../arbitrate/roadmap.js';
import type { RoadDefect } from '../types.js';

const EARTH_R = 6371000;

/**
 * Move a lat/lon by `distanceM` along `bearingDeg` — standard great-circle
 * destination formula. Accurate to well under a metre at these distances.
 */
export function project(
  lat: number,
  lon: number,
  bearingDeg: number,
  distanceM: number,
): { lat: number; lon: number } {
  const d = distanceM / EARTH_R;
  const b = bearingDeg * DEG2RAD;
  const p1 = lat * DEG2RAD;
  const l1 = lon * DEG2RAD;
  const sinP1 = Math.sin(p1);
  const cosP1 = Math.cos(p1);
  const sinD = Math.sin(d);
  const cosD = Math.cos(d);

  const sinP2 = sinP1 * cosD + cosP1 * sinD * Math.cos(b);
  const p2 = Math.asin(Math.max(-1, Math.min(1, sinP2)));
  const l2 = l1 + Math.atan2(sinD * Math.sin(b) * cosP1, cosD - sinP1 * sinP2);

  return { lat: p2 / DEG2RAD, lon: ((l2 / DEG2RAD + 540) % 360) - 180 };
}

export interface ConeCell {
  h3: string;
  /** Along-track distance from the vehicle, metres. */
  distanceM: number;
}

/**
 * The look-ahead cone as a set of H3 cells — §7.4 steps 1-3.
 *
 * The cone widens with distance (±10° at 50 m → ±25° at 400 m) to tolerate road
 * curvature: a straight ray would miss a defect just around a bend, and a fixed
 * wide angle would warn about everything in the neighbourhood.
 *
 * Nearest-first, deduplicated, so a caller warning about the closest hazard does
 * not have to sort.
 */
export function coneCells(
  lat: number,
  lon: number,
  headingDeg: number,
  speedMps: number,
  cfg: Thresholds,
): ConeCell[] {
  const p = cfg.predict;
  const horizon = Math.max(p.minHorizonM, Math.min(p.maxHorizonM, speedMps * p.horizonS));

  const seen = new Map<string, number>();
  for (let d = p.stepM; d <= horizon; d += p.stepM) {
    // Linear interpolation of the half-angle between the near and far ends.
    const frac = (d - p.minHorizonM) / Math.max(p.maxHorizonM - p.minHorizonM, 1);
    const halfAngle =
      p.coneNearDeg + (p.coneFarDeg - p.coneNearDeg) * Math.max(0, Math.min(1, frac));

    // Enough lateral rays that the arc is sampled at roughly the cell size, so a
    // defect cannot slip between two rays.
    const arcM = 2 * d * Math.tan(halfAngle * DEG2RAD);
    const rays = Math.max(1, Math.ceil(arcM / p.stepM));

    for (let k = -rays; k <= rays; k++) {
      const bearing = headingDeg + (halfAngle * k) / rays;
      const pt = project(lat, lon, bearing, d);
      let h3: string;
      try {
        h3 = latLngToCell(pt.lat, pt.lon, cfg.roadmap.h3Resolution);
      } catch {
        continue;
      }
      const prev = seen.get(h3);
      if (prev === undefined || d < prev) seen.set(h3, d);
    }
  }

  return [...seen.entries()]
    .map(([h3, distanceM]) => ({ h3, distanceM }))
    .sort((a, b) => a.distanceM - b.distanceM);
}

export interface PredictInput {
  sample: Sample;
  state: DeviceState;
  map: RoadMap;
  /** Known defects, keyed `h3:sector`. */
  defects: Map<string, RoadDefect>;
  cfg: Thresholds;
}

/**
 * Issue predictions for one sample — §7.4 steps 4-6.
 *
 * Returns at most one prediction per target cell per trip; §7.4 step 6 requires
 * deduplication ("never re-issue the same (device, defect) within one trip"),
 * because a vehicle approaching a pothole sees it in the cone for ~15 consecutive
 * seconds and 15 identical warnings is noise, not a forecast.
 */
export function predictAhead(input: PredictInput): Prediction[] {
  const { sample: s, state: st, map, defects, cfg } = input;

  if (s.lat === null || s.lon === null) return [];
  if ((s.flags & Flags.GPS_USABLE) === 0) return [];
  if (!Number.isFinite(s.heading)) return [];
  // A stationary vehicle has no meaningful heading and nothing to be warned about.
  if (!(s.speed > cfg.gps.minSpeedForDynamics)) return [];

  // One prediction pass per second of resolved time; the cone is stable over
  // shorter intervals and recomputing it adds cost without adding information.
  if (st.lastPredictTSec !== null && s.tSec - st.lastPredictTSec < 1) return [];
  st.lastPredictTSec = s.tSec;

  const sector = map.sectorOf(s.heading);
  const cells = coneCells(s.lat, s.lon, s.heading, s.speed, cfg);
  const roughThreshold = map.roughnessQuantile(cfg.predict.roughTopFraction);

  const out: Prediction[] = [];

  for (const { h3, distanceM } of cells) {
    const key = cellKey(h3, sector);

    // §7.4 step 6 — one warning per target per trip.
    if (st.predictedCells.has(key)) continue;

    const etaS = distanceM / Math.max(s.speed, 0.1);

    // -- known defect (step 4, first half) --------------------------------
    const defect = defects.get(key);
    if (defect !== undefined && defect.status === 'active' && defect.confidence >= cfg.predict.minDefectConfidence) {
      st.predictedCells.add(key);
      out.push({
        id: predictionId(s.deviceId, s.tSec, h3, 'road.hazard_ahead'),
        deviceId: s.deviceId,
        tripId: st.trip?.id ?? null,
        issuedAt: s.tSec,
        type: 'road.hazard_ahead',
        targetDefectId: defect.id,
        targetH3_12: h3,
        distanceM: Number.parseFloat(distanceM.toFixed(1)),
        etaS: Number.parseFloat(etaS.toFixed(2)),
        confidence: defect.confidence,
        outcome: 'pending',
        outcomeEventId: null,
        outcomeCheckedAt: null,
      });
      continue;
    }

    // -- rough segment (step 4, second half) ------------------------------
    const roughness = map.roughnessIndex(h3, sector);
    if (
      roughThreshold !== null &&
      roughness !== null &&
      roughness >= roughThreshold &&
      map.passCount(h3, sector) >= 3
    ) {
      st.predictedCells.add(key);
      out.push({
        id: predictionId(s.deviceId, s.tSec, h3, 'road.rough_segment_ahead'),
        deviceId: s.deviceId,
        tripId: st.trip?.id ?? null,
        issuedAt: s.tSec,
        type: 'road.rough_segment_ahead',
        targetDefectId: null,
        targetH3_12: h3,
        distanceM: Number.parseFloat(distanceM.toFixed(1)),
        etaS: Number.parseFloat(etaS.toFixed(2)),
        // Roughness is weaker evidence than a confirmed defect, and the
        // confidence must say so.
        confidence: Number.parseFloat(Math.min(0.75, 0.4 + roughness / 200).toFixed(3)),
        outcome: 'pending',
        outcomeEventId: null,
        outcomeCheckedAt: null,
      });
    }
  }

  return out;
}

/**
 * The v1 limitation, attached to every prediction batch for the report.
 *
 * §7.4: "Straight-line-with-cone projection is crude on curves — it will
 * over-predict into buildings on a bend. v2 snaps to OSM ways and follows road
 * geometry. State that limitation rather than hiding it."
 */
export const PREDICTION_LIMITATION =
  'straight-line cone projection; over-predicts on bends because it does not follow road geometry (§7.4). v2: snap to OSM ways.';
