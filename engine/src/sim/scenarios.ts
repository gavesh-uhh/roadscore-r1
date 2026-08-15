/**
 * Physical Driving Scenarios & Hardware Edge Case Generators — ENGINE-PLAN §2, §6, §10.
 *
 * Provides realistic physical telemetry sequences for evaluating engine detectors,
 * trip segmentation, arbitration, prediction, scoring, and hardware fault tolerance.
 */

import { HardwareDevice, type PhysicalState } from './device.js';
import type { RawRow } from '../types.js';

/** Colombo center coordinate anchor (Galle Road near Kollupitiya) */
const BASE_LAT = 6.915;
const BASE_LON = 79.852;

function baseState(): PhysicalState {
  return {
    lat: BASE_LAT,
    lon: BASE_LON,
    speedKmh: 45,
    heading: 180, // Heading South down Galle Road
    gpsFix: true,
    sats: 9,
    hdop: 1.0,
    verticalAccelMps2: 0.8 + (Math.random() - 0.5) * 0.4, // Baseline road vibration AC peak (0.08g)
    horizontalPeakMps2: 0.5 + Math.random() * 0.3,
    magnitudePeakMps2: 9.85 + Math.random() * 0.4,
    yawRateRadps: 0.02 * (Math.random() - 0.5),
    pitchRateRadps: 0.01 * (Math.random() - 0.5),
    rollRateRadps: 0.01 * (Math.random() - 0.5),
    micRms: 150 + Math.random() * 50,
    micPeak: 300 + Math.random() * 100,
    samplesCount: 50,
    wifiRssi: -65,
  };
}

/** 1. Smooth Commute: 2 minutes clean driving with acceleration and stopping */
export function generateSmoothCommute(
  device: HardwareDevice,
  durationSec = 120,
  startTime: Date = new Date(),
): RawRow[] {
  const rows: RawRow[] = [];
  let currentLat = BASE_LAT;
  let currentLon = BASE_LON;
  let currentSpeed = 0;

  for (let sec = 0; sec < durationSec; sec++) {
    const t = new Date(startTime.getTime() + sec * 1000);

    // Speed profile: accelerate 0 -> 50 km/h, cruise at 50 km/h, decelerate to 0 at light
    if (sec < 10) {
      currentSpeed += 5.0; // Smooth +5 km/h per sec (~1.38 m/s²)
    } else if (sec < durationSec - 30) {
      currentSpeed = 50 + Math.sin(sec / 5) * 2;
    } else if (sec < durationSec - 15) {
      currentSpeed = Math.max(0, currentSpeed - 3.3); // Smooth stop (~0.9 m/s²)
    } else {
      currentSpeed = 0; // Stopped at traffic light
    }

    const distDeg = (currentSpeed / 3600) * 0.009;
    currentLat -= distDeg; // Heading South

    const state = baseState();
    state.lat = Number(currentLat.toFixed(6));
    state.lon = Number(currentLon.toFixed(6));
    state.speedKmh = Number(currentSpeed.toFixed(1));
    state.heading = 180;
    state.horizontalPeakMps2 = currentSpeed > 0 ? 0.8 : 0.2;

    rows.push(device.step(state, t));
  }

  return rows;
}

/** 2. Aggressive Driver: Harsh braking, harsh accel, sharp corner, excessive speed, swerving */
export function generateAggressiveDrive(
  device: HardwareDevice,
  startTime: Date = new Date(),
): RawRow[] {
  const rows: RawRow[] = [];
  let speed = 40;
  let lat = BASE_LAT;
  let lon = BASE_LON;
  let heading = 180;

  for (let sec = 0; sec < 70; sec++) {
    const t = new Date(startTime.getTime() + sec * 1000);
    const state = baseState();

    // Warmup: sec 0..5: Normal driving at 40 km/h
    if (sec < 6) {
      speed = 40;
      state.horizontalPeakMps2 = 0.5;
    }
    // Event 1: Harsh Acceleration at sec 7..10 (Speed jumps 20 -> 75 km/h in 3s = +5.0 m/s²)
    else if (sec >= 7 && sec <= 10) {
      if (sec === 7) speed = 20;
      speed += 18.0;
      state.horizontalPeakMps2 = 5.2;
    }
    // Event 2: Severe Harsh Braking at sec 15..19 (Speed drops 75 -> 10 km/h in 4s = -4.5 m/s²)
    else if (sec >= 15 && sec <= 19) {
      if (sec === 15) speed = 75;
      speed -= 16.0;
      state.horizontalPeakMps2 = 5.5;
    }
    // Event 3: Aggressive Sharp Cornering at sec 26..30 (Speed 60 km/h, Yaw rate 0.40 rad/s = 23 deg/s)
    else if (sec >= 26 && sec <= 30) {
      speed = 60;
      const turnDps = 23;
      heading = (heading + turnDps) % 360;
      state.yawRateRadps = 0.40;
      state.horizontalPeakMps2 = (speed / 3.6) * 0.40; // 6.67 m/s² lateral Gs
    }
    // Event 4: High-speed Swerving at sec 38..46 (Weave oscillations with small net heading change)
    else if (sec >= 38 && sec <= 46) {
      speed = 55;
      const phase = ((sec - 38) % 4 < 2) ? 1 : -1;
      heading = (heading + phase * 12 + 360) % 360;
      state.yawRateRadps = 0.36;
      state.horizontalPeakMps2 = (speed / 3.6) * 0.36; // 5.5 m/s²
    }
    // Event 5: Second Severe Harsh Braking at sec 52..55 (Speed drops 65 -> 10 km/h)
    else if (sec >= 52 && sec <= 55) {
      if (sec === 52) speed = 65;
      speed -= 18.0;
      state.horizontalPeakMps2 = 5.8;
    }
    // Event 6: Rough Speeding at sec 60..68 (Speed 85 km/h over rough surface)
    else if (sec >= 60 && sec <= 68) {
      speed = 85;
      state.verticalAccelMps2 = 2.4;
      state.horizontalPeakMps2 = 1.8;
    } else {
      speed = 48 + Math.sin(sec) * 3;
      state.horizontalPeakMps2 = 0.5;
      state.yawRateRadps = 0.01;
    }

    const rad = (heading * Math.PI) / 180;
    lat += ((speed / 3600) * 0.009) * Math.cos(rad);
    lon += ((speed / 3600) * 0.009) * Math.sin(rad);

    state.heading = heading;
    state.lat = Number(lat.toFixed(6));
    state.lon = Number(lon.toFixed(6));
    state.speedKmh = Number(Math.max(0, speed).toFixed(1));

    rows.push(device.step(state, t));
  }

  return rows;
}

/** 3. Pothole Cluster: Passing over rough road with vertical impact spikes & mic energy */
export function generatePotholeCluster(
  device: HardwareDevice,
  startTime: Date = new Date(),
): RawRow[] {
  const rows: RawRow[] = [];
  let lat = BASE_LAT;

  for (let sec = 0; sec < 40; sec++) {
    const t = new Date(startTime.getTime() + sec * 1000);
    const state = baseState();
    state.speedKmh = 40;

    // Pothole 1 at sec 10 (Moderate bump)
    if (sec === 10) {
      state.verticalAccelMps2 = 14.5; // ~1.48g
      state.magnitudePeakMps2 = 15.0;
      state.micPeak = 1200;
    }
    // Pothole 2 at sec 20 (Severe pothole, clipped counts)
    else if (sec === 20) {
      state.verticalAccelMps2 = 22.0; // > 2g, rails ADC
      state.magnitudePeakMps2 = 23.5;
      state.micPeak = 2800;
    }
    // Pothole 3 at sec 30 (Moderate bump)
    else if (sec === 30) {
      state.verticalAccelMps2 = 15.2;
      state.magnitudePeakMps2 = 15.8;
      state.micPeak = 1400;
    }

    lat -= (40 / 3600) * 0.009;
    state.lat = Number(lat.toFixed(6));
    state.lon = Number(BASE_LON.toFixed(6));

    rows.push(device.step(state, t));
  }

  return rows;
}

/** 4. Tunnel / Underpass: GPS Fix loss mid-trip, then fix re-acquisition */
export function generateTunnelUnderpass(
  device: HardwareDevice,
  startTime: Date = new Date(),
): RawRow[] {
  const rows: RawRow[] = [];
  let lat = BASE_LAT;

  for (let sec = 0; sec < 50; sec++) {
    const t = new Date(startTime.getTime() + sec * 1000);
    const state = baseState();
    state.speedKmh = 50;

    // Tunnel entry at sec 15..35 (GPS Fix Lost)
    if (sec >= 15 && sec <= 35) {
      state.gpsFix = false;
      state.sats = 0;
      state.hdop = 99.0;
      state.lat = null;
      state.lon = null;
      state.speedKmh = null;
    } else {
      lat -= (50 / 3600) * 0.009;
      state.lat = Number(lat.toFixed(6));
      state.lon = Number(BASE_LON.toFixed(6));
    }

    rows.push(device.step(state, t));
  }

  return rows;
}

/** 5. Mount Displacement: Phone / sensor mount knocked 25 degrees mid-drive */
export function generateMountDisplacement(
  device: HardwareDevice,
  startTime: Date = new Date(),
): RawRow[] {
  const rows: RawRow[] = [];
  let lat = BASE_LAT;

  for (let sec = 0; sec < 40; sec++) {
    const t = new Date(startTime.getTime() + sec * 1000);
    const state = baseState();
    state.speedKmh = 40;

    // Sudden mount bump at sec 18 (25 deg roll shift)
    if (sec === 18) {
      device.shiftMount(25, 5);
    }

    lat -= (40 / 3600) * 0.009;
    state.lat = Number(lat.toFixed(6));
    state.lon = Number(BASE_LON.toFixed(6));

    rows.push(device.step(state, t));
  }

  return rows;
}

/** 6. Power Cycle Reboot: ESP32 power brownout mid-drive */
export function generatePowerCycleReboot(
  device: HardwareDevice,
  startTime: Date = new Date(),
): RawRow[] {
  const rows: RawRow[] = [];
  let lat = BASE_LAT;

  for (let sec = 0; sec < 40; sec++) {
    const t = new Date(startTime.getTime() + sec * 1000);
    const state = baseState();
    state.speedKmh = 45;

    // ESP32 reboot at sec 20
    if (sec === 20) {
      device.reboot();
    }

    lat -= (45 / 3600) * 0.009;
    state.lat = Number(lat.toFixed(6));
    state.lon = Number(BASE_LON.toFixed(6));

    rows.push(device.step(state, t));
  }

  return rows;
}

/** 7. Hardware Faults: Stuck MPU6050 sensor or low sampling rate loop */
export function generateHardwareFaults(
  device: HardwareDevice,
  faultType: 'stuck_sensor' | 'low_sample_rate',
  startTime: Date = new Date(),
): RawRow[] {
  const rows: RawRow[] = [];
  let lat = BASE_LAT;

  for (let sec = 0; sec < 30; sec++) {
    const t = new Date(startTime.getTime() + sec * 1000);
    const state = baseState();
    state.speedKmh = 40;

    if (faultType === 'stuck_sensor' && sec >= 10) {
      // Static frozen MPU values across consecutive rows
      state.verticalAccelMps2 = 0.8;
      state.horizontalPeakMps2 = 0.5;
      state.magnitudePeakMps2 = 9.82;
      state.yawRateRadps = 0;
    } else if (faultType === 'low_sample_rate' && sec >= 10) {
      // Starving MCU sampling loop
      state.samplesCount = 18; // Below min required 40 samples
    }

    lat -= (40 / 3600) * 0.009;
    state.lat = Number(lat.toFixed(6));
    state.lon = Number(BASE_LON.toFixed(6));

    rows.push(device.step(state, t));
  }

  return rows;
}

/** 8. Collision Crash: Severe impact + speed collapse + loud mic peak */
export function generateCollisionCrash(
  device: HardwareDevice,
  startTime: Date = new Date(),
): RawRow[] {
  const rows: RawRow[] = [];
  let lat = BASE_LAT;
  let speed = 60;

  for (let sec = 0; sec < 20; sec++) {
    const t = new Date(startTime.getTime() + sec * 1000);
    const state = baseState();

    if (sec === 10) {
      // Collision instant: clipped impact + acoustic spike + instant speed collapse
      state.verticalAccelMps2 = 35.0; // > 3.5g
      state.horizontalPeakMps2 = 30.0;
      state.magnitudePeakMps2 = 45.0;
      state.micPeak = 3950;
      speed = 0; // Collapsed instantly
    } else if (sec > 10) {
      speed = 0; // Stationary post-crash
    }

    if (speed > 0) lat -= (speed / 3600) * 0.009;
    state.lat = Number(lat.toFixed(6));
    state.lon = Number(BASE_LON.toFixed(6));
    state.speedKmh = speed;

    rows.push(device.step(state, t));
  }

  return rows;
}

/** 9. Poisoned Attacker: Invalid speed or position outside Sri Lanka bounds */
export function generatePoisonedAttacker(
  device: HardwareDevice,
  startTime: Date = new Date(),
): RawRow[] {
  const rows: RawRow[] = [];

  // Row 1: Speed > 250 km/h
  const state1 = baseState();
  state1.speedKmh = 320;
  rows.push(device.step(state1, startTime));

  // Row 2: Lat/Lon in Middle of Indian Ocean (0.0, 0.0)
  const state2 = baseState();
  state2.lat = 0.0;
  state2.lon = 0.0;
  rows.push(device.step(state2, new Date(startTime.getTime() + 1000)));

  // Row 3: Samples > 60
  const state3 = baseState();
  state3.samplesCount = 99;
  rows.push(device.step(state3, new Date(startTime.getTime() + 2000)));

  return rows;
}

/** 10. Driver Penalties Only: Generates ONLY scorable driver infractions (harsh braking, harsh acceleration, excessive cornering speed, swerving) on clean road with zero hardware faults */
export function generateDriverPenaltiesOnly(
  device: HardwareDevice,
  startTime: Date = new Date(),
): RawRow[] {
  const rows: RawRow[] = [];
  let speed = 40;
  let lat = BASE_LAT;
  let lon = BASE_LON;
  let heading = 180;

  for (let sec = 0; sec < 65; sec++) {
    const t = new Date(startTime.getTime() + sec * 1000);
    const state = baseState();

    // Pristine road and hardware conditions (no pothole impacts, no sensor faults)
    state.verticalAccelMps2 = 0.6;
    state.micRms = 140;
    state.micPeak = 220;
    state.gpsFix = true;
    state.sats = 10;
    state.hdop = 0.8;

    // Phase 1: Warmup cruising at 45 km/h (sec 0..4)
    if (sec < 5) {
      speed = 45;
      state.horizontalPeakMps2 = 0.5;
    }
    // Infraction 1: Violent Harsh Acceleration (sec 6..9: speed 15 -> 75 km/h in 3s = +5.5 m/s²)
    else if (sec >= 6 && sec <= 9) {
      if (sec === 6) speed = 15;
      else speed += 20.0;
      state.horizontalPeakMps2 = 5.6;
    }
    // Phase 2: Cruising (sec 10..13)
    else if (sec > 9 && sec < 14) {
      speed = 75;
      state.horizontalPeakMps2 = 0.6;
    }
    // Infraction 2: Severe Harsh Braking (sec 14..18: speed 75 -> 10 km/h in 4s = -4.5 m/s²)
    else if (sec >= 14 && sec <= 18) {
      if (sec === 14) speed = 75;
      else speed -= 16.0;
      state.horizontalPeakMps2 = 5.5;
    }
    // Phase 3: Cruising recovery (sec 19..24)
    else if (sec > 18 && sec < 25) {
      speed = 45;
      state.horizontalPeakMps2 = 0.5;
    }
    // Infraction 3: High-Speed Sharp Cornering (sec 25..29: speed 60 km/h, yaw rate 0.40 rad/s = 23 deg/s)
    else if (sec >= 25 && sec <= 29) {
      speed = 60;
      heading = (heading + 23) % 360;
      state.yawRateRadps = 0.40;
      state.horizontalPeakMps2 = (speed / 3.6) * 0.40; // 6.67 m/s² lateral Gs
    }
    // Phase 4: Cruising (sec 30..35)
    else if (sec > 29 && sec < 36) {
      speed = 50;
      state.horizontalPeakMps2 = 0.5;
      state.yawRateRadps = 0.01;
    }
    // Infraction 4: Dangerous Slalom Swerving (sec 36..44: speed 55 km/h, weave oscillation)
    else if (sec >= 36 && sec <= 44) {
      speed = 55;
      const phase = ((sec - 36) % 4 < 2) ? 1 : -1;
      heading = (heading + phase * 12 + 360) % 360;
      state.yawRateRadps = 0.36;
      state.horizontalPeakMps2 = (speed / 3.6) * 0.36; // 5.5 m/s²
    }
    // Phase 5: High-speed stretch (sec 45..49)
    else if (sec > 44 && sec < 50) {
      speed = 70;
      state.horizontalPeakMps2 = 0.5;
      state.yawRateRadps = 0.01;
    }
    // Infraction 5: Emergency Harsh Braking Stop (sec 50..54: speed 70 -> 5 km/h = -4.5 m/s²)
    else if (sec >= 50 && sec <= 54) {
      if (sec === 50) speed = 70;
      else speed -= 16.0;
      state.horizontalPeakMps2 = 6.0;
    }
    // Cooldown post infractions (sec 55..64)
    else {
      speed = 35;
      state.horizontalPeakMps2 = 0.4;
      state.yawRateRadps = 0.01;
    }

    const rad = (heading * Math.PI) / 180;
    lat += ((speed / 3600) * 0.009) * Math.cos(rad);
    lon += ((speed / 3600) * 0.009) * Math.sin(rad);

    state.heading = heading;
    state.lat = Number(lat.toFixed(6));
    state.lon = Number(lon.toFixed(6));
    state.speedKmh = Number(Math.max(0, speed).toFixed(1));

    rows.push(device.step(state, t));
  }

  return rows;
}

/** 11. Worst / Reckless Driver: Extreme high-speed tailgating, violent sharp cornering, rapid slalom swerving, and catastrophic brake checks */
export function generateWorstDriver(
  device: HardwareDevice,
  startTime: Date = new Date(),
): RawRow[] {
  const rows: RawRow[] = [];
  let speed = 50;
  let lat = BASE_LAT;
  let lon = BASE_LON;
  let heading = 180;

  for (let sec = 0; sec < 80; sec++) {
    const t = new Date(startTime.getTime() + sec * 1000);
    const state = baseState();

    state.verticalAccelMps2 = 0.7;
    state.micRms = 220;
    state.micPeak = 450;
    state.gpsFix = true;
    state.sats = 11;
    state.hdop = 0.8;

    // 0..4s: Violent Jackrabbit launch from standstill
    if (sec < 5) {
      if (sec === 0) speed = 0;
      speed += 22.0; // 0 -> 88 km/h in 4 seconds (+6.1 m/s²)
      state.horizontalPeakMps2 = 6.8;
      state.yawRateRadps = 0.05;
    }
    // 5..11s: Severe Speeding in urban zone (95-105 km/h)
    else if (sec >= 5 && sec <= 11) {
      speed = 102 + Math.sin(sec) * 4;
      state.horizontalPeakMps2 = 1.2;
      state.yawRateRadps = 0.02;
    }
    // 12..16s: Tailgate panic brake slam (105 -> 20 km/h in 4s = -5.9 m/s²)
    else if (sec >= 12 && sec <= 16) {
      if (sec === 12) speed = 105;
      else speed -= 22.0;
      state.horizontalPeakMps2 = 7.2; // Critical harsh brake
      state.yawRateRadps = 0.08;
    }
    // 17..23s: Immediate aggressive re-acceleration (20 -> 90 km/h)
    else if (sec >= 17 && sec <= 23) {
      speed += 12.0;
      state.horizontalPeakMps2 = 5.8;
    }
    // 24..30s: Violent High-Speed Sharp Cornering (80 km/h with 0.45 rad/s yaw rate = 26 deg/s)
    else if (sec >= 24 && sec <= 30) {
      speed = 82;
      heading = (heading + 26) % 360;
      state.yawRateRadps = 0.45; // Critical sharp turn
      state.horizontalPeakMps2 = (speed / 3.6) * 0.45; // 10.25 m/s²
    }
    // 31..35s: Straight speed burst (88 km/h)
    else if (sec > 30 && sec < 36) {
      speed = 88;
      state.horizontalPeakMps2 = 0.8;
      state.yawRateRadps = 0.01;
    }
    // 36..46s: Aggressive Rapid Slalom Swerving without gap (Oscillating at 85 km/h)
    else if (sec >= 36 && sec <= 46) {
      speed = 85;
      const phase = ((sec - 36) % 4 < 2) ? 1 : -1;
      heading = (heading + phase * 14 + 360) % 360;
      state.yawRateRadps = 0.40; // Critical swerving
      state.horizontalPeakMps2 = (speed / 3.6) * 0.40; // 9.44 m/s²
    }
    // 47..53s: Extreme Speeding Stretch (115 km/h)
    else if (sec >= 47 && sec <= 53) {
      speed = 115 + (sec % 3) * 2;
      state.horizontalPeakMps2 = 1.5;
    }
    // 54..59s: Second Severe Harsh Brake Check (115 -> 15 km/h = -5.5 m/s²)
    else if (sec >= 54 && sec <= 59) {
      if (sec === 54) speed = 115;
      else speed -= 20.0;
      state.horizontalPeakMps2 = 7.5;
    }
    // 60..67s: Second Violent Sharp Turn (75 km/h, 24 deg/s)
    else if (sec >= 60 && sec <= 67) {
      speed = 76;
      heading = (heading - 24 + 360) % 360;
      state.yawRateRadps = 0.42;
      state.horizontalPeakMps2 = (speed / 3.6) * 0.42;
    }
    // 68..79s: Final brake and rolling stop
    else {
      speed = Math.max(0, speed - 7.0);
      state.horizontalPeakMps2 = 3.2;
      state.yawRateRadps = 0.01;
    }

    const rad = (heading * Math.PI) / 180;
    lat += ((speed / 3600) * 0.009) * Math.cos(rad);
    lon += ((speed / 3600) * 0.009) * Math.sin(rad);

    state.heading = heading;
    state.lat = Number(lat.toFixed(6));
    state.lon = Number(lon.toFixed(6));
    state.speedKmh = Number(Math.max(0, speed).toFixed(1));

    rows.push(device.step(state, t));
  }

  return rows;
}
