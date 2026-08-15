/**
 * Defect arbitration — ENGINE-PLAN §7.3. The project's central contribution.
 *
 * An impact candidate arrives with no blame attached (§6.4 forbids the detector
 * from deciding). This module answers the question the whole dissertation is
 * about: was that bump the road's fault, or the driver's?
 *
 * The answer is fleet consensus. If three or more vehicles hit the same thing in
 * the same direction, it is a pothole and no driver should lose points for it. If
 * everyone else drives the same cell cleanly and this driver did not, that is
 * driving. §7.3 sets the exact bounds, and this file must not invent others.
 *
 * Two guards matter more than the thresholds:
 *
 *  - `distinct_devices >= 3`. §7.3: "never let one device establish consensus
 *    alone" — otherwise a driver who habitually hits the same pothole on their
 *    daily commute becomes the majority of passes and excuses their own damage.
 *
 *  - UNDECIDED is a real, first-class outcome. A new fleet has no consensus, so
 *    early impacts must sit unattributed rather than defaulting to the driver's
 *    fault. Defaulting to blame would make the engine unfair exactly when it has
 *    the least evidence.
 */

import type {
  ArbitrationResult,
  ArbitrationVerdict,
  EventCandidate,
  EventSeverity,
  RoadCell,
  RoadDefect,
} from '../types.js';
import type { Thresholds } from '../config/thresholds.js';
import { defectId } from '../util/hash.js';
import { cellStdDev, type RoadMap } from './roadmap.js';

/**
 * Decide what a cell's evidence says, independent of any single event.
 *
 * Pure and total: every input produces a verdict, and thin evidence produces
 * `undecided` rather than a guess.
 */
export function arbitrateCell(cell: RoadCell | null, cfg: Thresholds): ArbitrationResult {
  if (cell === null || cell.passCount === 0) {
    return {
      verdict: 'undecided',
      distinctDevices: 0,
      spikeRate: 0,
      passCount: 0,
      matchedCell: null,
      confidence: 0,
    };
  }

  const spikeRate = cell.spikeCount / cell.passCount;
  const devices = cell.deviceCount;
  const base = {
    distinctDevices: devices,
    spikeRate,
    passCount: cell.passCount,
    matchedCell: cell.h3_12,
  };

  // The consensus guard. Below three devices we cannot distinguish "bad road"
  // from "one driver who does this repeatedly", so we decline to decide.
  if (devices < cfg.arbitration.minDistinctDevices) {
    return { ...base, verdict: 'undecided', confidence: 0 };
  }

  if (spikeRate >= cfg.arbitration.roadSpikeRate) {
    return { ...base, verdict: 'road_defect', confidence: defectConfidence(spikeRate, devices, cfg) };
  }

  if (spikeRate <= cfg.arbitration.driverSpikeRate) {
    // Most of the fleet passes this cell cleanly, so the road is not the
    // explanation. Confidence rises as the counter-evidence accumulates.
    const cleanliness = 1 - spikeRate / Math.max(cfg.arbitration.driverSpikeRate, 1e-9);
    const evidence = Math.min(1, cell.passCount / (cfg.speed.minPassesForNorm || 20));
    return {
      ...base,
      verdict: 'driver_event',
      confidence: clamp(0.5 + 0.35 * cleanliness * evidence, 0, 0.95),
    };
  }

  // 0.25 < spike_rate < 0.60 — genuinely ambiguous. Say so.
  return { ...base, verdict: 'undecided', confidence: 0 };
}

/**
 * `confidence = f(spike_rate, device_count)` per §7.3.
 *
 * Rises with how consistently the cell spikes and with how many independent
 * witnesses agree, saturating so no cell ever claims certainty.
 */
export function defectConfidence(spikeRate: number, devices: number, cfg: Thresholds): number {
  const rateTerm = clamp(
    (spikeRate - cfg.arbitration.roadSpikeRate) / (1 - cfg.arbitration.roadSpikeRate),
    0,
    1,
  );
  // Diminishing returns past the minimum: the 4th witness adds much less than
  // the 3rd, and the 20th adds nothing meaningful.
  const witnessTerm = clamp(
    Math.log(1 + devices - cfg.arbitration.minDistinctDevices) / Math.log(8),
    0,
    1,
  );
  return clamp(0.6 + 0.25 * rateTerm + 0.15 * witnessTerm, 0, 0.98);
}

function severityFromRoughness(cell: RoadCell, spikeRate: number): EventSeverity {
  const idx = cell.roughnessIndex ?? 0;
  if (spikeRate >= 0.85 && idx >= 60) return 'critical';
  if (spikeRate >= 0.75 || idx >= 45) return 'high';
  if (spikeRate >= 0.65 || idx >= 25) return 'medium';
  return 'low';
}

export interface AttributionOutcome {
  /** The candidate, rewritten in place of the original. */
  event: EventCandidate;
  result: ArbitrationResult;
  /** Present when the verdict was `road_defect`. */
  defect: RoadDefect | null;
}

/**
 * Turn an unattributed impact candidate into a final, attributed event.
 *
 * This is the single code path §6.4 insists on: both outcomes are produced here,
 * from the same inputs, by the same function. A reader can see that the road and
 * driver verdicts are not handled by different, differently-biased code.
 */
export function attributeImpact(
  candidate: EventCandidate,
  map: RoadMap,
  cfg: Thresholds,
  nowTSec: number,
): AttributionOutcome {
  const lat = candidate.lat;
  const lon = candidate.lon;
  const heading = candidate.headingSector;

  // Without a position there is no cell, so there can be no consensus. Leave the
  // candidate undecided rather than defaulting to blame.
  const cell =
    lat !== null && lon !== null
      ? map.matchCell(lat, lon, sectorToHeading(heading, cfg))
      : null;

  const result = arbitrateCell(cell, cfg);
  const event: EventCandidate = { ...candidate };

  if (cell !== null) {
    event.h3_12 = cell.h3_12;
    event.headingSector = cell.headingSector;
  }

  const sharedEvidence = {
    ...event.evidence,
    awaiting_arbitration: false,
    arbitration: {
      rule: '§7.3 fleet consensus on (h3_12, heading_sector), k-ring 1',
      verdict: result.verdict,
      distinct_devices: result.distinctDevices,
      spike_rate: Number.parseFloat(result.spikeRate.toFixed(4)),
      pass_count: result.passCount,
      matched_cell: result.matchedCell,
      thresholds: {
        min_distinct_devices: cfg.arbitration.minDistinctDevices,
        road_spike_rate: cfg.arbitration.roadSpikeRate,
        driver_spike_rate: cfg.arbitration.driverSpikeRate,
      },
      cell_roughness_index: cell?.roughnessIndex ?? null,
      cell_roughness_stddev: cell === null ? null : cellStdDev(cell),
    },
  };

  if (result.verdict === 'road_defect' && cell !== null) {
    event.type = 'road.defect_observation';
    event.category = 'road';
    // The fairness claim, in one assignment.
    event.attributedToDriver = false;
    event.severity = severityFromRoughness(cell, result.spikeRate);
    event.confidence = result.confidence;
    event.roadDefectId = defectId(cell.h3_12, cell.headingSector);
    event.evidence = {
      ...sharedEvidence,
      conclusion:
        'the fleet consistently spikes here, so this is a road defect and the driver is not penalised (§7.3, §8)',
    };

    const defect: RoadDefect = {
      id: event.roadDefectId,
      h3_12: cell.h3_12,
      headingSector: cell.headingSector,
      lat: cell.centroidLat,
      lon: cell.centroidLon,
      confidence: result.confidence,
      severity: event.severity,
      distinctDevices: result.distinctDevices,
      spikeRate: result.spikeRate,
      firstSeen: cell.lastPassAt ?? nowTSec,
      lastSeen: nowTSec,
      status: 'active',
    };
    return { event, result, defect };
  }

  if (result.verdict === 'driver_event') {
    event.type = 'driver.avoidable_impact';
    event.category = 'driver';
    event.attributedToDriver = true;
    event.confidence = Math.min(candidate.confidence, result.confidence);
    event.evidence = {
      ...sharedEvidence,
      conclusion:
        'the fleet passes this cell cleanly, so the impact is attributed to the driver (§7.3)',
    };
    return { event, result, defect: null };
  }

  // UNDECIDED (§7.3): "recorded with attributed_to_driver = false and confidence
  // < 0.5; excluded from scoring until evidence arrives."
  event.type = 'road.impact_candidate';
  event.category = 'road';
  event.attributedToDriver = false;
  event.confidence = Math.min(candidate.confidence, cfg.arbitration.undecidedMaxConfidence - 0.01);
  event.evidence = {
    ...sharedEvidence,
    conclusion:
      result.distinctDevices < cfg.arbitration.minDistinctDevices
        ? 'too few distinct devices have passed this cell to establish consensus; excluded from scoring until evidence arrives (§7.3)'
        : 'spike rate is ambiguous (between the driver and road bounds); excluded from scoring until evidence arrives (§7.3)',
    eligible_for_rearbitration: true,
  };
  return { event, result, defect: null };
}

/**
 * Re-arbitration — §7.3: "Arbitration is retroactive."
 *
 * "A brand-new fleet has no consensus, so early impacts sit as UNDECIDED. A
 * nightly re-arbitration job re-evaluates undecided events against the
 * now-richer map and promotes them. `event_key` idempotency plus `rule_version`
 * makes that safe to re-run."
 *
 * Returns only the events whose verdict actually changed, so the writer does not
 * churn rows that are still undecided.
 */
export function reArbitrate(
  undecided: EventCandidate[],
  map: RoadMap,
  cfg: Thresholds,
  nowTSec: number,
): AttributionOutcome[] {
  const changed: AttributionOutcome[] = [];
  for (const c of undecided) {
    const outcome = attributeImpact(c, map, cfg, nowTSec);
    if (outcome.result.verdict !== 'undecided') changed.push(outcome);
  }
  return changed;
}

/** Sector index back to its centre heading, for the k-ring lookup. */
function sectorToHeading(sector: number | null, cfg: Thresholds): number {
  if (sector === null) return 0;
  return (sector * 360) / cfg.roadmap.headingSectors;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
