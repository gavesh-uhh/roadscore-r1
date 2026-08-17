'use client';

/**
 * DemoSimulator — In-Browser Simulation Studio engine (DRIVER_VIEW_PLAN §5)
 *
 * A single deterministic state pipeline that powers the /driver cockpit from
 * either:
 *  - Option A: Live ESP32 telemetry routed in via `ingestLiveTelemetry()`
 *    and `ingestLiveDrivingEvent()` (Fastify SSE fast-path), or
 *  - Option B: In-browser 1-click scenario triggers (Simulation Studio).
 *
 * The simulator owns vehicle kinematics (speed easing → a_long, lateral model
 * → a_lat), the 300 m Hazard Horizon countdown, TrueScore™ Shield exoneration
 * arbitration (§3.1), and the Eco-Glide coasting coach (§3.4).
 */

export type HazardKind = 'pothole' | 'speed_bump' | 'sharp_curve' | 'water_pooling' | 'traffic_queue';

export type Lane = 'left' | 'center' | 'right';

export type HazardSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface HorizonHazard {
  id: string;
  kind: HazardKind;
  title: string;
  /** Remaining distance to the hazard in meters (counts down with speed). */
  distanceM: number;
  lane: Lane;
  advisorySpeedKmh?: number;
  advisory?: string;
  severity: HazardSeverity;
  /** Spoken announcement copy for the Tier-1 voice engine. */
  speech: string;
  /** Epoch ms when the hazard was injected. */
  spawnedAt: number;
  /** Set once the Tier-1 proximity voice alert has fired. */
  alertAnnounced?: boolean;
  /** Projected geo position (for the trip map) when known. */
  lat?: number;
  lon?: number;
}

export interface GeoPosition {
  lat: number;
  lon: number;
  headingDeg: number;
}

export interface TripState {
  active: boolean;
  startedAt: number | null;
  distanceM: number;
  durationS: number;
  eventsCount: number;
  hazardsCleared: number;
}

export interface ScoreBreakdown {
  longitudinal: number;
  lateral: number;
  speedCompliance: number;
  eco: number;
}

export interface GForces {
  /** Longitudinal acceleration (m/s²). Negative = braking. */
  aLong: number;
  /** Lateral acceleration (m/s²). Positive = right-hand cornering load. */
  aLat: number;
}

export interface CockpitSnapshot {
  speedKmh: number;
  speedLimitKmh: number;
  g: GForces;
  hazards: HorizonHazard[];
  /** Live TrueScore™ trip score (0–100). */
  score: number;
  deductions: number;
  protectedCount: number;
  smoothnessPct: number;
  ecoSavedPct: number;
  /** True while Eco-Glide coaching is actively coasting. */
  coasting: boolean;
  /** Virtual/live vehicle position for the trip map. */
  position: GeoPosition;
  /** Trip lifecycle state (Idle → Active → Ended). */
  trip: TripState;
  /** Sub-score breakdown bars (0–100 each). */
  breakdown: ScoreBreakdown;
  /** True while the scripted Auto-Drive demo is running. */
  autoDrive: boolean;
  updatedAt: number;
}

export type SimEvent =
  | { type: 'hazard-spawned'; hazard: HorizonHazard }
  | { type: 'hazard-approaching'; hazard: HorizonHazard }
  | { type: 'hazard-passed'; hazard: HorizonHazard }
  | { type: 'exoneration'; title: string; message: string }
  | { type: 'deduction'; title: string; message: string; points: number }
  | { type: 'eco-tip'; title: string; message: string }
  | { type: 'harsh-maneuver'; g: GForces; label: string }
  | { type: 'severe-crash'; lat: number; lon: number; speedKmh: number; impactG: number }
  | { type: 'trip-started'; startedAt: number }
  | { type: 'trip-ended'; stats: TripState };

export interface LiveTelemetry {
  speedKmh: number;
  aLong?: number;
  aLat?: number;
  lat?: number;
  lon?: number;
  headingDeg?: number;
}

const GRAVITY = 9.81;
const HARSH_BRAKE_MPS2 = -3.0;
const EXONERATION_WINDOW_S = 3.0;
const HAZARD_ALERT_RADIUS_M = 150;
const MAX_RANGE_M = 300;
const TICK_MS = 50;

let hazardSeq = 0;
function nextHazardId(): string {
  hazardSeq += 1;
  return `hz_${Date.now().toString(36)}_${hazardSeq}`;
}

export class DemoSimulator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private snapshotListeners = new Set<(s: CockpitSnapshot) => void>();
  private eventListeners = new Set<(e: SimEvent) => void>();

  // Kinematics
  private speedKmh = 0;
  private targetSpeedKmh = 0;
  private speedLimitKmh = 60;
  private g: GForces = { aLong: 0, aLat: 0 };
  private prevSpeedMps = 0;
  private simClockS = 0;

  // Scripted kinematic impulses (slam brake, corner load) decay back to zero.
  private impulseALong = 0;
  private impulseALat = 0;

  // Horizon + scoring
  private hazards: HorizonHazard[] = [];
  private score = 100;
  private deductions = 0;
  private protectedCount = 0;
  private smoothnessPct = 98;
  private ecoSavedPct = 4;
  private coasting = false;
  private coastRemainingS = 0;
  private lastHarshAtMs: number | null = null;
  private lastHazardPassedAtMs: number | null = null;
  /** Vehicle speed at the instant the harsh maneuver began — arbitration must
   *  judge the hazard window against THIS, not the post-slam crawl (BUG-2). */
  private maneuverSpeedMps = 0;

  // Live feed override — when set, kinematics come from the ESP32 stream.
  private live: LiveTelemetry | null = null;

  // ---- Virtual GPS & trip lifecycle (V2 §3.2/§3.3) -----------------------
  private position: GeoPosition = { lat: 6.9271, lon: 79.8612, headingDeg: 40 };
  private prevHeadingDeg = 40;
  private breadcrumbs: [number, number][] = [];
  private lastCrumb: [number, number] | null = null;
  private trip: TripState = {
    active: false,
    startedAt: null,
    distanceM: 0,
    durationS: 0,
    eventsCount: 0,
    hazardsCleared: 0,
  };
  private aboveStartSpeedS = 0;
  private belowStopSpeedS = 0;

  // ---- Score breakdown accumulators (V2 §3.7) ----------------------------
  private emaLong = 0;
  private emaLat = 0;
  private emaCompliance = 1;

  // ---- Auto-Drive scripted demo (V2 §3.6) --------------------------------
  private autoDriveOn = false;
  private autoT = 0;
  private autoStepIdx = 0;

  // ---------------------------------------------------------------------
  // Lifecycle & subscriptions
  // ---------------------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  subscribe(fn: (s: CockpitSnapshot) => void): () => void {
    this.snapshotListeners.add(fn);
    fn(this.getSnapshot());
    return () => this.snapshotListeners.delete(fn);
  }

  onEvent(fn: (e: SimEvent) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  private emit(e: SimEvent): void {
    // Trip bookkeeping: count reportable events; cleared hazards tally.
    if (this.trip.active) {
      if (
        e.type === 'hazard-spawned' ||
        e.type === 'exoneration' ||
        e.type === 'deduction' ||
        e.type === 'eco-tip' ||
        e.type === 'harsh-maneuver'
      ) {
        this.trip.eventsCount += 1;
      }
      if (e.type === 'hazard-passed') {
        this.trip.hazardsCleared += 1;
      }
    }
    this.eventListeners.forEach((fn) => {
      try {
        fn(e);
      } catch {
        // listener errors must not break the sim loop
      }
    });
  }

  getSnapshot(): CockpitSnapshot {
    return {
      speedKmh: this.speedKmh,
      speedLimitKmh: this.speedLimitKmh,
      g: { ...this.g },
      hazards: this.hazards.map((h) => ({ ...h })),
      score: Math.round(this.score),
      deductions: this.deductions,
      protectedCount: this.protectedCount,
      smoothnessPct: Math.round(this.smoothnessPct),
      ecoSavedPct: Math.round(this.ecoSavedPct),
      coasting: this.coasting,
      position: { ...this.position },
      trip: { ...this.trip },
      breakdown: {
        longitudinal: Math.round(clamp((1 - this.emaLong) * 100, 0, 100)),
        lateral: Math.round(clamp((1 - this.emaLat) * 100, 0, 100)),
        speedCompliance: Math.round(clamp(this.emaCompliance * 100, 0, 100)),
        eco: Math.round(clamp(70 + this.ecoSavedPct * 1.2, 0, 100)),
      },
      autoDrive: this.autoDriveOn,
      updatedAt: Date.now(),
    };
  }

  // ---------------------------------------------------------------------
  // Simulation Studio controls (Option B)
  // ---------------------------------------------------------------------

  /** Speed slider (0–120 km/h). Ignored while live feed drives the vehicle. */
  setTargetSpeed(kmh: number): void {
    this.targetSpeedKmh = Math.max(0, Math.min(120, kmh));
  }

  triggerPothole(distanceM = 60): void {
    this.spawnHazard({
      kind: 'pothole',
      title: 'Severe Pothole',
      distanceM,
      lane: 'left',
      severity: 'high',
      advisory: 'Stay Right',
      speech: `Caution. Severe pothole on the left in ${Math.round(distanceM)} meters. Hold right.`,
    });
  }

  triggerSpeedBump(distanceM = 40): void {
    this.spawnHazard({
      kind: 'speed_bump',
      title: 'Unmarked Speed Bump',
      distanceM,
      lane: 'center',
      severity: 'medium',
      advisorySpeedKmh: 20,
      advisory: 'Target: 20 km/h',
      speech: `Speed bump ahead in ${Math.round(distanceM)} meters. Ease down to twenty kilometers per hour.`,
    });
  }

  triggerSharpCurve(distanceM = 180): void {
    this.spawnHazard({
      kind: 'sharp_curve',
      title: 'Sharp Hairpin Bend',
      distanceM,
      lane: 'right',
      severity: 'high',
      advisorySpeedKmh: 35,
      advisory: 'Advised: 35 km/h',
      speech: `Sharp hairpin bend in ${Math.round(distanceM)} meters. Advised speed thirty five.`,
    });
  }

  triggerWaterPooling(distanceM = 120): void {
    this.spawnHazard({
      kind: 'water_pooling',
      title: 'Water Pooling',
      distanceM,
      lane: 'right',
      severity: 'low',
      advisory: 'Grip Reduced',
      speech: `Water pooling on the right in ${Math.round(distanceM)} meters. Expect reduced grip.`,
    });
  }

  /** Apply a scripted lateral cornering load (used by Auto-Drive). */
  applyCornerLoad(mps2 = 2.6): void {
    this.impulseALat = mps2 * (Math.random() > 0.5 ? 1 : -1);
  }

  /** Manually clear a hazard from the horizon queue. */
  dismissHazard(id: string): void {
    this.hazards = this.hazards.filter((h) => h.id !== id);
  }

  /** §3.4 — coach the driver to lift off and coast toward a queue. */
  triggerEcoGlide(): void {
    this.spawnHazard({
      kind: 'traffic_queue',
      title: 'Traffic Slowing',
      distanceM: 200,
      lane: 'center',
      severity: 'info',
      advisory: 'Lift & Coast',
      speech: 'Traffic slowing in two hundred meters. Lift off the throttle and coast.',
    });
    this.coasting = true;
    this.coastRemainingS = 6;
    this.ecoSavedPct = Math.min(25, this.ecoSavedPct + 2);
    this.emit({
      type: 'eco-tip',
      title: 'Eco-Glide',
      message: 'Traffic slowing in 200m — Lift throttle now and coast to glide smoothly.',
    });
  }


  /**
   * §3.1 demo — slam the brakes (−4.5 m/s²). If no hazard is currently on
   * the horizon, one is injected so the TrueScore™ Shield story always lands:
   * the harsh stop is recognized as hazard avoidance and 0 points are deducted.
   */
  slamBrakesAndExonerate(): void {
    const now = Date.now();
    const speedMps = Math.max(this.speedKmh / 3.6, 1);

    // Guarantee the §3.1 story: if no hazard sits inside the 3-second
    // exoneration window right now, inject one just inside it so the harsh
    // stop is unambiguously recognized as hazard avoidance.
    const imminent = this.hazards.some(
      (h) =>
        h.distanceM > -5 &&
        (h.distanceM / speedMps <= EXONERATION_WINDOW_S + 1.5 || h.distanceM <= 35),
    );
    const recentlyPassed =
      this.lastHazardPassedAtMs !== null &&
      now - this.lastHazardPassedAtMs <= EXONERATION_WINDOW_S * 1000;
    if (!imminent && !recentlyPassed) {
      // Land just inside the arbitration window at ANY slider speed (BUG-2).
      const d = Math.round(Math.min(30, Math.max(12, speedMps * 2.0)));
      this.spawnHazard({
        kind: 'pothole',
        title: 'Severe Pothole',
        distanceM: d,
        lane: 'left',
        severity: 'high',
        advisory: 'Stay Right',
        speech: `Caution. Severe pothole on the left in ${d} meters.`,
      });
    }

    // Physical harsh stop: −4.5 m/s² impulse decaying over ~1 s.
    this.impulseALong = -4.5;
    this.lastHarshAtMs = now;
    this.maneuverSpeedMps = speedMps;
    this.emit({ type: 'harsh-maneuver', g: { ...this.g, aLong: -4.5 }, label: 'Harsh Braking' });

    // TrueScore™ arbitration happens once the impulse registers in tick(),
    // but the exoneration decision itself is deterministic here (§3.1):
    // harsh maneuver within the 3 s hazard window → attributedToDriver: false.
    setTimeout(() => this.arbitrateHarshManeuver('Harsh braking'), 450);
  }

  /**
   * Severe Collision Crash & Automated 911 SOS trigger.
   * Simulates high-G impact (-6.8g), instant velocity drop to 0, and eCall event.
   */
  triggerSevereCrash(): void {
    const prevSpeed = this.speedKmh || 62;
    this.speedKmh = 0;
    this.targetSpeedKmh = 0;
    this.impulseALong = -6.8;
    this.impulseALat = 3.2;
    this.g = { aLong: -6.8, aLat: 3.2 };

    this.emit({
      type: 'severe-crash',
      lat: this.position.lat,
      lon: this.position.lon,
      speedKmh: prevSpeed,
      impactG: 6.8,
    });
  }

  // ---------------------------------------------------------------------
  // Live feed ingestion (Option A — Fastify SSE / Supabase CDC)
  // ---------------------------------------------------------------------

  /** Route live telemetry into the same cockpit pipeline. Pass null to release. */
  setLiveFeed(feed: LiveTelemetry | null): void {
    this.live = feed;
    if (feed === null) {
      // Seamless handoff: continue from the last live speed instead of
      // snapping to a stale slider target (BUG-5).
      this.targetSpeedKmh = this.speedKmh;
    }
  }

  // ---------------------------------------------------------------------
  // V2: virtual GPS, trip lifecycle, auto-drive
  // ---------------------------------------------------------------------

  /** Override the sim origin (e.g. from ?lat=&lon= for localized demos). */
  setOrigin(lat: number, lon: number): void {
    if (this.trip.active || this.breadcrumbs.length > 0) return;
    this.position.lat = lat;
    this.position.lon = lon;
  }

  /** Breadcrumb trail (shared mutable array — read-only for consumers). */
  getBreadcrumbs(): readonly [number, number][] {
    return this.breadcrumbs;
  }

  /** Live trip frames from the engine override the simulated trip machine. */
  ingestTripUpdate(t: { started_at?: string; ended_at?: string | null; distance_m?: number }): void {
    if (t.started_at && !t.ended_at && !this.trip.active) {
      this.beginTrip(new Date(t.started_at).getTime() || Date.now());
    } else if (t.ended_at && this.trip.active) {
      this.endTrip();
    }
    if (typeof t.distance_m === 'number' && this.trip.active) {
      this.trip.distanceM = Math.max(this.trip.distanceM, t.distance_m);
    }
  }

  /** §3.6 — scripted hands-free demo loop. Auto-pauses under live feed. */
  setAutoDrive(on: boolean): void {
    this.autoDriveOn = on;
    this.autoT = 0;
    this.autoStepIdx = 0;
    if (on && !this.live) this.setTargetSpeed(54);
  }

  toggleAutoDrive(): boolean {
    const next = !this.autoDriveOn;
    this.setAutoDrive(next);
    return next;
  }

  private beginTrip(atMs: number): void {
    this.trip = {
      active: true,
      startedAt: atMs,
      distanceM: 0,
      durationS: 0,
      eventsCount: 0,
      hazardsCleared: 0,
    };
    this.breadcrumbs = [];
    this.lastCrumb = [this.position.lat, this.position.lon];
    this.breadcrumbs.push(this.lastCrumb);
    this.emit({ type: 'trip-started', startedAt: atMs });
  }

  private endTrip(): void {
    this.trip.active = false;
    this.emit({ type: 'trip-ended', stats: { ...this.trip } });
  }

  ingestLiveTelemetry(t: LiveTelemetry): void {
    this.live = t;
  }

  /**
   * Feed a live driving event from the engine. Harsh maneuvers are arbitrated
   * against the current hazard horizon for automatic exoneration (§3.1);
   * road hazard predictions spawn horizon markers (§3.2).
   */
  ingestLiveDrivingEvent(evt: { type: string; magnitude?: number | null; severity?: string }): void {
    const mag = evt.magnitude != null ? Number(evt.magnitude) : null;
    switch (evt.type) {
      case 'driver.harsh_brake':
        this.impulseALong = Math.min(HARSH_BRAKE_MPS2, -(mag ?? 3.6));
        this.lastHarshAtMs = Date.now();
        this.maneuverSpeedMps = Math.max(this.speedKmh / 3.6, 1);
        this.emit({ type: 'harsh-maneuver', g: { ...this.g }, label: 'Harsh Braking' });
        this.arbitrateHarshManeuver('Harsh braking');
        break;
      case 'driver.sharp_corner':
      case 'driver.swerving':
        this.impulseALat = (evt.type === 'driver.swerving' ? 4.2 : 3.4) * (Math.random() > 0.5 ? 1 : -1);
        this.lastHarshAtMs = Date.now();
        this.maneuverSpeedMps = Math.max(this.speedKmh / 3.6, 1);
        this.emit({ type: 'harsh-maneuver', g: { ...this.g }, label: 'Sharp Lateral Maneuver' });
        this.arbitrateHarshManeuver('Sharp swerve');
        break;
      case 'road.hazard_ahead':
      case 'road.pothole_impact':
      case 'road.defect_observation':
        this.triggerPothole(90);
        break;
      case 'road.rough_segment_ahead':
      case 'road.rough_segment':
        this.triggerWaterPooling(120);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------
  // Core arbitration — TrueScore™ Shield (§3.1)
  // ---------------------------------------------------------------------

  private arbitrateHarshManeuver(label: string): void {
    const now = Date.now();
    // Judge the window against the speed at maneuver START (BUG-2): by the
    // time arbitration runs the car may have nearly stopped, which would
    // inflate every ETA and wrongly attribute the maneuver to the driver.
    const judgeMps = Math.max(this.maneuverSpeedMps, this.speedKmh / 3.6, 1);

    // A hazard counts as "within the window" when its ETA at maneuver speed
    // is under ~3 s (+1.5 s maneuver slack), when it is physically close
    // (≤35 m), or when we passed it less than 3 s ago.
    const approaching = this.hazards.find(
      (h) =>
        h.distanceM > -8 &&
        (h.distanceM / judgeMps <= EXONERATION_WINDOW_S + 1.5 || h.distanceM <= 35),
    );
    const recentlyPassed =
      this.lastHazardPassedAtMs !== null && now - this.lastHazardPassedAtMs <= EXONERATION_WINDOW_S * 1000;

    if (approaching || recentlyPassed) {
      this.protectedCount += 1;
      this.smoothnessPct = Math.min(100, this.smoothnessPct + 1);
      this.emit({
        type: 'exoneration',
        title: 'TrueScore™ Shield',
        message: `${label} recognized as hazard avoidance — 0 points deducted! Safe defensive driving.`,
      });
    } else {
      // No hazard context — the maneuver is attributed to the driver (§3.1 inverse).
      this.deductions += 2;
      this.score = Math.max(0, this.score - 2);
      this.emit({
        type: 'deduction',
        title: 'Harsh Maneuver Recorded',
        message: `${label} with no hazard context — attributed to driver. −2 pts.`,
        points: 2,
      });
    }
  }

  // ---------------------------------------------------------------------
  // Physics tick (20 Hz)
  // ---------------------------------------------------------------------

  private spawnHazard(partial: Omit<HorizonHazard, 'id' | 'spawnedAt'>): void {
    const clampedDist = Math.min(MAX_RANGE_M, partial.distanceM);
    const hazard: HorizonHazard = {
      ...partial,
      distanceM: clampedDist,
      id: nextHazardId(),
      spawnedAt: Date.now(),
      // BUG-1: a hazard spawned already inside the alert radius is announced
      // by the spawn event itself — don't let the tick loop re-announce it.
      alertAnnounced: clampedDist <= HAZARD_ALERT_RADIUS_M,
    };
    // Project the hazard onto the map: vehicle position + distance along
    // heading + lane offset (perpendicular). Lets TripMap render it (V2 §3.4).
    if (partial.lat == null || partial.lon == null) {
      const rad = (this.position.headingDeg * Math.PI) / 180;
      const laneSign = hazard.lane === 'left' ? -1 : hazard.lane === 'right' ? 1 : 0;
      const laneMeters = laneSign * 1.8;
      const fwd = clampedDist;
      const dLat = fwd * Math.cos(rad) - laneMeters * Math.sin(rad);
      const dLon = fwd * Math.sin(rad) + laneMeters * Math.cos(rad);
      hazard.lat = this.position.lat + dLat / 111320;
      hazard.lon =
        this.position.lon +
        dLon / (111320 * Math.max(0.2, Math.cos((this.position.lat * Math.PI) / 180)));
    }
    this.hazards.push(hazard);
    this.hazards.sort((a, b) => a.distanceM - b.distanceM);
    this.emit({ type: 'hazard-spawned', hazard: { ...hazard } });
  }


  private tick(dt: number): void {
    this.simClockS += dt;

    if (this.live) {
      // ---- Live drive: kinematics arrive from the vehicle -------------
      const v = this.live.speedKmh / 3.6;
      const aLong = this.live.aLong ?? (v - this.prevSpeedMps) / dt;
      this.g.aLong = clamp(aLong, -8, 5);
      this.g.aLat = clamp(this.live.aLat ?? 0, -8, 8);
      this.speedKmh = this.live.speedKmh;
      this.prevSpeedMps = v;
      if (typeof this.live.lat === 'number' && typeof this.live.lon === 'number') {
        this.position.lat = this.live.lat;
        this.position.lon = this.live.lon;
      }
      if (typeof this.live.headingDeg === 'number') {
        this.position.headingDeg = this.live.headingDeg;
      }
    } else {
      // ---- Sim drive: ease speed toward the slider target -------------
      const targetMps = this.targetSpeedKmh / 3.6;
      const v = this.speedKmh / 3.6;
      const dv = targetMps - v;

      // Coasting (Eco-Glide) uses a gentle drag deceleration; otherwise a
      // comfort-capped acceleration model drives the speed easing.
      let accel: number;
      if (this.coasting) {
        accel = v > 0.5 ? -0.55 : 0;
      } else {
        // Demo-responsive easing: the slider is a presenter control, so the
        // caps (±3.5/4.2 m/s²) sit just past the harsh thresholds to make
        // speed changes feel immediate while the arrival remains smooth.
        accel = dv >= 0 ? clamp(dv / 0.9, 0, 3.5) : clamp(dv / 0.9, -4.2, 0);
        if (Math.abs(dv) < 0.08) accel = 0;
      }

      let newV: number;
      let aLong: number;

      // Scripted impulses (slam brake / corner load) override briefly and
      // decay back to zero with a physical feel.
      if (this.impulseALong !== 0) {
        // A slam owns the longitudinal channel — the driver is not applying
        // throttle mid-brake, so the easing model is suspended (BUG-4). The
        // impulse integrates 1:1: speedometer bleeds exactly what the G-orb
        // displays (−4.5 m/s² decaying over ~1 s ≈ 15 km/h scrubbed).
        aLong = this.impulseALong;
        newV = Math.max(0, v + this.impulseALong * dt);
        this.impulseALong *= Math.pow(0.35, dt);
        if (Math.abs(this.impulseALong) < 0.15) this.impulseALong = 0;
      } else {
        newV = Math.max(0, v + accel * dt);
        aLong = (newV - v) / dt;
      }
      if (this.impulseALat !== 0) {
        this.impulseALat *= Math.pow(0.05, dt);
        if (Math.abs(this.impulseALat) < 0.15) this.impulseALat = 0;
      }

      // ---- Procedural route: heading wanders in gentle S-curves, and the
      // resulting yaw rate couples into a_lat (a_lat = v · ω) so the map,
      // radar weave, and orb all agree physically (V2 §3.2) ----------------
      const t = this.simClockS;
      const headingTarget =
        40 + 55 * Math.sin(t * 0.045) + 25 * Math.sin(t * 0.011 + 1.7);
      const headingErr = headingTarget - this.position.headingDeg;
      const maxYawDps = 26; // deg/s — comfortable steering rate
      const yawDps = clamp(headingErr * 0.9, -maxYawDps, maxYawDps);
      this.prevHeadingDeg = this.position.headingDeg;
      this.position.headingDeg = (this.position.headingDeg + yawDps * dt + 360) % 360;
      const omega = (yawDps * Math.PI) / 180; // rad/s
      const routeALat = clamp(newV * omega, -2.6, 2.6);

      // Ambient lateral load: gentle road weave that scales with speed, plus
      // route curvature, plus any scripted cornering impulse.
      const weave = Math.sin(this.simClockS * 0.6) * Math.min(newV / 15, 1) * 0.35;
      this.g.aLat = weave + routeALat + this.impulseALat;
      this.g.aLong = clamp(aLong, -8, 5);

      this.speedKmh = newV * 3.6;
      this.prevSpeedMps = newV;

      // Integrate position along heading (meters → degrees).
      const rad = (this.position.headingDeg * Math.PI) / 180;
      const dMeters = newV * dt;
      this.position.lat += (dMeters * Math.cos(rad)) / 111320;
      this.position.lon +=
        (dMeters * Math.sin(rad)) / (111320 * Math.max(0.2, Math.cos((this.position.lat * Math.PI) / 180)));
    }

    // ---- Breadcrumbs (trip map trail) ------------------------------------
    {
      const { lat, lon } = this.position;
      const last = this.lastCrumb;
      const moved = last ? haversineM(last[0], last[1], lat, lon) : Infinity;
      if (moved > 5) {
        this.lastCrumb = [lat, lon];
        this.breadcrumbs.push([lat, lon]);
        if (this.breadcrumbs.length > 600) this.breadcrumbs.shift();
      }
    }

    // ---- Trip lifecycle state machine (V2 §3.3) ---------------------------
    if (this.speedKmh > 5) {
      this.aboveStartSpeedS += dt;
      this.belowStopSpeedS = 0;
    } else if (this.speedKmh < 0.5) {
      this.belowStopSpeedS += dt;
      this.aboveStartSpeedS = 0;
    } else {
      this.aboveStartSpeedS = 0;
      this.belowStopSpeedS = 0;
    }
    if (!this.trip.active && this.aboveStartSpeedS >= 3) {
      this.beginTrip(Date.now());
    } else if (this.trip.active && this.belowStopSpeedS >= 12) {
      this.endTrip();
      this.aboveStartSpeedS = 0;
      this.belowStopSpeedS = 0;
    }
    if (this.trip.active) {
      this.trip.distanceM += (this.speedKmh / 3.6) * dt;
      this.trip.durationS += dt;
    }

    // ---- Score breakdown EMAs (V2 §3.7) -----------------------------------
    this.emaLong += (clamp(Math.abs(this.g.aLong) / 4, 0, 1) - this.emaLong) * Math.min(1, dt * 0.8);
    this.emaLat += (clamp(Math.abs(this.g.aLat) / 3.5, 0, 1) - this.emaLat) * Math.min(1, dt * 0.8);
    const compliant = this.speedKmh <= this.speedLimitKmh + 3 ? 1 : 0.55;
    this.emaCompliance += (compliant - this.emaCompliance) * Math.min(1, dt * 0.5);

    // ---- Auto-Drive scripted demo loop (V2 §3.6) --------------------------
    if (this.autoDriveOn && !this.live) {
      this.autoT += dt;
      const steps = AUTO_DRIVE_SCRIPT;
      while (this.autoStepIdx < steps.length && this.autoT >= steps[this.autoStepIdx].t) {
        steps[this.autoStepIdx].run(this);
        this.autoStepIdx += 1;
      }
      if (this.autoStepIdx >= steps.length) {
        this.autoT = 0;
        this.autoStepIdx = 0;
      }
    }

    // ---- Coasting coach state -----------------------------------------
    if (this.coasting) {
      this.coastRemainingS -= dt;
      this.ecoSavedPct = Math.min(25, this.ecoSavedPct + dt * 0.35);
      if (this.coastRemainingS <= 0) this.coasting = false;
    }

    // ---- Hazard horizon countdown --------------------------------------
    const vMps = this.speedKmh / 3.6;
    const survivors: HorizonHazard[] = [];
    for (const h of this.hazards) {
      h.distanceM -= vMps * dt;

      // Tier-1 proximity re-alert the first time a long-range hazard crosses
      // the alert radius (BUG-6: distinct event — short chime, not re-speech).
      if (!h.alertAnnounced && h.distanceM <= HAZARD_ALERT_RADIUS_M && h.severity !== 'info') {
        h.alertAnnounced = true;
        this.emit({ type: 'hazard-approaching', hazard: { ...h } });
      }

      if (h.distanceM <= -8) {
        this.lastHazardPassedAtMs = Date.now();
        this.emit({ type: 'hazard-passed', hazard: { ...h } });
      } else {
        survivors.push(h);
      }
    }
    this.hazards = survivors;

    // ---- Smoothness index: EMA penalized by total G --------------------
    const totalG = Math.hypot(this.g.aLong, this.g.aLat) / GRAVITY;
    const instantaneous = clamp(1 - totalG / 0.5, 0, 1) * 100;
    this.smoothnessPct += (instantaneous - this.smoothnessPct) * Math.min(1, dt * 1.4);

    const snapshot = this.getSnapshot();
    this.snapshotListeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch {
        // listener errors must not break the sim loop
      }
    });
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Great-circle distance in meters (WGS84 spherical approximation). */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * §3.6 — Auto-Drive script: a looping ~40 s timeline that exercises every
 * cockpit scenario hands-free. Pauses automatically while a live feed drives.
 */
const AUTO_DRIVE_SCRIPT: Array<{ t: number; run: (sim: DemoSimulator) => void }> = [
  { t: 0.0, run: (s) => s.setTargetSpeed(54) },
  { t: 4.0, run: (s) => s.triggerPothole(120) },
  { t: 9.3, run: (s) => s.slamBrakesAndExonerate() }, // near-miss → Shield ✓
  { t: 11.5, run: (s) => s.setTargetSpeed(52) },
  { t: 16.0, run: (s) => s.triggerSpeedBump(110) },
  { t: 17.2, run: (s) => s.setTargetSpeed(20) }, // compliant slowdown
  { t: 25.0, run: (s) => s.setTargetSpeed(52) },
  { t: 27.0, run: (s) => s.triggerEcoGlide() },
  { t: 33.5, run: (s) => s.triggerSharpCurve(170) },
  { t: 36.0, run: (s) => s.applyCornerLoad() },
  { t: 40.0, run: () => undefined }, // loop point
];

export { GRAVITY, HARSH_BRAKE_MPS2, EXONERATION_WINDOW_S, MAX_RANGE_M };

