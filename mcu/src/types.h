#pragma once
#include <Arduino.h>
#include <math.h>
#include "config.h"

enum class CalibState { Calibrating, Calibrated, Recalibrating };

struct Calibration {
  float      gravity[3] = {0, 0, cfg::GRAVITY_COUNTS};
  CalibState state      = CalibState::Calibrating;
  uint32_t   updatedAt  = 0;

  const char* stateName() const {
    switch (state) {
      case CalibState::Calibrating:   return "calibrating";
      case CalibState::Calibrated:    return "calibrated";
      case CalibState::Recalibrating: return "recalibrating";
    }
    return "unknown";
  }
};

struct Window {
  uint32_t samples = 0;
  int16_t  ax = 0, ay = 0, az = 0, gx = 0, gy = 0, gz = 0;
  float    vertPeak = 0, horizPeak = 0, accelMagPeak = 0;
  float    yawRatePeak = 0, pitchRatePeak = 0, rollRatePeak = 0, gyroMagPeak = 0;
  double   vertSumSq = 0;
  int      micPeak = 0;
  double   micSumSq = 0;
};

struct PostItem { char body[1536]; };

static inline float dot3(const float a[3], const float b[3]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

static inline float norm3(const float v[3]) {
  return sqrtf(dot3(v, v));
}
