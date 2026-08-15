#pragma once
#include "globals.h"

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

inline void setupMPU() {
  mpu.initialize();
  mpu.setSleepEnabled(false);
  delay(100);
  mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_2);
  mpu.setFullScaleGyroRange(MPU6050_GYRO_FS_250);
  bool ok = mpu.testConnection();
  Serial.println(ok ? "MPU6050 OK @ 0x68" : "MPU6050 FAILED (check SDA/SCL wiring)");
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

  win.vertPeak     = max(win.vertPeak, fabsf(vertical));
  win.horizPeak    = max(win.horizPeak, horizontal);
  win.accelMagPeak = max(win.accelMagPeak, fabsf(accMag - gLen));
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
}

inline void serviceGPS() {
  while (GPSSerial.available()) gps.encode(GPSSerial.read());
}
