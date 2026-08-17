import { describe, expect, it } from 'vitest';
import { haversineDistanceM, calculateBearingDeg, buildRouteFromCoordinates } from '../src/routing/geo.js';
import { getPrebakedRoute, getAllCachedRoutes } from '../src/routing/cache.js';
import { TelemetryGenerator } from '../src/core/telemetry.js';
import { SimulatedDriver } from '../src/core/driver.js';
import { SimulationEngine } from '../src/core/simulation.js';

describe('RoadScore Simulator — Routing & Geo Geometry', () => {
  it('calculates accurate Haversine distance between coordinates', () => {
    // Colombo Fort to Galle Face Green (~1.1 km)
    const p1 = { lat: 6.9344, lon: 79.8428 };
    const p2 = { lat: 6.9271, lon: 79.8453 };
    const dist = haversineDistanceM(p1, p2);
    expect(dist).toBeGreaterThan(800);
    expect(dist).toBeLessThan(1200);
  });

  it('calculates correct compass bearing between points', () => {
    const p1 = { lat: 6.9344, lon: 79.8428 };
    const p2 = { lat: 6.9271, lon: 79.8453 }; // South-South-East
    const bearing = calculateBearingDeg(p1, p2);
    expect(bearing).toBeGreaterThan(150);
    expect(bearing).toBeLessThan(190);
  });

  it('builds a SimulationRoute with cumulative distance and segment headings', () => {
    const coords: [number, number][] = [
      [79.8428, 6.9344],
      [79.8453, 6.9271],
      [79.852, 6.915],
    ];
    const route = buildRouteFromCoordinates('test_route', 'Test Route', 'Origin', 'Destination', coords);
    expect(route.points.length).toBe(3);
    expect(route.totalDistanceM).toBeGreaterThan(2000);
    expect(route.points[0]!.distanceFromStartM).toBe(0);
    expect(route.points[2]!.distanceFromStartM).toBe(route.totalDistanceM);
  });

  it('loads high-fidelity cached OSM routes', () => {
    const routes = getAllCachedRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(5);

    const colKandy = getPrebakedRoute('Colombo', 'Kandy');
    expect(colKandy).toBeDefined();
    expect(colKandy!.points.length).toBeGreaterThan(100);
    expect(colKandy!.totalDistanceM).toBeGreaterThan(100000); // > 100 km
  });
});

describe('RoadScore Simulator — Telemetry Physics & H3 Observation', () => {
  it('generates physical sensor frames and resolution-12 H3 cells', () => {
    const gen = new TelemetryGenerator({
      deviceId: 'ROADSCORE_TEST',
      h3Resolution: 12,
    });

    const physics = gen.generatePhysics(
      6.9271,
      79.8453,
      45.0, // 45 km/h
      40.0,
      180,
      180,
      'normal',
      null,
      1.0,
    );

    expect(physics.lat).toBe(6.9271);
    expect(physics.lon).toBe(79.8453);
    expect(physics.speedKmh).toBe(45);
    expect(physics.h3Cell).toMatch(/^8[0-9a-f]{14}$/);
    expect(physics.verticalAccelMps2).toBeGreaterThan(0.4);
    expect(physics.horizontalPeakMps2).toBeGreaterThan(0.2);

    const row = gen.formatRow(physics);
    expect(row.device_id).toBe('ROADSCORE_TEST');
    expect(row.source).toBe('simulator');
    expect(row.accel_cal.vertical_peak).toBeGreaterThan(0);
    expect(row.accel_cal.magnitude_peak).toBeGreaterThan(0);
    expect(row.gps.fix).toBe(true);
    expect(row.gps.speed_kmh).toBe(45);
  });

  it('modulates sensor telemetry realistically on injected events', () => {
    const gen = new TelemetryGenerator({ deviceId: 'ROADSCORE_TEST' });

    // 1. Rough road
    const rough = gen.generatePhysics(6.9271, 79.8453, 40, 40, 180, 180, 'normal', {
      type: 'rough_road',
      label: 'Rough road',
      remainingTicks: 3,
      magnitude: 4.2,
      startedAt: Date.now(),
    });
    expect(rough.verticalAccelMps2).toBeGreaterThan(3.0);
    expect(rough.micRms).toBeGreaterThan(500);

    // 2. Hard braking
    const brake = gen.generatePhysics(6.9271, 79.8453, 30, 45, 180, 180, 'normal', {
      type: 'hard_brake',
      label: 'Hard braking',
      remainingTicks: 3,
      magnitude: 6.0,
      startedAt: Date.now(),
    });
    expect(brake.horizontalPeakMps2).toBeGreaterThan(5.0);

    // 3. Impact
    const impact = gen.generatePhysics(6.9271, 79.8453, 40, 40, 180, 180, 'normal', {
      type: 'impact',
      label: 'Impact',
      remainingTicks: 1,
      magnitude: 6.5,
      startedAt: Date.now(),
    });
    expect(impact.verticalAccelMps2).toBeGreaterThan(5.0);
    expect(impact.micRms).toBeGreaterThan(1000);
  });
});

describe('RoadScore Simulator — Driver & Multi-Vehicle Engine', () => {
  it('advances vehicle position strictly along OSM route geometry', () => {
    const route = getPrebakedRoute('Colombo', 'Kandy')!;
    const driver = new SimulatedDriver({
      driverId: 'driver-01',
      vehicleId: 'ROADSCORE_001',
      route,
      speedProfile: 'normal',
    });

    const initial = driver.getState();
    expect(initial.progressPercent).toBe(0);
    expect(initial.currentPosition.lat).toBeCloseTo(route.origin.lat, 2);

    // Step 10 ticks
    for (let i = 0; i < 10; i++) {
      driver.tick(1.0, 1.0);
    }

    const state = driver.getState();
    expect(state.currentDistanceM).toBeGreaterThan(0);
    expect(state.pointsSentCount).toBe(10);
    expect(state.currentSpeedKmh).toBeGreaterThan(15);
  });

  it('supports multiple independent concurrent drivers (1, 5, 10 drivers)', async () => {
    const engine = new SimulationEngine();

    // 1. Load 10 drivers scenario
    const ok = await engine.loadScenario('multiple_drivers');
    expect(ok).toBe(true);

    const drivers = engine.getAllDrivers();
    expect(drivers.length).toBe(10);

    // Verify drivers operate independently
    const d1 = drivers[0]!;
    const d2 = drivers[1]!;
    expect(d1.driverId).not.toBe(d2.driverId);
    expect(d1.route.name).not.toBe(d2.route.name);

    // Pause d1 only
    engine.toggleDriverPause(d1.driverId);
    expect(d1.getState().status).toBe('PAUSED');
    expect(d2.getState().status).toBe('RUNNING');

    // Trigger event on d2 only
    engine.triggerDriverEvent(d2.driverId, 'rough_road');
    expect(d2.getState().status).toBe('EVENT');
    expect(d2.getState().activeEvent?.type).toBe('rough_road');
  });

  it('handles simulation speed controls and pause/resume', () => {
    const engine = new SimulationEngine();
    expect(engine.getStats().isPaused).toBe(false);

    engine.togglePause();
    expect(engine.getStats().isPaused).toBe(true);

    engine.togglePause();
    expect(engine.getStats().isPaused).toBe(false);

    expect(engine.increaseSpeed()).toBe(2);
    expect(engine.increaseSpeed()).toBe(5);
    expect(engine.increaseSpeed()).toBe(10);
    expect(engine.decreaseSpeed()).toBe(5);
  });
});
