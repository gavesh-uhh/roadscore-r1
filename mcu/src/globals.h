#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <Wire.h>
#include <MPU6050.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

#include "../secrets.h"
#include "config.h"
#include "types.h"

extern MPU6050        mpu;
extern TinyGPSPlus    gps;
extern HardwareSerial GPSSerial;
extern WebServer      server;

extern Calibration calib;
extern Window      win;

extern QueueHandle_t postQueue;
extern SemaphoreHandle_t fsMutex;
extern String        lastPayload;
extern volatile int  lastPostCode;
extern volatile uint32_t lastPostAt;
extern volatile uint32_t droppedPosts;

extern uint32_t stoppedSince;
extern bool recalibratedThisStop;
extern uint32_t seq;
