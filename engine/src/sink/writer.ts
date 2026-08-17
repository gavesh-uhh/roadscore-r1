/**
 * Batched writer — ENGINE-PLAN §5 (`sink/writer.ts`, "batched multi-row upserts,
 * 250 ms flush") and §3 routing change 2.
 *
 * "The bottleneck is the DB write path, which is why the sink batches on a 250 ms
 * timer / 500-row cap. Target: p95 telemetry-row → event-row under 500 ms."
 *
 * Everything is an upsert keyed on the natural identity of the row, so a replay,
 * a sweeper overlap or a duplicated Realtime message all collapse to a no-op
 * (§4, §9). That property is what makes the backfill path safe to run at all.
 */

import type {
  MemorySink,
  PersistableEvent,
  Prediction,
  RoadCell,
  RoadDefect,
  Score,
  Sink,
  Trip,
  WriteBatch,
} from '../types.js';
import type postgres from 'postgres';
import type { Db } from '../db/client.js';
import type { Logger } from '../util/log.js';

/**
 * A transaction handle is narrower than the pool handle (it has no END/CLOSE or
 * connection options), so the per-table writers accept the transaction type
 * rather than the full `Db`. `TransactionSql` is what `sql.begin` hands its
 * callback, and it is still a tagged-template query function.
 */
type Queryable = postgres.TransactionSql<Record<string, never>>;

function emptyBatch(): WriteBatch {
  return { events: [], trips: [], roadCells: [], roadDefects: [], predictions: [], scores: [] };
}

/** ISO timestamp from epoch seconds, for timestamptz columns. */
function ts(sec: number | null): string | null {
  return sec === null || !Number.isFinite(sec) ? null : new Date(sec * 1000).toISOString();
}

/** Resilient JSON serializer that gracefully handles special floats and circular references. */
function safeJson(obj: unknown): string {
  if (obj === null || obj === undefined) return '{}';
  try {
    return JSON.stringify(obj, (_k, v) => {
      if (typeof v === 'number') {
        if (Number.isNaN(v)) return null;
        if (!Number.isFinite(v)) return v > 0 ? 1e9 : -1e9;
      }
      return v;
    });
  } catch {
    return '{}';
  }
}

export interface WriterOptions {
  flushMs: number;
  maxRows: number;
}

/**
 * Postgres-backed sink.
 *
 * Writes through a direct pooled connection rather than PostgREST: §3 is explicit
 * that "batched multi-row INSERT … ON CONFLICT on a pooled connection is several
 * times faster than one HTTP round trip per statement, and gives real transactions
 * so a trip and its events commit atomically".
 */
export class PgSink implements Sink {
  private batch = emptyBatch();
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly sql: Db,
    private readonly log: Logger,
    private readonly opts: WriterOptions,
  ) {}

  private schedule(): void {
    if (this.closed) return;
    if (this.pendingRows() >= this.opts.maxRows) {
      void this.flush();
      return;
    }
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.flushMs);
    // Do not hold the process open for a pending flush.
    this.timer.unref?.();
  }

  private pendingRows(): number {
    const b = this.batch;
    return (
      b.events.length +
      b.trips.length +
      b.roadCells.length +
      b.roadDefects.length +
      b.predictions.length +
      b.scores.length
    );
  }

  enqueueEvent(e: PersistableEvent): void {
    this.batch.events.push(e);
    if (e.severity === 'critical' || e.severity === 'high') {
      void this.flush();
    } else {
      this.schedule();
    }
  }
  enqueueTrip(t: Trip): void {
    this.batch.trips.push(t);
    this.schedule();
  }
  enqueueRoadCell(c: RoadCell): void {
    this.batch.roadCells.push(c);
    this.schedule();
  }
  enqueueRoadDefect(d: RoadDefect): void {
    this.batch.roadDefects.push(d);
    this.schedule();
  }
  enqueuePrediction(p: Prediction): void {
    this.batch.predictions.push(p);
    this.schedule();
  }
  enqueueScore(s: Score): void {
    this.batch.scores.push(s);
    this.schedule();
  }

  /**
   * Flush the current batch in one transaction.
   *
   * Serialised: a second call while a flush is in flight awaits the first, so
   * rows can never be written out of order or twice concurrently.
   */
  async flush(): Promise<void> {
    while (this.flushing !== null) {
      await this.flushing;
    }
    if (this.pendingRows() === 0) return;

    const batch = this.batch;
    this.batch = emptyBatch();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.flushing = this.write(batch).finally(() => {
      this.flushing = null;
    });
    await this.flushing;
  }

  private async write(b: WriteBatch): Promise<void> {
    const started = process.hrtime.bigint();
    try {
      await this.sql.begin(async (tx) => {
        // Trips before events: an event references its trip.
        if (b.trips.length > 0) await this.writeTrips(tx, b.trips);
        if (b.roadCells.length > 0) await this.writeRoadCells(tx, b.roadCells);
        if (b.roadDefects.length > 0) await this.writeRoadDefects(tx, b.roadDefects);
        if (b.events.length > 0) await this.writeEvents(tx, b.events);
        if (b.predictions.length > 0) await this.writePredictions(tx, b.predictions);
        if (b.scores.length > 0) await this.writeScores(tx, b.scores);
      });

      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      this.log.debug(
        {
          ms: Number(ms.toFixed(1)),
          events: b.events.length,
          trips: b.trips.length,
          cells: b.roadCells.length,
          defects: b.roadDefects.length,
          predictions: b.predictions.length,
          scores: b.scores.length,
        },
        'sink flush',
      );
    } catch (err) {
      // The telemetry is already durable in Postgres (§3), so a failed flush is
      // recoverable: the sweeper will re-deliver the rows and `event_key`
      // idempotency makes the retry a no-op. Losing the batch is acceptable;
      // crashing the ingest loop is not.
      this.log.error({ err, rows: this.pendingRows() }, 'sink flush failed — rows will be re-derived on replay');
    }
  }

  private async writeEvents(tx: Queryable, events: PersistableEvent[]): Promise<void> {
    const eventMap = new Map<string, PersistableEvent>();
    for (const e of events) eventMap.set(e.eventKey, e);
    const dedupedEvents = Array.from(eventMap.values());

    const rows = dedupedEvents.map((e) => ({
      event_key: e.eventKey,
      trip_id: e.tripId,
      device_id: e.deviceId,
      driver_id: e.driverId ?? null,
      type: e.type,
      category: e.category,
      severity: e.severity,
      confidence: e.confidence,
      occurred_at: ts(e.occurredAt),
      time_quality: e.timeQuality,
      lat: e.lat,
      lon: e.lon,
      h3_12: e.h3_12,
      heading_sector: e.headingSector,
      speed_kmh: e.speedKmh,
      magnitude: e.magnitude,
      magnitude_unit: e.magnitudeUnit,
      severity_censored: e.severityCensored,
      attributed_to_driver: e.attributedToDriver,
      road_defect_id: e.roadDefectId,
      evidence: safeJson(e.evidence),
      telemetry_ids: e.telemetryIds,
      rule_version: e.ruleVersion,
      engine_version: e.engineVersion,
    }));

    // ON CONFLICT on `event_key` — the §4 idempotency guarantee. A replayed row
    // updates the arbitration verdict (which can legitimately change once the
    // fleet map is richer) but never inserts a second penalty.
    await tx`
      insert into driving_events ${tx(rows)}
      on conflict (event_key) do update set
        driver_id = excluded.driver_id,
        type = excluded.type,
        category = excluded.category,
        severity = excluded.severity,
        confidence = excluded.confidence,
        attributed_to_driver = excluded.attributed_to_driver,
        road_defect_id = excluded.road_defect_id,
        evidence = excluded.evidence
    `;
  }

  private async writeTrips(tx: Queryable, trips: Trip[]): Promise<void> {
    const tripMap = new Map<string, Trip>();
    for (const t of trips) tripMap.set(t.id, t);
    const dedupedTrips = Array.from(tripMap.values());

    const rows = dedupedTrips.map((t) => ({
      id: t.id,
      device_id: t.deviceId,
      driver_id: t.driverId,
      vehicle_id: t.vehicleId,
      boot_id: t.bootId,
      started_at: ts(t.startedAt),
      ended_at: ts(t.endedAt),
      start_lat: t.startLat,
      start_lon: t.startLon,
      end_lat: t.endLat,
      end_lon: t.endLon,
      distance_m: t.distanceM,
      duration_s: t.durationS,
      moving_s: Math.round(t.movingS),
      idle_s: Math.round(t.idleS),
      max_speed_kmh: t.maxSpeedKmh,
      avg_speed_kmh: t.avgSpeedKmh,
      telemetry_from: t.telemetryFrom,
      telemetry_to: t.telemetryTo,
      gps_coverage: t.gpsCoverage,
      status: t.status,
    }));

    await tx`
      insert into trips ${tx(rows)}
      on conflict (id) do update set
        ended_at = excluded.ended_at,
        end_lat = excluded.end_lat,
        end_lon = excluded.end_lon,
        distance_m = excluded.distance_m,
        duration_s = excluded.duration_s,
        moving_s = excluded.moving_s,
        idle_s = excluded.idle_s,
        max_speed_kmh = excluded.max_speed_kmh,
        avg_speed_kmh = excluded.avg_speed_kmh,
        telemetry_to = excluded.telemetry_to,
        gps_coverage = excluded.gps_coverage,
        status = excluded.status
    `;
  }

  private async writeRoadCells(tx: Queryable, cells: RoadCell[]): Promise<void> {
    const cellMap = new Map<string, RoadCell>();
    for (const c of cells) cellMap.set(`${c.h3_12}:${c.headingSector}`, c);
    const dedupedCells = Array.from(cellMap.values());

    const rows = dedupedCells.map((c) => ({
      h3_12: c.h3_12,
      heading_sector: c.headingSector,
      centroid_lat: c.centroidLat,
      centroid_lon: c.centroidLon,
      pass_count: c.passCount,
      device_count: c.deviceCount,
      spike_count: c.spikeCount,
      rough_mean: c.roughMean,
      rough_m2: c.roughM2,
      roughness_index: c.roughnessIndex,
      defect_confidence: c.defectConfidence,
      speed_p85_kmh: c.speedP85Kmh,
      last_pass_at: ts(c.lastPassAt),
      updated_at: new Date().toISOString(),
    }));

    // The engine owns the authoritative in-memory copy, so it overwrites rather
    // than incrementing — an increment here would double-count on replay.
    await tx`
      insert into road_cells ${tx(rows)}
      on conflict (h3_12, heading_sector) do update set
        centroid_lat = excluded.centroid_lat,
        centroid_lon = excluded.centroid_lon,
        pass_count = excluded.pass_count,
        device_count = excluded.device_count,
        spike_count = excluded.spike_count,
        rough_mean = excluded.rough_mean,
        rough_m2 = excluded.rough_m2,
        roughness_index = excluded.roughness_index,
        defect_confidence = excluded.defect_confidence,
        speed_p85_kmh = excluded.speed_p85_kmh,
        last_pass_at = excluded.last_pass_at,
        updated_at = excluded.updated_at
    `;
  }

  private async writeRoadDefects(tx: Queryable, defects: RoadDefect[]): Promise<void> {
    const defectMap = new Map<string, RoadDefect>();
    for (const d of defects) defectMap.set(`${d.h3_12}:${d.headingSector}`, d);
    const dedupedDefects = Array.from(defectMap.values());

    const rows = dedupedDefects.map((d) => ({
      id: d.id,
      h3_12: d.h3_12,
      heading_sector: d.headingSector,
      lat: d.lat,
      lon: d.lon,
      confidence: d.confidence,
      severity: d.severity,
      distinct_devices: d.distinctDevices,
      spike_rate: d.spikeRate,
      first_seen: ts(d.firstSeen),
      last_seen: ts(d.lastSeen),
      status: d.status,
    }));

    await tx`
      insert into road_defects ${tx(rows)}
      on conflict (h3_12, heading_sector) do update set
        confidence = excluded.confidence,
        severity = excluded.severity,
        distinct_devices = excluded.distinct_devices,
        spike_rate = excluded.spike_rate,
        last_seen = excluded.last_seen,
        status = excluded.status,
        first_seen = least(road_defects.first_seen, excluded.first_seen)
    `;
  }

  private async writePredictions(tx: Queryable, preds: Prediction[]): Promise<void> {
    const predMap = new Map<string, Prediction>();
    for (const p of preds) predMap.set(p.id, p);
    const dedupedPreds = Array.from(predMap.values());

    const rows = dedupedPreds.map((p) => ({
      id: p.id,
      device_id: p.deviceId,
      trip_id: p.tripId,
      issued_at: ts(p.issuedAt),
      type: p.type,
      target_defect_id: p.targetDefectId,
      target_h3_12: p.targetH3_12,
      distance_m: p.distanceM,
      eta_s: p.etaS,
      confidence: p.confidence,
      outcome: p.outcome,
      outcome_event_id: p.outcomeEventId,
      outcome_checked_at: ts(p.outcomeCheckedAt),
    }));

    await tx`
      insert into predictions ${tx(rows)}
      on conflict (id) do update set
        outcome = excluded.outcome,
        outcome_event_id = excluded.outcome_event_id,
        outcome_checked_at = excluded.outcome_checked_at
    `;
  }

  private async writeScores(tx: Queryable, scores: Score[]): Promise<void> {
    const scoreMap = new Map<string, Score>();
    for (const s of scores) {
      scoreMap.set(`${s.subjectType}:${s.subjectId}:${s.periodStart}:${s.periodEnd}:${s.ruleVersion}`, s);
    }
    const dedupedScores = Array.from(scoreMap.values());

    const rows = dedupedScores.map((s) => {
      const pStart = s.periodStart;
      // Guarantee period_end > period_start to satisfy postgres check constraint scores_period_ordered
      const pEnd = s.periodEnd <= pStart ? pStart + 1 : s.periodEnd;
      return {
        subject_type: s.subjectType,
        subject_id: s.subjectId,
        period_start: ts(pStart),
        period_end: ts(pEnd),
        score: s.score,
        exposure_km: s.exposureKm,
        exposure_min: s.exposureMin,
        breakdown: JSON.stringify(s.breakdown),
        rule_version: s.ruleVersion,
      };
    });

    // The §4 unique key includes `rule_version`, so re-scoring under new
    // thresholds produces a comparable row instead of destroying the old verdict.
    await tx`
      insert into scores ${tx(rows)}
      on conflict (subject_type, subject_id, period_start, period_end, rule_version) do update set
        score = excluded.score,
        exposure_km = excluded.exposure_km,
        exposure_min = excluded.exposure_min,
        breakdown = excluded.breakdown
    `;
  }

  async close(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
    this.closed = true;
  }
}

/**
 * In-memory sink for the replay harness and tests (§10).
 *
 * The replay harness must run with "no DB and no clock", so this is the sink it
 * uses. Keeping it in the same module as the real one makes it obvious that they
 * implement the same interface.
 */
export class InMemorySink implements MemorySink {
  readonly batch: WriteBatch = emptyBatch();

  enqueueEvent(e: PersistableEvent): void {
    this.batch.events.push(e);
  }
  enqueueTrip(t: Trip): void {
    this.batch.trips.push(t);
  }
  enqueueRoadCell(c: RoadCell): void {
    this.batch.roadCells.push(c);
  }
  enqueueRoadDefect(d: RoadDefect): void {
    this.batch.roadDefects.push(d);
  }
  enqueuePrediction(p: Prediction): void {
    this.batch.predictions.push(p);
  }
  enqueueScore(s: Score): void {
    this.batch.scores.push(s);
  }
  async flush(): Promise<void> {
    /* nothing to do */
  }
  async close(): Promise<void> {
    /* nothing to do */
  }
  clear(): void {
    const b = this.batch;
    b.events.length = 0;
    b.trips.length = 0;
    b.roadCells.length = 0;
    b.roadDefects.length = 0;
    b.predictions.length = 0;
    b.scores.length = 0;
  }
}
