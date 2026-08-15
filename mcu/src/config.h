#pragma once
#include <Arduino.h>

namespace pins {
  constexpr int LED     = 2;
  constexpr int MIC     = 34;
  constexpr int I2C_SDA = 21;
  constexpr int I2C_SCL = 22;
  constexpr int GPS_RX  = 16;
  constexpr int GPS_TX  = -1;   // unused; GPS is read-only
}

namespace cfg {
  constexpr uint32_t SAMPLE_INTERVAL_MS = 20;        // 50 Hz sampling
  constexpr uint32_t POST_INTERVAL_MS   = 1000;      // 1 Hz upload
  constexpr uint32_t CALIB_WINDOW_MS    = 1000;
  constexpr float    CALIB_MAX_STDDEV   = 400.0f;    // raw counts; lower = stricter
  constexpr float    STOPPED_SPEED_KMH  = 2.0f;
  constexpr uint32_t RECALIB_STILL_MS   = 3000;
  constexpr float    GRAVITY_COUNTS     = 16384.0f;  // ~1 g at ±2 g range
  constexpr int      MIC_DC_OFFSET      = 2048;      // MAX4466 DC bias on 12-bit ADC (VCC/2)
  constexpr uint32_t SLEEP_STILL_MS     = 300000;    // 5 minutes
}
