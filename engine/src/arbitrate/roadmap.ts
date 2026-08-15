/**
 * Fleet road map — ENGINE-PLAN §7.1 and §7.2.
 *
 * Every pass over a cell contributes one observation. The map is what turns a
 * single vehicle's bump into fleet knowledge, and it is the evidence base that
 * §7.3 arbitration uses to decide whether an impact was the road's fault or the
 * driver's. Without it, the fairness claim has nothing to stand on.
 *
 * Two things here are easy to get wrong and both are called out in the plan:
 *
 *  1. Speed normalisation (§7.2, "the step everyone forgets"). Vertical vibration
 *     rises with speed over the same surface, so comparing raw RMS across passes
 *     makes a queue of slow traffic look like fresh tarmac.
 *
 *  2. Resolution vs position error (§7.1). Res 12 is ~9 m — pothole scale — but
 *     GPS error is 2.5-5 m and the reported fix is the *last* of the second, so at
 *     60 km/h the vehicle moved up to 16.7 m during the window. The answer is to
 *     index fine and QUERY the k-ring, not to coarsen the cells.
 */

import { cellToLatLng, gridDisk, latLngToCell } from 'h3-js';
import type { RoadCell, Sample } from '../types.js';
import { Flags } from '../types.js';
import type { Thresholds } from '../config/thresholds.js';
import { headingSector } from '../domain/state.js';
import type { CellStatsLookup } from '../detect/speed.js';

/** Composite key for a directional cell. */
export function cellKey(h3: string, sector: number): string {
  return `${h3}:${sector}`;
}

/**
 * Speed-normalise a vertical RMS to the reference speed — §7.2, authoritative copy.
 *
 *   rms_norm = rms_obs · (v_ref / max(v_obs, v_floor))^β
 *
 * β is 1.0 initially. §7.2 asks for it to be "fitted empirically per fleet from
 * passes over the same cell at differing speeds — this is a genuine, reportable
 * calibration result". `fitBeta` below does that fit.
 */
export function speedNormalise(rms: number, speedMps: number, cfg: Thresholds): number {
  if (!Number.isFinite(rms)) return NaN;
  const { speedRefMps, speedFloorMps, beta } = cfg.roadmap;
  const v = Math.max(Number.isFinite(speedMps) ? speedMps : 0, speedFloorMps);
  return rms * Math.pow(speedRefMps / v, beta);
}

/**
 * Fit the speed-roughness exponent β by least squares on log-log data — §7.2.
 *
 * Model: rms = C · v^(-β)  →  log(rms) = log C - β·log v
 *
 * So the slope of log(rms) against log(v) is -β. Pass in observations of the SAME
 * cell at differing speeds; mixing cells fits surface variation instead of the
 * speed relationship. Returns null when the speed spread is too narrow for the
 * slope to mean anything — an honest refusal beats a fitted number from noise.
 */
export function fitBeta(
  observations: { rms: number; speedMps: number }[],
  minSpread = 1.5,
): { beta: number; n: number; r2: number } | null {
  const pts = observations
    .filter((o) => Number.isFinite(o.rms) && o.rms > 0 && o.speedMps > 0)
    .map((o) => ({ x: Math.log(o.speedMps), y: Math.log(o.rms) }));
  if (pts.length < 4) return null;

  const xs = pts.map((p) => p.x);
  const spread = Math.max(...xs) - Math.min(...xs);
  if (spread < Math.log(minSpread)) return null;

  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;

  // Coefficient of determination, so a reader can judge whether the fit is real.
  let ssRes = 0;
  let ssTot = 0;
  for (const p of pts) {
    const pred = my + slope * (p.x - mx);
    ssRes += (p.y - pred) ** 2;
    ssTot += (p.y - my) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { beta: -slope, n, r2 };
}

interface CellRecord extends RoadCell {
  /** Device ids seen on this cell — the §7.3 consensus guard needs the count. */
  devices: Set<string>;
  /** Bounded speed reservoir for the p85 norm (§6.5). */
  speeds: number[];
}

const SPEED_RESERVOIR = 64;

/**
 * In-memory fleet road map.
 *
 * Loaded from `road_cells` at startup and flushed back through the sink. Held in
 * memory because arbitration and prediction both query it on every row, and a DB
 * round trip per row at 1 Hz per device would dominate the latency budget (§5).
 */
export class RoadMap implements CellStatsLookup {
  private readonly cells = new Map<string, CellRecord>();
  private readonly cfg: Thresholds;
  /** Cached fleet median roughness, invalidated on write. */
  private medianCache: number | null = null;
  private medianDirty = true;

  constructor(cfg: Thresholds) {
    this.cfg = cfg;
  }

  /** H3 index for a position at the configured resolution. */
  indexOf(lat: number, lon: number): string {
    return latLngToCell(lat, lon, this.cfg.roadmap.h3Resolution);
  }

  sectorOf(headingDeg: number): number {
    return headingSector(headingDeg, this.cfg.roadmap.headingSectors);
  }

  size(): number {
    return this.cells.size;
  }

  get(h3: string, sector: number): RoadCell | null {
    return this.cells.get(cellKey(h3, sector)) ?? null;
  }

  /** Hydrate from persisted rows at startup. */
  load(rows: (RoadCell & { deviceIds?: string[]; speeds?: number[] })[]): void {
    for (const r of rows) {
      this.cells.set(cellKey(r.h3_12, r.headingSector), {
        ...r,
        devices: new Set(r.deviceIds ?? []),
        speeds: (r.speeds ?? []).slice(-SPEED_RESERVOIR),
      });
    }
    this.medianDirty = true;
  }

  private ensure(h3: string, sector: number, lat: number, lon: number): CellRecord {
    const key = cellKey(h3, sector);
    let c = this.cells.get(key);
    if (c === undefined) {
      // Use the cell centroid rather than the observation position: the cell is
      // the unit of truth, and successive passes would otherwise jitter it.
      let cLat = lat;
      let cLon = lon;
      try {
        const [la, lo] = cellToLatLng(h3);
        cLat = la;
        cLon = lo;
      } catch {
        /* keep the observed position if h3 cannot resolve the centroid */
      }
      c = {
        h3_12: h3,
        headingSector: sector,
        centroidLat: cLat,
        centroidLon: cLon,
        passCount: 0,
        deviceCount: 0,
        spikeCount: 0,
        roughMean: 0,
        roughM2: 0,
        roughnessIndex: null,
        defectConfidence: 0,
        lastPassAt: null,
        speedP85Kmh: null,
        devices: new Set(),
        speeds: [],
      };
      this.cells.set(key, c);
    }
    return c;
  }

  /**
   * Record one pass over a cell.
   *
   * Returns the updated cell, or null when the sample carries no usable
   * roughness information — §7.2: "Discard passes below ~15 km/h entirely; they
   * carry almost no roughness information."
   */
  observe(s: Sample, spiked: boolean): RoadCell | null {
    if (s.lat === null || s.lon === null) return null;
    if ((s.flags & Flags.GPS_USABLE) === 0) return null;
    if (!Number.isFinite(s.heading)) return null;

    // §2.5: without calibration the vertical channel is meaningless, so it must
    // not enter the fleet map. Position is still fine, but a roughness statistic
    // built from an unknown gravity vector would poison every future comparison.
    if ((s.flags & Flags.ACCEL_VALID) === 0) return null;
    if (!Number.isFinite(s.vertRms)) return null;
    if (s.speed < this.cfg.roadmap.minPassSpeedMps) return null;

    const h3 = this.indexOf(s.lat, s.lon);
    const sector = this.sectorOf(s.heading);
    const c = this.ensure(h3, sector, s.lat, s.lon);

    const normRms = speedNormalise(s.vertRms, s.speed, this.cfg);
    if (!Number.isFinite(normRms)) return null;

    // Welford's online variance (§4 `rough_mean` / `rough_m2`): numerically
    // stable and O(1) in memory, so a cell needs no history to report a variance.
    c.passCount += 1;
    const delta = normRms - c.roughMean;
    c.roughMean += delta / c.passCount;
    c.roughM2 += delta * (normRms - c.roughMean);

    if (spiked) c.spikeCount += 1;
    c.devices.add(s.deviceId);
    c.deviceCount = c.devices.size;
    c.lastPassAt = s.tSec;

    // Bounded reservoir for the p85 speed norm (§6.5).
    c.speeds.push(s.speed * 3.6);
    if (c.speeds.length > SPEED_RESERVOIR) c.speeds.shift();
    c.speedP85Kmh = percentile(c.speeds, 0.85);

    // Roughness index, 0..100 — the IRI proxy of §4.
    c.roughnessIndex = Math.max(
      0,
      Math.min(100, (c.roughMean / this.cfg.roadmap.roughnessScale) * 100),
    );

    this.medianDirty = true;
    return c;
  }

  /**
   * Find the best-matching cell for a position, searching the k-ring — §7.1.
   *
   * "index at res 12, but query the k-ring of radius 1 (7 cells) and take the
   * best match. This is why the resolution is not simply coarsened — coarse cells
   * would smear two adjacent potholes into one and destroy the localisation that
   * makes the maintenance output useful."
   *
   * "Best" = most evidence (passes), because that is the cell whose verdict is
   * most trustworthy. The exact cell wins ties.
   */
  matchCell(lat: number, lon: number, headingDeg: number): RoadCell | null {
    const sector = this.sectorOf(headingDeg);
    const exact = this.indexOf(lat, lon);

    const direct = this.cells.get(cellKey(exact, sector));
    if (direct !== undefined && direct.passCount > 0) return direct;

    let best: CellRecord | null = null;
    let ring: string[] = [];
    try {
      ring = gridDisk(exact, this.cfg.roadmap.kRing);
    } catch {
      return null;
    }
    for (const h of ring) {
      const c = this.cells.get(cellKey(h, sector));
      if (c === undefined) continue;
      if (best === null || c.passCount > best.passCount) best = c;
    }
    return best;
  }

  /** Every cell, for flushing to the sink. */
  all(): RoadCell[] {
    return [...this.cells.values()];
  }

  /** Device ids per cell, so the sink can persist the consensus evidence. */
  deviceIdsOf(h3: string, sector: number): string[] {
    const c = this.cells.get(cellKey(h3, sector));
    return c === undefined ? [] : [...c.devices];
  }

  // -------------------------------------------------------------------------
  // CellStatsLookup — what the §6.5 speeding detectors consume.
  // -------------------------------------------------------------------------

  p85SpeedKmh(h3: string, sector: number): number | null {
    return this.cells.get(cellKey(h3, sector))?.speedP85Kmh ?? null;
  }

  passCount(h3: string, sector: number): number {
    return this.cells.get(cellKey(h3, sector))?.passCount ?? 0;
  }

  deviceCount(h3: string, sector: number): number {
    return this.cells.get(cellKey(h3, sector))?.deviceCount ?? 0;
  }

  roughnessIndex(h3: string, sector: number): number | null {
    return this.cells.get(cellKey(h3, sector))?.roughnessIndex ?? null;
  }

  /** Fleet median roughness — the reference for `speeding_for_conditions`. */
  fleetMedianRoughness(): number | null {
    if (!this.medianDirty) return this.medianCache;
    const vals: number[] = [];
    for (const c of this.cells.values()) {
      if (c.roughnessIndex !== null && c.passCount > 0) vals.push(c.roughnessIndex);
    }
    this.medianCache = vals.length === 0 ? null : percentile(vals, 0.5);
    this.medianDirty = false;
    return this.medianCache;
  }

  /**
   * Roughness threshold for the top fraction of the fleet — used by §7.4 to warn
   * about rough segments ahead.
   */
  roughnessQuantile(fraction: number): number | null {
    const vals: number[] = [];
    for (const c of this.cells.values()) {
      if (c.roughnessIndex !== null && c.passCount >= 3) vals.push(c.roughnessIndex);
    }
    return vals.length === 0 ? null : percentile(vals, fraction);
  }
}

/** Linear-interpolated percentile. `p` in 0..1. */
export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  if (v.length === 1) return v[0]!;
  const idx = (v.length - 1) * Math.max(0, Math.min(1, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return v[lo]! * (1 - w) + v[hi]! * w;
}

/** Sample standard deviation of a cell's normalised roughness (Welford). */
export function cellStdDev(c: RoadCell): number | null {
  if (c.passCount < 2) return null;
  return Math.sqrt(c.roughM2 / (c.passCount - 1));
}
