/**
 * Speeding — ENGINE-PLAN §6.5.
 *
 * There are no speed limits in this data. §2.7 rates absolute speeding
 * "⚠️ no ground truth", so the plan offers two variants that are defensible
 * without a map, and both are **self-referential by construction** — the norm is
 * derived from the same fleet being judged against it. The plan says to say so
 * in the report, so the detector says so on every event it emits.
 *
 * The fleet statistics live in the road map (§7), which is a different layer.
 * Rather than reach into it, this module accepts a narrow lookup interface. When
 * no lookup is installed it emits nothing — a missing road map must never
 * silently become "nobody was speeding".
 */

import type { EventCandidate, EventSeverity } from '../types.js';
import { Flags } from '../types.js';
import type { Detector, DetectorContext } from './context.js';
import { baseCandidate, clamp01 } from './context.js';
import { headingSector } from '../domain/state.js';

/**
 * What the speeding detectors need from the fleet road map.
 *
 * Deliberately minimal: four scalars keyed by cell. `src/arbitrate/roadmap.ts`
 * implements this; nothing here depends on how the map is stored.
 */
export interface CellStatsLookup {
  p85SpeedKmh(h3: string, sector: number): number | null;
  passCount(h3: string, sector: number): number;
  deviceCount(h3: string, sector: number): number;
  roughnessIndex(h3: string, sector: number): number | null;
  fleetMedianRoughness(): number | null;
}

/** The null lookup: no map, no evidence, no events. */
export const NULL_CELL_STATS: CellStatsLookup = {
  p85SpeedKmh: () => null,
  passCount: () => 0,
  deviceCount: () => 0,
  roughnessIndex: () => null,
  fleetMedianRoughness: () => null,
};

let cellStats: CellStatsLookup = NULL_CELL_STATS;

/**
 * Install the fleet-statistics lookup. Called once at wiring time.
 *
 * A module-level provider rather than a `DetectorContext` field so the detector
 * signature stays `(ctx) => EventCandidate[]` for every detector (§5), and so the
 * replay harness can run detectors with no road map at all.
 */
export function setCellStats(lookup: CellStatsLookup | null): void {
  cellStats = lookup ?? NULL_CELL_STATS;
}

export function getCellStats(): CellStatsLookup {
  return cellStats;
}

/** h3 index for a sample, or null when it has no usable position. */
function cellFor(ctx: DetectorContext): { h3: string; sector: number } | null {
  const s = ctx.sample;
  if (s.lat === null || s.lon === null) return null;
  if ((s.flags & Flags.GPS_USABLE) === 0) return null;
  if (!Number.isFinite(s.heading)) return null;
  // h3-js is imported lazily by the caller that owns spatial indexing; here we
  // only need the id, which normalize does not compute. The road map layer
  // supplies it through `ctx.sample`-adjacent state when available.
  const h3 = ctx.state.lastH3;
  if (h3 === null) return null;
  return { h3, sector: headingSector(s.heading, ctx.cfg.roadmap.headingSectors) };
}

function bandFor(excess: number, ctx: DetectorContext): EventSeverity | null {
  const b = ctx.cfg.speed.bands;
  if (excess >= b.high) return 'high';
  if (excess >= b.medium) return 'medium';
  if (excess >= b.low) return 'low';
  return null;
}

export const speedDetector: Detector = {
  name: 'speed',
  run(ctx: DetectorContext): EventCandidate[] {
    const s = ctx.sample;
    const cfg = ctx.cfg;

    if ((s.flags & Flags.GPS_USABLE) === 0) return [];
    if (!Number.isFinite(s.speed) || s.speed < cfg.gps.minSpeedForDynamics) return [];

    const cell = cellFor(ctx);
    if (cell === null) return [];

    const stats = cellStats;
    const passes = stats.passCount(cell.h3, cell.sector);
    const devices = stats.deviceCount(cell.h3, cell.sector);

    // §6.5: "Requires >= 20 passes from >= 3 distinct devices before the cell is
    // usable; below that, emit nothing." Thin evidence is not weak evidence, it
    // is no evidence — and one device cannot establish its own norm.
    if (passes < cfg.speed.minPassesForNorm || devices < cfg.speed.minDevicesForNorm) return [];

    const p85 = stats.p85SpeedKmh(cell.h3, cell.sector);
    if (p85 === null || !(p85 > 0)) return [];

    const speedKmh = s.speed * 3.6;
    const excess = (speedKmh - p85) / p85;
    if (excess < cfg.speed.relativeMargin) return [];

    const severity = bandFor(excess, ctx);
    if (severity === null) return [];

    const out: EventCandidate[] = [];
    const sharedEvidence = {
      speed_kmh: Number.parseFloat(speedKmh.toFixed(2)),
      cell_p85_kmh: Number.parseFloat(p85.toFixed(2)),
      excess_fraction: Number.parseFloat(excess.toFixed(4)),
      cell_passes: passes,
      cell_devices: devices,
      h3_12: cell.h3,
      heading_sector: cell.sector,
      min_passes_for_norm: cfg.speed.minPassesForNorm,
      min_devices_for_norm: cfg.speed.minDevicesForNorm,
      limitation:
        'no speed limits exist in this data (§2.7). The norm is the fleet p85 for this cell, so the measure is self-referential by construction (§6.5). v2 replaces it with OSM maxspeed.',
      time_quality: s.timeQuality,
    };

    out.push(
      baseCandidate(ctx, {
        type: 'driver.speeding_relative',
        category: 'driver',
        severity,
        confidence: clamp01(0.4 + 0.3 * clamp01(excess / cfg.speed.bands.high) + (devices >= 5 ? 0.1 : 0)),
        magnitude: Number.parseFloat(speedKmh.toFixed(2)),
        magnitudeUnit: 'km/h',
        h3_12: cell.h3,
        headingSector: cell.sector,
        evidence: { rule: '§6.5 speeding_relative: above the cell fleet p85', ...sharedEvidence },
      }),
    );

    // -----------------------------------------------------------------------
    // Speeding for conditions (§6.5) — "speed above the p85 *and* the cell's
    // roughness_index above the fleet median. Defensible without any map data."
    //
    // This is the stronger of the two claims: it does not assert a limit, only
    // that this speed is unusual *for a surface this rough*.
    // -----------------------------------------------------------------------
    const roughness = stats.roughnessIndex(cell.h3, cell.sector);
    const medianRough = stats.fleetMedianRoughness();
    if (roughness !== null && medianRough !== null && roughness > medianRough) {
      out.push(
        baseCandidate(ctx, {
          type: 'driver.speeding_for_conditions',
          category: 'driver',
          severity,
          confidence: clamp01(0.55 + 0.3 * clamp01(excess / cfg.speed.bands.high)),
          magnitude: Number.parseFloat(speedKmh.toFixed(2)),
          magnitudeUnit: 'km/h',
          h3_12: cell.h3,
          headingSector: cell.sector,
          evidence: {
            rule: '§6.5 speeding_for_conditions: above p85 on a rougher-than-median surface',
            ...sharedEvidence,
            cell_roughness_index: Number.parseFloat(roughness.toFixed(2)),
            fleet_median_roughness: Number.parseFloat(medianRough.toFixed(2)),
          },
        }),
      );
    }

    return out;
  },
};

export default speedDetector;
