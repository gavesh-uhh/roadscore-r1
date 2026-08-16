#pragma once
#include "globals.h"

#include "gps.h"

inline void triggerInstantSpikePush();

inline void recoverI2CBus(int sdaPin, int sclPin) {
  pinMode(sdaPin, INPUT_PULLUP);
  pinMode(sclPin, INPUT_PULLUP);
  delay(1);
  if (digitalRead(sdaPin) == LOW) {
    pinMode(sclPin, OUTPUT);
    for (int i = 0; i < 9; i++) {
      digitalWrite(sclPin, LOW);
      delayMicroseconds(5);
      digitalWrite(sclPin, HIGH);
      delayMicroseconds(5);
      if (digitalRead(sdaPin) == HIGH) break;
    }
    // Generate I2C STOP condition (SDA low -> SCL high -> SDA high)
    pinMode(sdaPin, OUTPUT);
    digitalWrite(sdaPin, LOW);
    digitalWrite(sclPin, LOW);
    delayMicroseconds(5);
    digitalWrite(sclPin, HIGH);
    delayMicroseconds(5);
    digitalWrite(sdaPin, HIGH);
    delayMicroseconds(5);
    pinMode(sdaPin, INPUT_PULLUP);
    pinMode(sclPin, INPUT_PULLUP);
  }
}

inline bool setupMPU() {
  Serial.println("\n--- Scanning I2C Bus ---");
  uint8_t count = 0;
  uint8_t detectedAddr = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  [I2C] Found device at address 0x%02X\n", addr);
      count++;
      if (addr == 0x68 || addr == 0x69) {
        detectedAddr = addr;
      }
    }
  }
  if (count == 0) {
    Serial.println("  [I2C] No devices responded! Check SDA (GPIO 21), SCL (GPIO 22), 3V3/5V, and GND.");
    return false;
  }

  if (detectedAddr == 0) {
    Serial.println("  [I2C] MPU6050 not found at 0x68 or 0x69!");
    return false;
  }

  if (detectedAddr == 0x69) {
    Serial.println("  [I2C] MPU6050 detected at alternate address 0x69 (AD0 is HIGH/floating)");
    mpu = MPU6050(0x69);
  } else {
    mpu = MPU6050(0x68);
  }

  Serial.println("--- Initializing MPU6050 ---");
  mpu.reset();
  delay(50);
  mpu.setSleepEnabled(false);
  mpu.setClockSource(MPU6050_CLOCK_PLL_XGYRO);
  delay(50);
  mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_2);
  mpu.setFullScaleGyroRange(MPU6050_GYRO_FS_250);

  bool connOk = mpu.testConnection();
  bool isSleeping = mpu.getSleepEnabled();
  uint8_t devId = mpu.getDeviceID();

  int16_t ax, ay, az, gx, gy, gz;
  mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);
  float mag = sqrtf(float(ax) * ax + float(ay) * ay + float(az) * az);

  Serial.printf("  Device ID (WHO_AM_I): 0x%02X\n", devId);
  Serial.printf("  Power State: %s\n", isSleeping ? "ASLEEP (Bit 6 set)" : "AWAKE (Active)");
  Serial.printf("  Raw Reading: Accel=[%d, %d, %d] (mag: %.0f LSB, expected ~16384)\n", ax, ay, az, mag);
  Serial.printf("               Gyro=[%d, %d, %d]\n", gx, gy, gz);

  if (connOk && !isSleeping && mag > 5000.0f) {
    Serial.println(">> MPU6050 STATUS: ACTIVE AND WOKE UP SUCCESSFULLY! <<\n");
    return true;
  } else {
    Serial.println(">> MPU6050 STATUS: FAILED (Check SDA/SCL, AD0 to GND, and VCC) <<\n");
    return false;
  }
}

inline void sampleSensors() {
  int16_t ax, ay, az, gx, gy, gz;
  mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);
  win.ax = ax; win.ay = ay; win.az = az;
  win.gx = gx; win.gy = gy; win.gz = gz;

  const float gLen = max(norm3(calib.gravity), 1.0f);
  const float gUnit[3] = {
    calib.gravity[0] / gLen, calib.gravity[1] / gLen, calib.gravity[2] / gLen
  };

  float acc[3]     = {float(ax), float(ay), float(az)};
  float accMag     = norm3(acc);
  float along      = dot3(acc, gUnit);
  float vertical   = along - gLen;
  float horizontal = sqrtf(max(accMag * accMag - along * along, 0.0f));

  float instVert   = fabsf(vertical);
  float instMag    = fabsf(accMag - gLen);

  win.vertPeak     = max(win.vertPeak, instVert);
  win.horizPeak    = max(win.horizPeak, horizontal);
  win.accelMagPeak = max(win.accelMagPeak, instMag);
  win.vertSumSq   += double(vertical) * vertical;

  float gyr[3]      = {float(gx), float(gy), float(gz)};
  win.yawRatePeak   = max(win.yawRatePeak, fabsf(dot3(gyr, gUnit)));
  win.pitchRatePeak = max(win.pitchRatePeak, fabsf(gyr[0]));
  win.rollRatePeak  = max(win.rollRatePeak, fabsf(gyr[1]));
  win.gyroMagPeak   = max(win.gyroMagPeak, norm3(gyr));

  // MAX4466 AC signal processing: subtract DC bias (~2048) to isolate sound amplitude
  int micRaw = analogRead(pins::MIC);
  int micAC  = abs(micRaw - cfg::MIC_DC_OFFSET);
  win.micPeak  = max(win.micPeak, micAC);
  win.micSumSq += double(micAC) * micAC;

  win.samples++;

  // Inline spike detection: > 2.5g (40960 counts at 2g scale, or > 2.5 * cfg::GRAVITY_COUNTS)
  // and at least 500ms has elapsed since the last instant push.
  constexpr float SPIKE_THRESHOLD = 2.5f * cfg::GRAVITY_COUNTS;
  uint32_t now = millis();
  if ((instVert > SPIKE_THRESHOLD || instMag > SPIKE_THRESHOLD) &&
      (now - lastInstantSpikeMs >= 500)) {
    lastInstantSpikeMs = now;
    triggerInstantSpikePush();
  }
}


