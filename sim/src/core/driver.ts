/**
 * Driver & Vehicle Entity Simulator
 */

import type {
  ActiveEvent,
  DriverState,
  DriverStatus,
  LatLon,
  PhysicalTelemetry,
  SimEventType,
  SimulationRoute,
  SpeedProfile,
  TelemetryRow,
} from '../types.js';
import { TelemetryGenerator } from './telemetry.js';

export interface DriverOptions {
  driverId: string;
  vehicleId: string;
  tripId?: string;
  route: SimulationRoute;
  speedProfile?: SpeedProfile;
  initialSpeedKmh?: number;
  loopOnComplete?: boolean;
  h3Resolution?: number;
}

export class SimulatedDriver {
  readonly driverId: string;
  readonly vehicleId: string;
  readonly tripId: string;
  readonly route: SimulationRoute;

  private status: DriverStatus = 'RUNNING';
  private speedProfile: SpeedProfile;
  private currentDistanceM = 0;
  private currentSpeedKmh = 0;
  private targetSpeedKmh = 45;
  private previousSpeedKmh = 0;
  private currentPosition: LatLon;
  private currentHeading = 0;
  private previousHeading = 0;
  private currentRouteIndex = 0;
  private activeEvent: ActiveEvent | null = null;
  private lastTelemetry: PhysicalTelemetry | null = null;
  private pointsSentCount = 0;
  private eventsTriggeredCount = 0;
  private loopOnComplete = true;
  private isPaused = false;
  private tickCount = 0;

  private readonly generator: TelemetryGenerator;

  constructor(options: DriverOptions) {
    this.driverId = options.driverId;
    this.vehicleId = options.vehicleId;
    this.tripId = options.tripId || `trip_${options.driverId}_${Date.now()}`;
    this.route = options.route;
    this.speedProfile = options.speedProfile || 'normal';
    this.loopOnComplete = options.loopOnComplete ?? true;

    this.currentPosition = { ...this.route.origin };
    this.currentHeading = this.route.points[0]?.segmentHeadingDeg || 0;
    this.previousHeading = this.currentHeading;

    this.configureSpeedProfile();

    this.generator = new TelemetryGenerator({
      deviceId: this.vehicleId,
      h3Resolution: options.h3Resolution || 12,
      fwVersion: '1.0.0-sim',
    });
  }

  private configureSpeedProfile(): void {
    switch (this.speedProfile) {
      case 'aggressive':
        this.targetSpeedKmh = 65;
        this.currentSpeedKmh = 30;
        break;
      case 'worst':
        this.targetSpeedKmh = 95;
        this.currentSpeedKmh = 50;
        break;
      case 'cautious':
        this.targetSpeedKmh = 35;
        this.currentSpeedKmh = 10;
        break;
      case 'erratic':
        this.targetSpeedKmh = 55;
        this.currentSpeedKmh = 25;
        break;
      case 'normal':
      default:
        this.targetSpeedKmh = 48;
        this.currentSpeedKmh = 20;
        break;
    }
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    this.status = paused ? 'PAUSED' : this.activeEvent ? 'EVENT' : 'RUNNING';
  }

  public togglePause(): boolean {
    this.setPaused(!this.isPaused);
    return this.isPaused;
  }

  public triggerEvent(
    type: SimEventType,
    durationTicks = 3,
    magnitude?: number,
  ): void {
    if (type === 'normal') {
      this.activeEvent = null;
      this.status = this.isPaused ? 'PAUSED' : 'RUNNING';
      return;
    }

    const labels: Record<SimEventType, string> = {
      normal: 'Normal driving',
      rough_road: 'Rough road segment',
      hard_brake: 'Hard braking',
      hard_accel: 'Hard acceleration',
      sharp_turn: 'Sharp cornering',
      swerve: 'Aggressive swerving',
      impact: 'Pothole impact',
      pothole: 'Pothole cluster',
    };

    this.activeEvent = {
      type,
      label: labels[type] || type,
      remainingTicks: durationTicks,
      magnitude: magnitude || (type === 'impact' ? 6.5 : type === 'hard_brake' ? 5.8 : 3.8),
      startedAt: Date.now(),
    };

    this.eventsTriggeredCount++;
    this.status = 'EVENT';
  }

  public clearEvent(): void {
    this.activeEvent = null;
    this.status = this.isPaused ? 'PAUSED' : 'RUNNING';
  }

  /**
   * Advance driver simulation state forward by deltaSec (scaled by speedMultiplier).
   */
  public tick(simSpeedMultiplier = 1.0, baseDeltaSec = 1.0): TelemetryRow | null {
    if (this.isPaused || this.status === 'COMPLETED') {
      return null;
    }

    this.tickCount++;
    const effectiveDt = baseDeltaSec * simSpeedMultiplier;

    // 1. Manage active event lifecycle
    if (this.activeEvent) {
      this.activeEvent.remainingTicks -= effectiveDt;
      if (this.activeEvent.remainingTicks <= 0) {
        this.activeEvent = null;
        this.status = 'RUNNING';
      }
    }

    // 2. Realistic speed dynamics
    this.previousSpeedKmh = this.currentSpeedKmh;

    if (this.activeEvent?.type === 'hard_brake') {
      this.currentSpeedKmh = Math.max(5, this.currentSpeedKmh - 25 * effectiveDt);
    } else if (this.activeEvent?.type === 'hard_accel') {
      this.currentSpeedKmh = Math.min(110, this.currentSpeedKmh + 20 * effectiveDt);
    } else {
      // Natural cruising variations
      const speedNoise = Math.sin(this.tickCount * 0.2) * 3;
      const targetWithNoise = Math.max(10, this.targetSpeedKmh + speedNoise);
      if (this.currentSpeedKmh < targetWithNoise) {
        this.currentSpeedKmh = Math.min(targetWithNoise, this.currentSpeedKmh + 6.0 * effectiveDt);
      } else {
        this.currentSpeedKmh = Math.max(targetWithNoise, this.currentSpeedKmh - 5.0 * effectiveDt);
      }
    }

    // 3. Move along route geometry
    const speedMps = (this.currentSpeedKmh * 1000) / 3600;
    const distanceDeltaM = speedMps * effectiveDt;
    this.currentDistanceM += distanceDeltaM;

    // Check completion
    if (this.currentDistanceM >= this.route.totalDistanceM) {
      if (this.loopOnComplete) {
        this.currentDistanceM = this.currentDistanceM % this.route.totalDistanceM;
        this.currentRouteIndex = 0;
      } else {
        this.currentDistanceM = this.route.totalDistanceM;
        this.status = 'COMPLETED';
      }
    }

    // 4. Interpolate exact Lat/Lon and smoothly advance heading
    this.updatePositionAndHeading(effectiveDt);

    // 5. Generate Physical Telemetry & Format Row
    const telemetry = this.generator.generatePhysics(
      this.currentPosition.lat,
      this.currentPosition.lon,
      this.currentSpeedKmh,
      this.previousSpeedKmh,
      this.currentHeading,
      this.previousHeading,
      this.speedProfile,
      this.activeEvent,
      effectiveDt,
    );

    this.lastTelemetry = telemetry;
    this.pointsSentCount++;

    const row = this.generator.formatRow(telemetry, new Date(), effectiveDt);
    return row;
  }

  private updatePositionAndHeading(effectiveDt = 1.0): void {
    const points = this.route.points;
    if (!points || points.length === 0) return;

    if (this.currentDistanceM <= 0) {
      const p = points[0]!;
      this.currentPosition = { lat: p.lat, lon: p.lon };
      this.currentHeading = p.segmentHeadingDeg;
      this.previousHeading = this.currentHeading;
      return;
    }

    if (this.currentDistanceM >= this.route.totalDistanceM) {
      const p = points[points.length - 1]!;
      this.currentPosition = { lat: p.lat, lon: p.lon };
      this.currentHeading = p.segmentHeadingDeg;
      this.previousHeading = this.currentHeading;
      return;
    }

    // Find current segment
    while (
      this.currentRouteIndex < points.length - 1 &&
      points[this.currentRouteIndex + 1]!.distanceFromStartM < this.currentDistanceM
    ) {
      this.currentRouteIndex++;
    }

    const pA = points[this.currentRouteIndex]!;
    const pB = points[Math.min(this.currentRouteIndex + 1, points.length - 1)]!;

    const segLength = pB.distanceFromStartM - pA.distanceFromStartM;
    let t = 0;
    if (segLength > 0.001) {
      t = (this.currentDistanceM - pA.distanceFromStartM) / segLength;
      t = Math.max(0, Math.min(1, t));
    }

    this.currentPosition = {
      lat: pA.lat + (pB.lat - pA.lat) * t,
      lon: pA.lon + (pB.lon - pA.lon) * t,
    };

    // Smooth heading changes over time to emulate automotive steering dynamics
    const targetHeading = pA.segmentHeadingDeg;
    let diff = targetHeading - this.currentHeading;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;

    const isHarshTurn =
      this.activeEvent?.type === 'sharp_turn' ||
      this.activeEvent?.type === 'swerve' ||
      this.speedProfile === 'aggressive' ||
      this.speedProfile === 'worst';
    const maxTurnRateDegPerSec = isHarshTurn ? 35.0 : 6.0;
    const maxStep = maxTurnRateDegPerSec * effectiveDt;

    let newHeading = this.currentHeading;
    if (Math.abs(diff) <= maxStep) {
      newHeading = targetHeading;
    } else {
      newHeading = (this.currentHeading + Math.sign(diff) * maxStep + 360) % 360;
    }

    this.previousHeading = this.currentHeading;
    this.currentHeading = Number(newHeading.toFixed(1));
  }

  public getState(): DriverState {
    const progressPercent = Math.min(
      100,
      Math.round((this.currentDistanceM / (this.route.totalDistanceM || 1)) * 100),
    );

    return {
      driverId: this.driverId,
      vehicleId: this.vehicleId,
      tripId: this.tripId,
      route: this.route,
      status: this.status,
      speedProfile: this.speedProfile,
      currentDistanceM: Math.round(this.currentDistanceM),
      progressPercent,
      currentSpeedKmh: this.currentSpeedKmh,
      targetSpeedKmh: this.targetSpeedKmh,
      currentPosition: this.currentPosition,
      currentHeading: this.currentHeading,
      currentH3Cell: this.lastTelemetry?.h3Cell || '',
      currentRouteIndex: this.currentRouteIndex,
      activeEvent: this.activeEvent,
      lastTelemetry: this.lastTelemetry,
      pointsSentCount: this.pointsSentCount,
      eventsTriggeredCount: this.eventsTriggeredCount,
      loopOnComplete: this.loopOnComplete,
      isPaused: this.isPaused,
    };
  }
}
