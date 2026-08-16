#pragma once
#include "globals.h"

inline void setupGPS() {
  GPSSerial.setRxBufferSize(1024);
  GPSSerial.begin(9600, SERIAL_8N1, pins::GPS_RX, pins::GPS_TX);
}

inline void serviceGPS() {
  while (GPSSerial.available()) {
    gps.encode(GPSSerial.read());
  }
}
