#pragma once
#include "globals.h"
#include "sensors.h"

#include <Preferences.h>

inline void saveCalibration() {
  Preferences prefs;
  prefs.begin("roadscore", false);
  prefs.putFloat("gx", calib.gravity[0]);
  prefs.putFloat("gy", calib.gravity[1]);
  prefs.putFloat("gz", calib.gravity[2]);
  prefs.end();
  Serial.println("Saved calibration to NVS.");
}

inline void loadSavedCalibration() {
  Preferences prefs;
  prefs.begin("roadscore", true);
  if (prefs.isKey("gx")) {
    calib.gravity[0] = prefs.getFloat("gx", 0.0f);
    calib.gravity[1] = prefs.getFloat("gy", 0.0f);
    calib.gravity[2] = prefs.getFloat("gz", cfg::GRAVITY_COUNTS);
    float mag = norm3(calib.gravity);
    if (mag >= cfg::GRAVITY_COUNTS * 0.5f && mag <= cfg::GRAVITY_COUNTS * 1.5f) {
      calib.state     = CalibState::Calibrated;
      calib.updatedAt = millis();
      Serial.printf("Loaded saved calibration from NVS: [%.0f, %.0f, %.0f]\n",
                    calib.gravity[0], calib.gravity[1], calib.gravity[2]);
    } else {
      calib.gravity[0] = 0.0f;
      calib.gravity[1] = 0.0f;
      calib.gravity[2] = cfg::GRAVITY_COUNTS;
      calib.state     = CalibState::Calibrating;
      Serial.println("Discarded invalid/zero calibration from NVS.");
    }
  }
  prefs.end();
}

// Learn the gravity vector, but only accept it when the unit is holding still and sensor is responding.
inline void attemptCalibration(CalibState reason) {
  float  sum[3] = {0, 0, 0};
  double magSum = 0, magSumSq = 0;
  const int n   = cfg::CALIB_WINDOW_MS / cfg::SAMPLE_INTERVAL_MS;

  for (int i = 0; i < n; i++) {
    int16_t ax, ay, az, gx, gy, gz;
    mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);
    sum[0] += ax; sum[1] += ay; sum[2] += az;
    float mag = sqrtf(float(ax) * ax + float(ay) * ay + float(az) * az);
    magSum   += mag;
    magSumSq += double(mag) * mag;
    serviceGPS(); // keep parsing incoming GPS bytes during calibration
    delay(cfg::SAMPLE_INTERVAL_MS);
  }

  float meanMag  = magSum / n;
  float variance = (magSumSq / n) - (double(meanMag) * meanMag);
  float stddev   = variance > 0 ? sqrtf(variance) : 0;

  if (stddev <= cfg::CALIB_MAX_STDDEV && meanMag >= (cfg::GRAVITY_COUNTS * 0.5f) && meanMag <= (cfg::GRAVITY_COUNTS * 1.5f)) {
    calib.gravity[0] = sum[0] / n;
    calib.gravity[1] = sum[1] / n;
    calib.gravity[2] = sum[2] / n;
    calib.state      = CalibState::Calibrated;
    calib.updatedAt  = millis();
    saveCalibration();
    Serial.printf("Calibrated: [%.0f, %.0f, %.0f] stddev=%.0f\n",
                  calib.gravity[0], calib.gravity[1], calib.gravity[2], stddev);
  } else {
    // Keep previous state if already calibrated from NVS
    if (calib.state != CalibState::Calibrated) {
      calib.state = reason;
    }
    if (meanMag < (cfg::GRAVITY_COUNTS * 0.5f)) {
      Serial.printf("Calibration skipped (sensor offline or zero reading, mag=%.0f)\n", meanMag);
    } else {
      Serial.printf("Calibration skipped (moving) stddev=%.0f\n", stddev);
    }
  }
}

// Re-learn gravity once the vehicle has been stopped and still for a while.
inline void maybeRecalibrate() {
  bool stopped = gps.speed.isValid() && gps.speed.kmph() < cfg::STOPPED_SPEED_KMH;
  if (!stopped)          { stoppedSince = 0; recalibratedThisStop = false; return; }
  if (stoppedSince == 0) { stoppedSince = millis(); return; }
  if (!recalibratedThisStop && (millis() - stoppedSince >= cfg::RECALIB_STILL_MS)) {
    attemptCalibration(CalibState::Recalibrating);
    recalibratedThisStop = true;
  }
}

inline bool checkSleepMode() {
  if (stoppedSince > 0 && (millis() - stoppedSince >= cfg::SLEEP_STILL_MS)) {
    return true;
  }
  return false;
}
