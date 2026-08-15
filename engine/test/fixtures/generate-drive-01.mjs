/**
 * Synthetic annotated drive — the stand-in for ENGINE-PLAN §10 step 2 until a
 * real scripted drive is captured.
 *
 * Profile (device dev-001, 1 Hz, 180 rows):
 *   rows   0- 19  parked
 *   rows  20- 39  accelerating to 50 km/h
 *   rows  40- 69  cruising at 50 km/h
 *   rows  70- 74  HARD BRAKE to a stop (~-3.9 m/s²)
 *   rows  75-119  accelerating back to 50 km/h
 *   rows  95- 96  POTHOLE (vertical peak ~5.6 m/s²)
 *   rows 120-129  cruising at 45 km/h
 *   rows 130-136  CORNER at 18 °/s   (a_lat ≈ 3.9 m/s² = 0.40 g)
 *   rows 137-179  cruising at 45 km/h
 *
 * PHYSICAL CONSISTENCY MATTERS. §6.1 requires `horizontal_peak` to contain the
 * longitudinal component (>= |a_long| - 0.5), and §6.2 requires the horizontal
 * peak to sit inside a consistency envelope around hypot(a_long, a_lat). A
 * fixture that declares a 3.9 m/s² brake while reporting a 1.1 m/s² horizontal
 * peak is not a hard test case, it is an impossible row — and the corroboration
 * rule correctly rejects it. So the accelerometer channels here are DERIVED from
 * the speed profile rather than asserted independently.
 *
 * The mic channel is likewise given real variance: a constant value trips
 * §6.7's "mic RMS variance is exactly zero" sensor-degraded rule, which is a
 * true positive against a flatlined fixture.
 */

const G = 9.80665;
const COUNTS_PER_G = 16384; // ±2 g full scale (§2.1)
const COUNTS_PER_DPS = 131.072; // ±250 dps full scale
const mps2ToCounts = (a) => Math.round((a / G) * COUNTS_PER_G);
const dpsToCounts = (d) => Math.round(d * COUNTS_PER_DPS);

const t0 = Date.UTC(2026, 7, 1, 6, 0, 0) / 1000;

/** Speed profile in km/h, by row index. */
function speedKmhAt(i) {
  if (i < 20) return 0;
  if (i < 40) return Math.min(50, (i - 20) * 3);
  if (i < 70) return 50;
  if (i < 75) return Math.max(0, 50 - (i - 69) * 14); // ~-3.9 m/s²
  if (i < 120) return Math.min(50, (i - 74) * 5);
  return 45;
}

const rows = [];
// A tiny deterministic PRNG so the fixture has texture without Math.random().
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

for (let i = 0; i < 180; i++) {
  const speed = speedKmhAt(i);
  const prev = i > 0 ? speedKmhAt(i - 1) : 0;
  const aLong = (speed - prev) / 3.6; // m/s² over a 1 s row, signed

  const pothole = i === 95 || i === 96;
  const corner = i >= 130 && i <= 136;
  const yawDps = corner ? 18 : 0.8 + rand() * 0.6;
  const speedMps = speed / 3.6;
  const aLat = corner ? (speedMps * (yawDps * Math.PI)) / 180 : 0;

  // Vertical: road texture, scaled with speed, plus the pothole spike.
  const vertRms = (pothole ? 2.2 : 0.35 + 0.25 * (speedMps / 13.9)) + rand() * 0.05;
  const vertPeak = pothole ? 5.6 + rand() * 0.1 : vertRms * 2.4 + rand() * 0.2;

  // Horizontal peak must CONTAIN the longitudinal and lateral components — this
  // is what §6.1's corroboration and §6.2's envelope actually check.
  const horizPeak = Math.hypot(aLong, aLat) * (0.95 + rand() * 0.1) + 0.35;
  const magPeak = Math.hypot(horizPeak, vertPeak);

  rows.push({
    id: i + 1,
    device_id: 'dev-001',
    ts: new Date((t0 + i) * 1000).toISOString(),
    uptime_ms: 60000 + i * 1000,
    seq: i + 1,
    samples: 50,
    accel_raw: {
      x: 10 + Math.round(rand() * 40),
      y: -20 + Math.round(rand() * 40),
      z: 16300 + Math.round(rand() * 60),
    },
    accel_cal: {
      vertical_peak: mps2ToCounts(vertPeak),
      vertical_rms: mps2ToCounts(vertRms),
      horizontal_peak: mps2ToCounts(horizPeak),
      magnitude_peak: mps2ToCounts(magPeak),
    },
    gyro_raw: { x: 1, y: 2, z: 3 },
    gyro_cal: {
      yaw_rate_peak: dpsToCounts(yawDps),
      pitch_rate_peak: dpsToCounts(1 + rand()),
      roll_rate_peak: dpsToCounts(0.7 + rand()),
    },
    gps: {
      fix: true,
      lat: 6.9271 + i * 0.00012,
      lon: 79.8612 + i * 0.00009,
      alt_m: 8,
      speed_kmh: speed,
      heading: corner ? 90 + (i - 130) * 12 : 90,
      sats: 9,
      hdop: 0.9,
    },
    // Real variance, so the §6.7 mic-flatline rule is not tripped by the fixture.
    mic: {
      rms: Math.round(1100 + rand() * 120 + speedMps * 8),
      peak: Math.round(pothole ? 3400 + rand() * 100 : 1500 + rand() * 200),
    },
    calibration: {
      state: 'calibrated',
      age_ms: 120000 + i * 1000,
      gravity_ref: { x: 120, y: -240, z: 16290 },
    },
    wifi_rssi: -62,
    server_received_at: new Date((t0 + i) * 1000 + 300).toISOString(),
  });
}

console.log(rows.map((r) => JSON.stringify(r)).join('\n'));
