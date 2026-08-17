/**
 * Central Simulation Engine & Fleet Orchestrator
 */

import { getSimConfig } from '../config.js';
import { SupabaseIngestClient } from '../backend/supabase.js';
import { fetchOsrmRoute } from '../routing/osrm.js';
import { findPlaceByNameOrId, SRI_LANKA_PLACES } from '../routing/places.js';
import { PREDEFINED_SCENARIOS } from './scenarios.js';
import { SimulatedDriver, type DriverOptions } from './driver.js';
import type {
  DriverState,
  LatLon,
  LogEntry,
  ScenarioDefinition,
  SimEventType,
  SimulationRoute,
  SimulatorStats,
  SpeedProfile,
} from '../types.js';

export class SimulationEngine {
  private drivers: Map<string, SimulatedDriver> = new Map();
  private supabase: SupabaseIngestClient;
  private h3CellsObserved: Set<string> = new Set();
  private logs: LogEntry[] = [];
  private maxLogs = 500;

  private isPaused = false;
  private simSpeedMultiplier = 1;
  private speedLevels = [1, 2, 5, 10];
  private currentSpeedIdx = 0;

  private timer: NodeJS.Timeout | null = null;
  private startTime = Date.now();
  private tickIntervalMs = 1000;
  private routingStatus: 'OK' | 'OFFLINE' | 'FETCHING' | 'CACHED' = 'OK';
  private eventsTriggeredTotal = 0;

  constructor() {
    const config = getSimConfig();
    this.tickIntervalMs = config.tickRateMs;
    this.simSpeedMultiplier = config.defaultSimSpeed;
    this.currentSpeedIdx = Math.max(0, this.speedLevels.indexOf(this.simSpeedMultiplier));

    this.supabase = new SupabaseIngestClient({
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
      offlineMode: config.offlineMode,
      onError: (err) => {
        this.log('warn', `Supabase error: ${err.message}`);
      },
      onStatusChange: (status) => {
        if (status === 'OFFLINE') {
          this.log('warn', 'Supabase backend disconnected. Running in local demo mode.');
        } else if (status === 'OK') {
          this.log('info', 'Supabase telemetry endpoint connected successfully.');
        }
      },
    });

    this.log('info', 'RoadScore Simulator Engine initialized.');
  }

  public start(): void {
    if (this.timer) return;
    this.scheduleTick();
    this.log('info', `Simulation started (Speed: ${this.simSpeedMultiplier}x, Tick: ${this.tickIntervalMs}ms).`);
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public togglePause(): boolean {
    this.isPaused = !this.isPaused;
    this.log('info', this.isPaused ? 'Simulation PAUSED.' : 'Simulation RESUMED.');
    return this.isPaused;
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    this.log('info', paused ? 'Simulation PAUSED.' : 'Simulation RESUMED.');
  }

  public increaseSpeed(): number {
    if (this.currentSpeedIdx < this.speedLevels.length - 1) {
      this.currentSpeedIdx++;
      this.simSpeedMultiplier = this.speedLevels[this.currentSpeedIdx]!;
      this.log('info', `Simulation speed set to ${this.simSpeedMultiplier}x.`);
    }
    return this.simSpeedMultiplier;
  }

  public decreaseSpeed(): number {
    if (this.currentSpeedIdx > 0) {
      this.currentSpeedIdx--;
      this.simSpeedMultiplier = this.speedLevels[this.currentSpeedIdx]!;
      this.log('info', `Simulation speed set to ${this.simSpeedMultiplier}x.`);
    }
    return this.simSpeedMultiplier;
  }

  public setSpeedMultiplier(multiplier: number): void {
    this.simSpeedMultiplier = multiplier;
    this.currentSpeedIdx = this.speedLevels.indexOf(multiplier);
    if (this.currentSpeedIdx < 0) this.currentSpeedIdx = 0;
    this.log('info', `Simulation speed set to ${this.simSpeedMultiplier}x.`);
  }

  public async loadScenario(scenarioIdOrName: string): Promise<boolean> {
    const scenario = PREDEFINED_SCENARIOS.find(
      (s) => s.id.toLowerCase() === scenarioIdOrName.toLowerCase() || s.name.toLowerCase().includes(scenarioIdOrName.toLowerCase()),
    );

    if (!scenario) {
      this.log('warn', `Scenario '${scenarioIdOrName}' not found.`);
      return false;
    }

    this.log('info', `Loading scenario: ${scenario.name}...`);
    this.drivers.clear();

    for (const d of scenario.drivers) {
      let originCoords: LatLon;
      let originName = 'Origin';
      if (typeof d.origin === 'string') {
        const place = findPlaceByNameOrId(d.origin) || SRI_LANKA_PLACES[0]!;
        originCoords = { lat: place.lat, lon: place.lon };
        originName = place.name;
      } else {
        originCoords = d.origin;
        originName = `${d.origin.lat.toFixed(3)}, ${d.origin.lon.toFixed(3)}`;
      }

      let destCoords: LatLon;
      let destName = 'Destination';
      if (typeof d.destination === 'string') {
        const place = findPlaceByNameOrId(d.destination) || SRI_LANKA_PLACES[6]!;
        destCoords = { lat: place.lat, lon: place.lon };
        destName = place.name;
      } else {
        destCoords = d.destination;
        destName = `${d.destination.lat.toFixed(3)}, ${d.destination.lon.toFixed(3)}`;
      }

      try {
        const route = await fetchOsrmRoute(originCoords, destCoords, originName, destName);
        this.addDriver({
          driverId: d.driverId,
          vehicleId: d.vehicleId,
          route,
          speedProfile: d.speedProfile,
          loopOnComplete: d.loopOnComplete ?? true,
        });
      } catch (err: any) {
        this.log('error', `Failed to load route for ${d.driverId}: ${err.message}`);
      }
    }

    this.log('info', `Scenario '${scenario.name}' loaded with ${this.drivers.size} drivers.`);
    return true;
  }

  public addDriver(options: DriverOptions): SimulatedDriver {
    const driver = new SimulatedDriver(options);
    this.drivers.set(driver.driverId, driver);
    this.log('info', `Driver ${driver.driverId} (${driver.vehicleId}) added: ${driver.route.name}.`);
    return driver;
  }

  public removeDriver(driverId: string): boolean {
    const exists = this.drivers.delete(driverId);
    if (exists) {
      this.log('info', `Driver ${driverId} removed.`);
    }
    return exists;
  }

  public getDriver(driverId: string): SimulatedDriver | undefined {
    return this.drivers.get(driverId);
  }

  public getAllDrivers(): SimulatedDriver[] {
    return Array.from(this.drivers.values());
  }

  public getAllDriverStates(): DriverState[] {
    return Array.from(this.drivers.values()).map((d) => d.getState());
  }

  public toggleDriverPause(driverId: string): boolean {
    const driver = this.drivers.get(driverId);
    if (driver) {
      const isPaused = driver.togglePause();
      this.log('info', `Driver ${driverId} ${isPaused ? 'paused' : 'resumed'}.`);
      return isPaused;
    }
    return false;
  }

  public triggerDriverEvent(driverId: string, event: SimEventType, durationTicks = 4, magnitude?: number): void {
    const driver = this.drivers.get(driverId);
    if (driver) {
      driver.triggerEvent(event, durationTicks, magnitude);
      this.eventsTriggeredTotal++;
      this.log('event', `Driver ${driverId} triggered '${event}'.`);
    }
  }

  public clearDriverEvent(driverId: string): void {
    const driver = this.drivers.get(driverId);
    if (driver) {
      driver.clearEvent();
      this.log('info', `Driver ${driverId} event cleared.`);
    }
  }

  public log(level: LogEntry['level'], message: string): void {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] || '';
    this.logs.unshift({ timestamp: timeStr, level, message });
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
  }

  public clearLogs(): void {
    this.logs = [];
  }

  public getLogs(count = 50): LogEntry[] {
    return this.logs.slice(0, count);
  }

  public getStats(): SimulatorStats {
    let activeVehicles = 0;
    for (const d of this.drivers.values()) {
      const state = d.getState();
      if (state.status === 'RUNNING' || state.status === 'EVENT') {
        activeVehicles++;
      }
    }

    return {
      pointsSent: this.supabase.getTotalSent(),
      activeVehicles,
      totalVehicles: this.drivers.size,
      h3CellsObserved: this.h3CellsObserved,
      eventsTriggered: this.eventsTriggeredTotal,
      routingStatus: this.routingStatus,
      supabaseStatus: this.supabase.getStatus(),
      simSpeedMultiplier: this.simSpeedMultiplier,
      isPaused: this.isPaused,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  private scheduleTick(): void {
    const delay = Math.max(50, Math.round(this.tickIntervalMs / this.simSpeedMultiplier));
    this.timer = setTimeout(() => {
      this.onTick();
      this.scheduleTick();
    }, delay);
  }

  private onTick(): void {
    if (this.isPaused) return;

    for (const driver of this.drivers.values()) {
      const row = driver.tick(this.simSpeedMultiplier, 1.0);
      if (row) {
        // Track H3 cell
        const state = driver.getState();
        if (state.currentH3Cell) {
          this.h3CellsObserved.add(state.currentH3Cell);
        }

        // Post to Supabase queue
        this.supabase.enqueueRow(row);
      }
    }
  }
}
