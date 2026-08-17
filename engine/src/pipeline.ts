/**
 * The pipeline — ENGINE-PLAN §3 and §5's processing model.
 *
 *   ingest → normalize → detect → arbitrate → predict → score
 *
 * §5: "Single Node process, single event loop, per-device sequential queue keyed
 * on `device_id` so a device's rows never interleave. Cross-device work is
 * naturally concurrent because each row is O(1)."
 *
 * The per-device queue is the load-bearing invariant. Every detector reads a ring
 * buffer of that device's recent history, so two rows from the same device being
 * processed concurrently would corrupt the excursion trackers and the baselines.
 * Rows from *different* devices are independent and need no ordering.
 */

import type {
  DeviceMeta,
  EventCandidate,
  PersistableEvent,
  Prediction,
  RawRow,
  RoadDefect,
  Sink,
  Trip,
} from './types.js';
import { ENGINE_VERSION } from './types.js';
import type { Thresholds } from './config/thresholds.js';
import { RULE_VERSION } from './config/thresholds.js';
import type { DeviceState } from './domain/state.js';
import { newDeviceState } from './domain/state.js';
import { normalizeRow } from './domain/normalize.js';
import { forceCloseTrip, updateTrip } from './domain/trip.js';
import { runDetectors } from './detect/index.js';
import { setCellStats } from './detect/speed.js';
import { RoadMap, cellKey } from './arbitrate/roadmap.js';
import { attributeImpact } from './arbitrate/attribute.js';
import { scoreTrip } from './score/rollup.js';
import { predictAhead } from './predict/ahead.js';
import { PredictionEvaluator } from './predict/evaluate.js';
import { eventKey } from './util/hash.js';
import type { Logger } from './util/log.js';

export interface PipelineOptions {
  cfg: Thresholds;
  sink: Sink;
  log: Logger;
  /** Device identity, from the `devices` table. Unknown devices are rejected (§3). */
  devices: Map<string, DeviceMeta>;
  map?: RoadMap;
  /** Wall-clock source, injectable so tests and replay stay deterministic. */
  now?: () => number;
  /** Device state TTL — §9 "Devices idle > 30 min are evicted from the state map". */
  stateTtlMs?: number;
}

export interface PipelineStats {
  rowsAccepted: number;
  rowsRejected: number;
  eventsEmitted: number;
  predictionsIssued: number;
  predictionsResolved: number;
  tripsOpened: number;
  tripsClosed: number;
  rejections: Map<string, number>;
}

export type BroadcastPayload =
  | { type: 'telemetry'; data: RawRow }
  | { type: 'event'; data: PersistableEvent }
  | { type: 'trip'; data: Trip };

export type BroadcastListener = (payload: BroadcastPayload) => void;

/**
 * Processes rows for the whole fleet, one device at a time per device.
 */
export class Pipeline {
  private readonly states = new Map<string, DeviceState>();
  /** Per-device promise chain, enforcing sequential processing (§5). */
  private readonly queues = new Map<string, Promise<void>>();
  private readonly evaluator: PredictionEvaluator;
  private readonly listeners = new Set<BroadcastListener>();
  readonly map: RoadMap;
  readonly defects = new Map<string, RoadDefect>();

  readonly stats: PipelineStats = {
    rowsAccepted: 0,
    rowsRejected: 0,
    eventsEmitted: 0,
    predictionsIssued: 0,
    predictionsResolved: 0,
    tripsOpened: 0,
    tripsClosed: 0,
    rejections: new Map(),
  };

  private readonly now: () => number;
  private readonly stateTtlMs: number;

  constructor(private readonly opts: PipelineOptions) {
    this.map = opts.map ?? new RoadMap(opts.cfg);
    this.evaluator = new PredictionEvaluator(opts.cfg);
    this.now = opts.now ?? ((): number => Date.now());
    this.stateTtlMs = opts.stateTtlMs ?? 120_000;
    // The §6.5 speeding detectors read fleet statistics through this lookup.
    setCellStats(this.map);
  }

  /** Subscribe to live real-time pipeline events (telemetry, events, trips). */
  subscribe(listener: BroadcastListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Broadcast an update to all connected listeners. */
  broadcast(payload: BroadcastPayload): void {
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch (err) {
        this.opts.log.error({ err }, 'broadcast listener threw');
      }
    }
  }

  /** Load known defects at startup so prediction works from the first row. */
  loadDefects(defects: RoadDefect[]): void {
    for (const d of defects) this.defects.set(cellKey(d.h3_12, d.headingSector), d);
  }

  /** Dynamically synchronize the device registry from the database. */
  updateDeviceRegistry(devices: Map<string, DeviceMeta>): void {
    this.opts.devices = devices;
    for (const [deviceId, st] of this.states) {
      const meta = devices.get(deviceId);
      if (meta) {
        st.meta = meta;
      }
    }
  }

  /** Dynamically synchronize active road defects. */
  updateDefects(defects: RoadDefect[]): void {
    this.defects.clear();
    for (const d of defects) this.defects.set(cellKey(d.h3_12, d.headingSector), d);
  }

  /**
   * Submit a row. Returns a promise that resolves once THAT row has been
   * processed, while guaranteeing rows for the same device run in submission
   * order.
   */
  submit(row: RawRow): Promise<void> {
    const deviceId = row.device_id;
    const prev = this.queues.get(deviceId) ?? Promise.resolve();
    const next = prev.then(() => this.processRow(row)).catch((err) => {
      // A row that throws must not poison the device's queue forever.
      this.opts.log.error({ err, deviceId, id: row.id }, 'row processing failed');
    });
    this.queues.set(deviceId, next);
    return next;
  }

  private reject(reason: string): void {
    this.stats.rowsRejected++;
    const key = reason.split(':')[0] ?? reason;
    this.stats.rejections.set(key, (this.stats.rejections.get(key) ?? 0) + 1);
  }

  private async processRow(row: RawRow): Promise<void> {
    const { cfg, sink, log } = this.opts;

    // §3 routing change 5: an unknown device_id is rejected. Because the road map
    // is fleet-consensus, an unrecognised device's rows could poison scoring for
    // every real driver.
    const meta = this.opts.devices.get(row.device_id);
    if (meta === undefined || !meta.active) {
      this.reject('unknown_device');
      return;
    }

    let st = this.states.get(row.device_id);
    if (st === undefined) {
      st = newDeviceState(meta, this.now());
      this.states.set(row.device_id, st);
    }
    st.lastSeenWallMs = this.now();

    // --- normalize (§2) ----------------------------------------------------
    const res = normalizeRow(row, st, cfg);
    if (!res.ok) {
      this.reject(res.reason);
      return;
    }
    this.stats.rowsAccepted++;
    const sample = res.sample;
    this.broadcast({ type: 'telemetry', data: row });

    // --- trips (§4) --------------------------------------------------------
    const transition = updateTrip(st, sample, cfg, res.rebooted);
    if (transition.opened !== undefined) {
      this.stats.tripsOpened++;
      sink.enqueueTrip(transition.opened);
      this.broadcast({ type: 'trip', data: transition.opened });
      // A new trip means a fresh set of hazard warnings (§7.4 step 6) and fresh trip events.
      st.predictedCells.clear();
      st.tripEvents = [];
      st.calibrationStaleCount = 0;
    }
    if (transition.closed !== undefined) {
      this.stats.tripsClosed++;
      sink.enqueueTrip(transition.closed);
      this.broadcast({ type: 'trip', data: transition.closed });
      const tripScore = scoreTrip(
        { trip: transition.closed, events: st.tripEvents, calibrationStaleEvents: st.calibrationStaleCount },
        cfg,
        RULE_VERSION,
      );
      sink.enqueueScore(tripScore);
      st.tripEvents = [];
      st.calibrationStaleCount = 0;

      for (const p of this.evaluator.closeDevice(sample.deviceId, sample.tSec)) {
        this.stats.predictionsResolved++;
        sink.enqueuePrediction(p);
      }
    }

    // Publish the current cell so the §6.5 detectors can key fleet statistics
    // without importing the spatial layer.
    st.lastH3 =
      sample.lat !== null && sample.lon !== null ? this.map.indexOf(sample.lat, sample.lon) : null;

    // --- detect (§6) -------------------------------------------------------
    const candidates = runDetectors(
      { sample, state: st, meta, cfg },
      { onError: (name, err) => log.error({ err, detector: name }, 'detector threw') },
    );

    // --- road map (§7.1, §7.2) --------------------------------------------
    // Every usable pass updates the fleet map, whether or not it spiked — the
    // clean passes are exactly what makes a spike rate meaningful.
    const spiked = candidates.some((c) => c.type === 'road.impact_candidate');
    const cell = this.map.observe(sample, spiked);
    if (cell !== null) sink.enqueueRoadCell(cell);

    // --- arbitrate (§7.3) --------------------------------------------------
    const finalEvents: EventCandidate[] = [];
    const impacts: EventCandidate[] = [];

    for (const c of candidates) {
      if (c.type === 'road.impact_candidate') {
        const outcome = attributeImpact(c, this.map, cfg, sample.tSec);
        finalEvents.push(outcome.event);
        impacts.push(outcome.event);
        if (outcome.defect !== null) {
          this.defects.set(cellKey(outcome.defect.h3_12, outcome.defect.headingSector), outcome.defect);
          sink.enqueueRoadDefect(outcome.defect);
        }
      } else {
        // Stamp the spatial key on every positioned event so the dashboard can
        // map it and §7 can aggregate it.
        if (c.lat !== null && c.lon !== null && c.h3_12 === null) {
          c.h3_12 = this.map.indexOf(c.lat, c.lon);
          c.headingSector = this.map.sectorOf(sample.heading);
        }
        finalEvents.push(c);
      }
    }

    for (const e of finalEvents) {
      const p = this.persistable(e, st);
      if (st.trip !== null) {
        sink.enqueueTrip(st.trip);
        st.tripEvents.push(p);
        if (e.type === 'integrity.calibration_stale') {
          st.calibrationStaleCount++;
        }
      }
      sink.enqueueEvent(p);
      this.stats.eventsEmitted++;
      this.broadcast({ type: 'event', data: p });
    }

    if (cfg.demoMode && st.trip !== null && finalEvents.length > 0) {
      const liveScore = scoreTrip(
        { trip: st.trip, events: st.tripEvents, calibrationStaleEvents: st.calibrationStaleCount },
        cfg,
        RULE_VERSION,
      );
      sink.enqueueScore(liveScore);
    }

    // --- predict (§7.4) ----------------------------------------------------
    const preds = predictAhead({ sample, state: st, map: this.map, defects: this.defects, cfg });
    for (const p of preds) {
      this.stats.predictionsIssued++;
      sink.enqueuePrediction(p);
    }
    this.evaluator.trackAll(preds);

    // --- evaluate: close the loop (§7.4) ----------------------------------
    const resolved = this.evaluator.observe(sample, impacts, this.map);
    for (const p of resolved) {
      this.stats.predictionsResolved++;
      sink.enqueuePrediction(p);
    }

    this.evictStale();
  }

  /** Attach the identity and provenance every persisted event needs (§4). */
  private persistable(e: EventCandidate, st: DeviceState): PersistableEvent {
    const driverId = st.meta.driverId ?? null;
    const vehicleId = st.meta.vehicleId ?? null;
    return {
      ...e,
      driverId,
      vehicleId,
      eventKey: eventKey(e.deviceId, e.bootId, e.type, e.anchorSeq, RULE_VERSION),
      tripId: st.trip?.id ?? null,
      evidence: {
        ...e.evidence,
        ...(driverId ? { driver_id: driverId } : {}),
        ...(vehicleId ? { vehicle_id: vehicleId } : {}),
      },
      ruleVersion: RULE_VERSION,
      engineVersion: ENGINE_VERSION,
    };
  }

  /**
   * Evict devices idle > stateTtlMs (default 120s).
   *
   * Their open trip is closed first, so an ignition-off that never produces
   * another row still yields a complete trip record rather than an orphan.
   */
  public evictStale(): Trip[] {
    const closedTrips: Trip[] = [];
    const cutoff = this.now() - this.stateTtlMs;
    for (const [deviceId, st] of this.states) {
      if (st.lastSeenWallMs > cutoff) continue;
      const trip = forceCloseTrip(st, this.opts.cfg);
      if (trip !== null) {
        this.stats.tripsClosed++;
        this.opts.sink.enqueueTrip(trip);
        this.broadcast({ type: 'trip', data: trip });
        const tripScore = scoreTrip(
          { trip, events: st.tripEvents, calibrationStaleEvents: st.calibrationStaleCount },
          this.opts.cfg,
          RULE_VERSION,
        );
        this.opts.sink.enqueueScore(tripScore);
        st.tripEvents = [];
        st.calibrationStaleCount = 0;
        closedTrips.push(trip);
      }
      for (const p of this.evaluator.closeDevice(deviceId, st.lastRowTSec ?? 0)) {
        this.stats.predictionsResolved++;
        this.opts.sink.enqueuePrediction(p);
      }
      this.states.delete(deviceId);
      this.queues.delete(deviceId);
    }
    return closedTrips;
  }

  /**
   * Manually / immediately close an open trip for a device and flush its score.
   */
  public forceCloseDeviceTrip(deviceId: string): Trip | null {
    const st = this.states.get(deviceId);
    if (!st || !st.trip) return null;
    const trip = forceCloseTrip(st, this.opts.cfg);
    if (trip !== null) {
      this.stats.tripsClosed++;
      this.opts.sink.enqueueTrip(trip);
      this.broadcast({ type: 'trip', data: trip });
      const tripScore = scoreTrip(
        { trip, events: st.tripEvents, calibrationStaleEvents: st.calibrationStaleCount },
        this.opts.cfg,
        RULE_VERSION,
      );
      this.opts.sink.enqueueScore(tripScore);
      st.tripEvents = [];
      st.calibrationStaleCount = 0;
    }
    return trip;
  }

  /** Wait for every in-flight row to finish. */
  async drain(): Promise<void> {
    await Promise.all([...this.queues.values()]);
  }

  /** Close every open trip and flush. Called on shutdown. */
  async shutdown(): Promise<void> {
    await this.drain();
    for (const [deviceId, st] of this.states) {
      const trip = forceCloseTrip(st, this.opts.cfg);
      if (trip !== null) {
        this.stats.tripsClosed++;
        this.opts.sink.enqueueTrip(trip);
        this.broadcast({ type: 'trip', data: trip });
        const tripScore = scoreTrip(
          { trip, events: st.tripEvents, calibrationStaleEvents: st.calibrationStaleCount },
          this.opts.cfg,
          RULE_VERSION,
        );
        this.opts.sink.enqueueScore(tripScore);
        st.tripEvents = [];
        st.calibrationStaleCount = 0;
      }
      for (const p of this.evaluator.closeDevice(deviceId, st.lastRowTSec ?? 0)) {
        this.opts.sink.enqueuePrediction(p);
      }
    }
    // Persist the final state of the fleet map.
    for (const c of this.map.all()) this.opts.sink.enqueueRoadCell(c);
    await this.opts.sink.flush();
  }

  deviceCount(): number {
    return this.states.size;
  }

  openPredictions(): number {
    return this.evaluator.openCount();
  }

  /** Exposed for the /metrics endpoint and tests. */
  stateOf(deviceId: string): DeviceState | undefined {
    return this.states.get(deviceId);
  }
}
