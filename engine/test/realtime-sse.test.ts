import http from 'node:http';
import { describe, it, expect } from 'vitest';
import { THRESHOLDS, RULE_VERSION } from '../src/config/thresholds.js';
import { Pipeline } from '../src/pipeline.js';
import { InMemorySink, PgSink } from '../src/sink/writer.js';
import { createSilentLogger } from '../src/util/log.js';
import { buildServer } from '../src/http/server.js';
import type { BroadcastPayload } from '../src/pipeline.js';
import type { DeviceMeta, PersistableEvent, RawRow } from '../src/types.js';

const cfg = THRESHOLDS;

function sampleDevices(): Map<string, DeviceMeta> {
  return new Map([
    [
      'dev-1',
      {
        deviceId: 'dev-1',
        vehicleId: 'veh-1',
        driverId: 'drv-1',
        accelFsG: 2,
        gyroFsDps: 250,
        active: true,
      },
    ],
  ]);
}

function makeRow(i: number, speedKmh = 40): RawRow {
  return {
    id: 1000 + i,
    device_id: 'dev-1',
    ts: new Date(1700000000000 + i * 1000).toISOString(),
    uptime_ms: 10000 + i * 1000,
    seq: i + 1,
    samples: 50,
    accel_raw: { x: 0, y: 0, z: 16384 },
    accel_cal: {
      vertical_peak: 200,
      vertical_rms: 100,
      horizontal_peak: 50,
      magnitude_peak: 200,
    },
    gyro_raw: { x: 0, y: 0, z: 0 },
    gyro_cal: { yaw_rate_peak: 10, pitch_rate_peak: 10, roll_rate_peak: 10 },
    gps: {
      fix: true,
      lat: 6.9271 + i * 0.0001,
      lon: 79.8612,
      alt_m: 10,
      speed_kmh: speedKmh,
      heading: 0,
      sats: 8,
      hdop: 1.0,
    },
    mic: { rms: 1000, peak: 1200 },
    calibration: {
      state: 'calibrated',
      age_ms: 10000,
      gravity_ref: { x: 0, y: 0, z: 16384 },
    },
    wifi_rssi: -60,
    server_received_at: new Date(1700000000000 + i * 1000 + 100).toISOString(),
  };
}

describe('Realtime Broadcast & SSE', () => {
  it('broadcasts telemetry, trip, and event updates to subscribers', async () => {
    const sink = new InMemorySink();
    const pipeline = new Pipeline({
      cfg,
      sink,
      log: createSilentLogger(),
      devices: sampleDevices(),
    });

    const received: BroadcastPayload[] = [];
    const unsubscribe = pipeline.subscribe((msg) => {
      received.push(msg);
    });

    // Submit enough rows (> 6s of sustained speed) to trigger trip start and telemetry broadcast
    for (let i = 0; i < 10; i++) {
      await pipeline.submit(makeRow(i, 45));
    }
    await pipeline.drain();

    const telemetryMsgs = received.filter((m) => m.type === 'telemetry');
    const tripMsgs = received.filter((m) => m.type === 'trip');

    expect(telemetryMsgs.length).toBe(10);
    expect(telemetryMsgs[0]?.data.device_id).toBe('dev-1');
    expect(tripMsgs.length).toBeGreaterThan(0);
    expect(tripMsgs[0]?.data.deviceId).toBe('dev-1');

    unsubscribe();
  });

  it('serves real-time SSE stream via GET /events/live', async () => {
    const sink = new InMemorySink();
    const pipeline = new Pipeline({
      cfg,
      sink,
      log: createSilentLogger(),
      devices: sampleDevices(),
    });

    const app = buildServer({
      pipeline,
      db: null,
      log: createSilentLogger(),
      port: 0,
      isReady: () => true,
    });

    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    const res = await new Promise<{ statusCode: number; headers: any; firstChunk: string }>((resolve, reject) => {
      const req = http.get(`${address}/events/live`, (res) => {
        res.setEncoding('utf8');
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          if (data.includes(': connected')) {
            req.destroy();
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              firstChunk: data,
            });
          }
        });
      });
      req.on('error', (err) => {
        if (!req.destroyed) reject(err);
      });
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.firstChunk).toContain(': connected');

    await app.close();
  });

  it('PgSink triggers instant flush for critical and high severity events', async () => {
    let flushCount = 0;
    const fakeDb: any = {
      begin: async (callback: any) => {
        flushCount++;
        await callback((_query: any) => Promise.resolve([]));
      },
    };

    const sink = new PgSink(fakeDb, createSilentLogger(), {
      flushMs: 5000, // 5s debounced timer
      maxRows: 500,
    });

    const lowEvent: PersistableEvent = {
      type: 'driver.harsh_brake',
      category: 'driver',
      severity: 'low',
      confidence: 0.8,
      deviceId: 'dev-1',
      bootId: 'b1',
      anchorSeq: 1,
      occurredAt: 1700000000,
      timeQuality: 'gps',
      lat: 6.9,
      lon: 79.8,
      h3_12: '8c608e90a5a41ff',
      headingSector: 0,
      speedKmh: 40,
      magnitude: 4.2,
      magnitudeUnit: 'm/s2',
      severityCensored: false,
      attributedToDriver: true,
      roadDefectId: null,
      evidence: {},
      telemetryIds: [1],
      eventKey: 'k1',
      tripId: 't1',
      ruleVersion: RULE_VERSION,
      engineVersion: '0.1.0',
    };

    // Low severity event schedules a timer, doesn't immediately flush
    sink.enqueueEvent(lowEvent);
    expect(flushCount).toBe(0);

    // Critical severity event triggers immediate async flush
    const criticalEvent: PersistableEvent = {
      ...lowEvent,
      type: 'driver.collision_suspected',
      severity: 'critical',
      eventKey: 'k2',
    };

    sink.enqueueEvent(criticalEvent);
    // Yield to let the async flush task run
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(flushCount).toBe(1);

    await sink.close();
  });
});
