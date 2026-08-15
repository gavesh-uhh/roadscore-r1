/**
 * Trip segmentation — ENGINE-PLAN §4 (the `trips` shape) and §9.
 *
 * A trip is the exposure denominator for scoring (§8: "normalised by exposure so
 * a 200 km motorway shift doesn't outscore a 5 km errand by accident"), so its
 * distance and duration are not decoration — they directly move every score.
 *
 * Trip ids are derived deterministically from (device, boot, start instant) via
 * `tripId()`, never `randomUUID()`, so a replay reproduces the same ids and the
 * §10 golden-file diff stays readable.
 */

import type { Sample, Trip } from '../types.js';
import { Flags } from '../types.js';
import type { Thresholds } from '../config/thresholds.js';
import type { DeviceState } from './state.js';
import { haversineM } from './state.js';
import { tripId } from '../util/hash.js';

export interface TripTransition {
  opened?: Trip;
  closed?: Trip;
}

function openTrip(st: DeviceState, s: Sample, startedAt: number): Trip {
  return {
    id: tripId(st.deviceId, st.bootId, startedAt),
    deviceId: st.deviceId,
    driverId: st.meta.driverId,
    vehicleId: st.meta.vehicleId,
    bootId: st.bootId,
    startedAt,
    endedAt: null,
    startLat: s.lat,
    startLon: s.lon,
    endLat: null,
    endLon: null,
    distanceM: 0,
    durationS: null,
    movingS: 0,
    idleS: 0,
    maxSpeedKmh: 0,
    speedSumKmh: 0,
    speedSamples: 0,
    avgSpeedKmh: null,
    telemetryFrom: s.telemetryId,
    telemetryTo: s.telemetryId,
    gpsFixRows: 0,
    totalRows: 0,
    gpsCoverage: null,
    status: 'open',
  };
}

/**
 * Finalise a trip: compute the derived fields and decide whether it was real.
 *
 * A trip that never went anywhere is noise — a GPS wander while parked, or a
 * device power-cycling on a driveway. Marking it 'abandoned' rather than deleting
 * it keeps the record auditable while excluding it from rollups (§8).
 */
function closeTrip(
  trip: Trip,
  endedAt: number,
  endLat: number | null,
  endLon: number | null,
  cfg: Thresholds,
  reason: string,
): Trip {
  trip.endedAt = endedAt;
  trip.endLat = endLat;
  trip.endLon = endLon;
  trip.durationS = Math.max(0, Math.round(endedAt - trip.startedAt));
  trip.avgSpeedKmh =
    trip.speedSamples > 0 ? trip.speedSumKmh / trip.speedSamples : null;
  trip.gpsCoverage = trip.totalRows > 0 ? trip.gpsFixRows / trip.totalRows : null;

  const tooShort =
    trip.distanceM < cfg.trip.minDistanceM && (trip.durationS ?? 0) < cfg.trip.minDurationS;
  trip.status = tooShort ? 'abandoned' : 'closed';
  return trip;
}

/**
 * Advance trip state by one sample.
 *
 * Called once per normalised sample, before the detectors, so that any event a
 * detector emits can be attributed to the trip that is open at that instant.
 */
export function updateTrip(
  st: DeviceState,
  s: Sample,
  cfg: Thresholds,
  rebooted: boolean,
): TripTransition {
  const out: TripTransition = {};

  // -------------------------------------------------------------------------
  // §9: "Device reboot mid-trip → close trip, flush state, open new."
  //
  // normalize() has already flushed the ring by the time we are called, but the
  // trip survives on the state precisely so it can be closed here with a real
  // end position rather than being silently dropped.
  // -------------------------------------------------------------------------
  if (rebooted && st.trip !== null) {
    const last = st.lastRowTSec ?? s.tSec;
    out.closed = closeTrip(st.trip, last, st.lastTripLat, st.lastTripLon, cfg, 'reboot');
    st.trip = null;
    st.movingSinceTSec = null;
    st.stationarySinceTSec = null;
  }

  // -------------------------------------------------------------------------
  // Stale: no data for long enough that whatever happened in between is
  // unknowable. Abandon rather than pretend the vehicle sat still (§9).
  // -------------------------------------------------------------------------
  const prevT = st.lastRowTSec;
  if (st.trip !== null && prevT !== null && s.tSec - prevT > cfg.trip.staleAbandonS) {
    out.closed = closeTrip(st.trip, prevT, st.lastTripLat, st.lastTripLon, cfg, 'stale');
    st.trip = null;
    st.movingSinceTSec = null;
    st.stationarySinceTSec = null;
  }

  const moving = Number.isFinite(s.speed) && s.speed >= cfg.trip.startSpeed;
  const stationary = Number.isFinite(s.speed) && s.speed < cfg.duty.idleSpeed;

  // -------------------------------------------------------------------------
  // Open: sustained movement. The dwell requirement stops a GPS speed spike on
  // a parked vehicle from opening a trip.
  // -------------------------------------------------------------------------
  if (moving) {
    st.stationarySinceTSec = null;
    if (st.movingSinceTSec === null) st.movingSinceTSec = s.tSec;

    if (st.trip === null && s.tSec - st.movingSinceTSec >= cfg.trip.startSustainedS) {
      // Backdate the start to when movement actually began, not when we became
      // convinced of it — otherwise every trip loses its first few seconds.
      const trip = openTrip(st, s, st.movingSinceTSec);
      st.trip = trip;
      out.opened = trip;
    }
  } else {
    st.movingSinceTSec = null;
    if (stationary && st.stationarySinceTSec === null) st.stationarySinceTSec = s.tSec;
  }

  // -------------------------------------------------------------------------
  // Accumulate. Distance uses consecutive usable fixes only; a leg across a
  // GPS outage is not measurable and must not be invented.
  // -------------------------------------------------------------------------
  const trip = st.trip;
  if (trip !== null) {
    trip.totalRows++;
    const hasFix = (s.flags & Flags.GPS_FIX) !== 0;
    if (hasFix) trip.gpsFixRows++;

    const dt = prevT !== null && s.tSec > prevT ? Math.min(s.tSec - prevT, 5) : 0;
    if (moving) trip.movingS += dt;
    else if (stationary) trip.idleS += dt;

    if (Number.isFinite(s.speed)) {
      const kmh = s.speed * 3.6;
      trip.maxSpeedKmh = Math.max(trip.maxSpeedKmh, kmh);
      trip.speedSumKmh += kmh;
      trip.speedSamples++;
    }

    if (
      s.lat !== null &&
      s.lon !== null &&
      (s.flags & Flags.GPS_USABLE) !== 0 &&
      st.lastTripLat !== null &&
      st.lastTripLon !== null
    ) {
      const step = haversineM(st.lastTripLat, st.lastTripLon, s.lat, s.lon);
      // Reject teleports: a step implying a speed far beyond the vehicle's is a
      // fix jump, not travel. 80 m/s over a 1 s row is ~288 km/h.
      if (Number.isFinite(step) && (dt === 0 ? step < 80 : step / Math.max(dt, 0.001) < 80)) {
        trip.distanceM += step;
      }
    }

    trip.telemetryTo = s.telemetryId;
    if (trip.telemetryFrom === null) trip.telemetryFrom = s.telemetryId;

    // -----------------------------------------------------------------------
    // Close: stationary for long enough to call it the end.
    // -----------------------------------------------------------------------
    if (st.stationarySinceTSec !== null && s.tSec - st.stationarySinceTSec >= cfg.trip.endStationaryS) {
      out.closed = closeTrip(trip, s.tSec, s.lat, s.lon, cfg, 'stationary');
      st.trip = null;
      st.stationarySinceTSec = null;
    }
  }

  // Remember the last usable position for the next distance step and for closing
  // a trip after a gap.
  if (s.lat !== null && s.lon !== null && (s.flags & Flags.GPS_USABLE) !== 0) {
    st.lastTripLat = s.lat;
    st.lastTripLon = s.lon;
  }
  st.lastRowTSec = s.tSec;

  return out;
}

/**
 * Force-close an open trip — used at shutdown and when a device is evicted from
 * the state map after 30 minutes of silence (§9, "Runaway state").
 */
export function forceCloseTrip(st: DeviceState, cfg: Thresholds): Trip | null {
  if (st.trip === null) return null;
  const trip = closeTrip(
    st.trip,
    st.lastRowTSec ?? st.trip.startedAt,
    st.lastTripLat,
    st.lastTripLon,
    cfg,
    'evicted',
  );
  st.trip = null;
  return trip;
}
