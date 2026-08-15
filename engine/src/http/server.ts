/**
 * Operational HTTP surface — ENGINE-PLAN §5 (`http/server.ts`, "Fastify: /healthz
 * /readyz /metrics /admin/replay").
 *
 * Deliberately not an ingest API. §3 is explicit that the device writes straight
 * to PostgREST and that putting this service in that path would turn every engine
 * hiccup into permanent data loss, because the ESP32's post queue is 4 deep and
 * drops on overflow. Nothing here accepts telemetry.
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';
import type { Pipeline } from '../pipeline.js';
import type { Db } from '../db/client.js';
import { ping } from '../db/client.js';
import type { Logger } from '../util/log.js';
import { RULE_VERSION } from '../config/thresholds.js';
import { ENGINE_VERSION } from '../types.js';

export interface ServerDeps {
  pipeline: Pipeline;
  db: Db | null;
  log: Logger;
  port: number;
  /** Set once ingest is attached and the first sweep has completed. */
  isReady: () => boolean;
  /** Trigger an offline re-run over a date range (§5, §10). */
  onReplay?: (from: string, to: string, deviceId?: string) => Promise<unknown>;
  /** Trigger the §7.3 nightly re-arbitration by hand. */
  onReArbitrate?: () => Promise<unknown>;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  // Counters mirror `pipeline.stats` rather than being incremented separately, so
  // the metric and the number the engine acts on cannot drift apart.
  const gauges = {
    devices: new Gauge({
      name: 'roadscore_active_devices',
      help: 'devices with live in-memory state',
      registers: [registry],
      collect(): void {
        this.set(deps.pipeline.deviceCount());
      },
    }),
    openPredictions: new Gauge({
      name: 'roadscore_open_predictions',
      help: 'predictions awaiting an outcome',
      registers: [registry],
      collect(): void {
        this.set(deps.pipeline.openPredictions());
      },
    }),
    roadCells: new Gauge({
      name: 'roadscore_road_cells',
      help: 'cells in the in-memory fleet road map',
      registers: [registry],
      collect(): void {
        this.set(deps.pipeline.map.size());
      },
    }),
    knownDefects: new Gauge({
      name: 'roadscore_known_defects',
      help: 'confirmed road defects held in memory',
      registers: [registry],
      collect(): void {
        this.set(deps.pipeline.defects.size);
      },
    }),
  };

  const counters = {
    rowsAccepted: new Counter({
      name: 'roadscore_rows_accepted_total',
      help: 'telemetry rows normalised successfully',
      registers: [registry],
    }),
    rowsRejected: new Counter({
      name: 'roadscore_rows_rejected_total',
      help: 'telemetry rows rejected by validation or the plausibility gate',
      registers: [registry],
    }),
    events: new Counter({
      name: 'roadscore_events_total',
      help: 'driving events emitted',
      registers: [registry],
    }),
    predictions: new Counter({
      name: 'roadscore_predictions_total',
      help: 'hazard predictions issued',
      registers: [registry],
    }),
  };

  /** Counters are monotonic, so publish the delta since the last scrape. */
  const lastSeen = { rowsAccepted: 0, rowsRejected: 0, events: 0, predictions: 0 };
  function syncCounters(): void {
    const s = deps.pipeline.stats;
    counters.rowsAccepted.inc(Math.max(0, s.rowsAccepted - lastSeen.rowsAccepted));
    counters.rowsRejected.inc(Math.max(0, s.rowsRejected - lastSeen.rowsRejected));
    counters.events.inc(Math.max(0, s.eventsEmitted - lastSeen.events));
    counters.predictions.inc(Math.max(0, s.predictionsIssued - lastSeen.predictions));
    lastSeen.rowsAccepted = s.rowsAccepted;
    lastSeen.rowsRejected = s.rowsRejected;
    lastSeen.events = s.eventsEmitted;
    lastSeen.predictions = s.predictionsIssued;
  }

  // -------------------------------------------------------------------------
  // Liveness: is the process up? Never touches the database — a health check
  // that fails because Postgres is briefly unreachable would have the
  // orchestrator kill an engine that is about to recover on its own.
  // -------------------------------------------------------------------------
  app.get('/healthz', async () => ({
    status: 'ok',
    engineVersion: ENGINE_VERSION,
    ruleVersion: RULE_VERSION,
    uptimeS: Math.round(process.uptime()),
  }));

  // -------------------------------------------------------------------------
  // Readiness: should this instance receive traffic / be considered caught up?
  // This one DOES check the database, because an engine that cannot write is
  // not doing its job even though the process is alive.
  // -------------------------------------------------------------------------
  app.get('/readyz', async (_req, reply) => {
    const dbOk = deps.db === null ? true : await ping(deps.db);
    const ready = deps.isReady() && dbOk;
    if (!ready) {
      return reply.code(503).send({ status: 'not_ready', db: dbOk, ingest: deps.isReady() });
    }
    return { status: 'ready', db: dbOk, devices: deps.pipeline.deviceCount() };
  });

  app.get('/metrics', async (_req, reply) => {
    syncCounters();
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  /** Human-readable snapshot, useful during a demo or a viva. */
  app.get('/stats', async () => {
    const s = deps.pipeline.stats;
    return {
      engineVersion: ENGINE_VERSION,
      ruleVersion: RULE_VERSION,
      rows: { accepted: s.rowsAccepted, rejected: s.rowsRejected },
      rejections: Object.fromEntries(s.rejections),
      events: s.eventsEmitted,
      trips: { opened: s.tripsOpened, closed: s.tripsClosed },
      predictions: {
        issued: s.predictionsIssued,
        resolved: s.predictionsResolved,
        open: deps.pipeline.openPredictions(),
      },
      roadMap: { cells: deps.pipeline.map.size(), defects: deps.pipeline.defects.size },
      activeDevices: deps.pipeline.deviceCount(),
    };
  });

  // -------------------------------------------------------------------------
  // Admin: offline re-run over a date range (§5, §10 step 3).
  // -------------------------------------------------------------------------
  app.post<{ Body: { from?: string; to?: string; deviceId?: string } }>(
    '/admin/replay',
    async (req, reply) => {
      if (deps.onReplay === undefined) {
        return reply.code(501).send({ error: 'replay not wired in this deployment' });
      }
      const { from, to, deviceId } = req.body ?? {};
      if (typeof from !== 'string' || typeof to !== 'string') {
        return reply.code(400).send({ error: 'from and to are required ISO timestamps' });
      }
      try {
        const result = await deps.onReplay(from, to, deviceId);
        return { status: 'completed', result };
      } catch (err) {
        deps.log.error({ err }, 'admin replay failed');
        return reply.code(500).send({ error: String(err) });
      }
    },
  );

  app.post<{ Body: { deviceId?: string } }>(
    '/admin/trips/force-close',
    async (req, reply) => {
      const { deviceId } = req.body ?? {};
      if (!deviceId) {
        return reply.code(400).send({ error: 'deviceId is required' });
      }
      try {
        const trip = deps.pipeline.forceCloseDeviceTrip(deviceId);
        if (!trip) {
          return reply.code(404).send({ status: 'no_active_trip', message: `No open trip found for device ${deviceId}` });
        }
        return { status: 'closed', trip };
      } catch (err) {
        deps.log.error({ err }, 'failed to force close trip');
        return reply.code(500).send({ error: String(err) });
      }
    },
  );

  app.post('/admin/re-arbitrate', async (_req, reply) => {
    if (deps.onReArbitrate === undefined) {
      return reply.code(501).send({ error: 're-arbitration not wired in this deployment' });
    }
    try {
      return { status: 'completed', result: await deps.onReArbitrate() };
    } catch (err) {
      deps.log.error({ err }, 're-arbitration failed');
      return reply.code(500).send({ error: String(err) });
    }
  });

  void gauges;
  return app;
}

export async function startServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = buildServer(deps);
  await app.listen({ port: deps.port, host: '0.0.0.0' });
  deps.log.info({ port: deps.port }, 'http listening');
  return app;
}
