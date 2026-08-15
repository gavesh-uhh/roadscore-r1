#pragma once
#include "globals.h"

inline String buildPayload() {
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["seq"]       = seq;
  doc["uptime_ms"] = millis();
  doc["window_ms"] = cfg::POST_INTERVAL_MS;
  doc["samples"]   = win.samples;

  if (gps.time.isValid() && gps.date.isValid()) {
    char ts[25];
    snprintf(ts, sizeof(ts), "%04d-%02d-%02dT%02d:%02d:%02dZ",
             gps.date.year(), gps.date.month(), gps.date.day(),
             gps.time.hour(), gps.time.minute(), gps.time.second());
    doc["ts"] = ts;
  } else {
    time_t now;
    time(&now);
    if (now > 1000000000) {
      struct tm timeinfo;
      gmtime_r(&now, &timeinfo);
      char ts[25];
      strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
      doc["ts"] = ts;
    }
  }

  JsonObject c   = doc["calibration"].to<JsonObject>();
  JsonArray gref = c["gravity_ref"].to<JsonArray>();
  gref.add(int(calib.gravity[0]));
  gref.add(int(calib.gravity[1]));
  gref.add(int(calib.gravity[2]));
  c["state"]  = calib.stateName();
  c["age_ms"] = calib.updatedAt ? (millis() - calib.updatedAt) : 0;

  JsonObject araw = doc["accel_raw"].to<JsonObject>();
  araw["x"] = win.ax; araw["y"] = win.ay; araw["z"] = win.az;
  JsonObject graw = doc["gyro_raw"].to<JsonObject>();
  graw["x"] = win.gx; graw["y"] = win.gy; graw["z"] = win.gz;

  const uint32_t n = win.samples > 0 ? win.samples : 1;
  JsonObject acal = doc["accel_cal"].to<JsonObject>();
  acal["vertical_rms"]    = int(sqrt(win.vertSumSq / n));
  acal["vertical_peak"]   = int(win.vertPeak);
  acal["horizontal_peak"] = int(win.horizPeak);
  acal["magnitude_peak"]  = int(win.accelMagPeak);

  JsonObject gcal = doc["gyro_cal"].to<JsonObject>();
  gcal["yaw_rate_peak"]   = int(win.yawRatePeak);
  gcal["pitch_rate_peak"] = int(win.pitchRatePeak);
  gcal["roll_rate_peak"]  = int(win.rollRatePeak);
  gcal["magnitude_peak"]  = int(win.gyroMagPeak);

  JsonObject mic = doc["mic"].to<JsonObject>();
  mic["rms"]  = int(sqrt(win.micSumSq / n));
  mic["peak"] = win.micPeak;

  JsonObject g = doc["gps"].to<JsonObject>();
  g["fix"] = gps.location.isValid();
  if (gps.location.isValid()) { g["lat"] = gps.location.lat(); g["lon"] = gps.location.lng(); }
  if (gps.speed.isValid())      g["speed_kmh"] = gps.speed.kmph();
  if (gps.course.isValid())     g["heading"]   = gps.course.deg();
  if (gps.altitude.isValid()) {
    double alt = gps.altitude.meters();
    g["altitude"] = alt;
    g["alt_m"]    = alt;
  }
  if (gps.satellites.isValid()) g["sats"]      = gps.satellites.value();
  if (gps.hdop.isValid())       g["hdop"]      = gps.hdop.hdop();

  doc["wifi_rssi"]     = WiFi.RSSI();
  doc["accel_fs_g"]    = 2;
  doc["gyro_fs_dps"]   = 250;
  doc["fw_version"]    = "1.0.0-mcu";
  doc["dropped_posts"] = droppedPosts;

  String out;
  serializeJson(doc, out);
  return out;
}

inline void windowReset() { win = Window{}; }

inline void uploaderTask(void*) {
  PostItem item;
  bool hasItem = false;
  uint32_t lastReconnectAttempt = 0;

  for (;;) {
    hasItem = false;

    // 1. If WiFi is NOT connected, do NOT pop items from the spool!
    // Instead, receive incoming queue items, spool them to LittleFS safely, and attempt reconnection with backoff.
    if (WiFi.status() != WL_CONNECTED) {
      if (xQueueReceive(postQueue, &item, pdMS_TO_TICKS(500)) == pdTRUE) {
        if (xSemaphoreTake(fsMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
          File f = LittleFS.open("/spool.txt", FILE_APPEND);
          if (f) { f.println(item.body); f.close(); }
          else droppedPosts++;
          xSemaphoreGive(fsMutex);
        } else {
          droppedPosts++;
        }
      }

      uint32_t now = millis();
      if (now - lastReconnectAttempt > 5000) {
        lastReconnectAttempt = now;
        lastPostCode = -1;
        lastPostAt   = now;
        WiFi.reconnect();
      }
      delay(200);
      continue;
    }

    // 2. WiFi is connected: Drain from LittleFS spool first (FIFO)
    bool spooledFound = false;
    if (xSemaphoreTake(fsMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
      if (LittleFS.exists("/spool.txt")) {
        File spool = LittleFS.open("/spool.txt", FILE_READ);
        if (spool && spool.size() > 0) {
          String spooledBody = spool.readStringUntil('\n');
          spooledBody.trim();
          File tmp = LittleFS.open("/tmp.txt", FILE_WRITE);
          if (tmp) {
            while (spool.available()) {
              String line = spool.readStringUntil('\n');
              line.trim();
              if (line.length() > 0) tmp.println(line);
            }
            tmp.close();
          }
          spool.close();
          LittleFS.remove("/spool.txt");
          if (LittleFS.exists("/tmp.txt") && LittleFS.open("/tmp.txt", FILE_READ).size() > 0) {
            LittleFS.rename("/tmp.txt", "/spool.txt");
          } else {
            LittleFS.remove("/tmp.txt");
          }
          if (spooledBody.length() > 0) {
            strncpy(item.body, spooledBody.c_str(), sizeof(item.body) - 1);
            item.body[sizeof(item.body) - 1] = '\0';
            hasItem = true;
            spooledFound = true;
          }
        } else {
          if (spool) spool.close();
          LittleFS.remove("/spool.txt");
        }
      }
      xSemaphoreGive(fsMutex);
    }

    // 3. If no spooled items, receive from the live FreeRTOS queue
    if (!hasItem) {
      if (xQueueReceive(postQueue, &item, pdMS_TO_TICKS(1000)) != pdTRUE) continue;
      hasItem = true;
    }

    if (!hasItem) continue;

    // 4. Perform HTTPS POST to Supabase
    WiFiClientSecure client;
#ifdef SUPABASE_CA_CERT
    if (SUPABASE_CA_CERT != nullptr) {
      client.setCACert(SUPABASE_CA_CERT);
    } else {
      client.setInsecure();
    }
#else
    client.setInsecure();
#endif
    client.setTimeout(5000);

    HTTPClient http;
    if (http.begin(client, SUPABASE_URL)) {
      http.addHeader("Content-Type", "application/json");
      http.addHeader("apikey", SUPABASE_KEY);
      http.addHeader("Authorization", "Bearer " SUPABASE_KEY);
      http.addHeader("Prefer", "return=minimal");

      lastPostCode = http.POST((uint8_t*)item.body, strlen(item.body));
      lastPostAt   = millis();
      if (lastPostCode > 0) {
        Serial.printf("POST -> %d\n", lastPostCode);
      } else {
        Serial.printf("POST error: %s\n", http.errorToString(lastPostCode).c_str());
        if (lastPostCode < 0) {
          // Network error - re-spool for next attempt
          if (xSemaphoreTake(fsMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
            File f = LittleFS.open("/spool.txt", FILE_APPEND);
            if (f) { f.println(item.body); f.close(); }
            xSemaphoreGive(fsMutex);
          }
          delay(1000);
        }
      }
      http.end();
    } else {
      lastPostCode = -2;
      Serial.println("HTTP begin failed (check SUPABASE_URL)");
      if (xSemaphoreTake(fsMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
        File f = LittleFS.open("/spool.txt", FILE_APPEND);
        if (f) { f.println(item.body); f.close(); }
        xSemaphoreGive(fsMutex);
      }
      delay(1000);
    }

    // Yield between successive transmissions
    delay(spooledFound ? 50 : 10);
  }
}

// Non-blocking hand-off with mutex protection
inline void enqueuePost(const String& body) {
  if (body.length() >= sizeof(PostItem::body)) { droppedPosts++; return; }
  PostItem item;
  strncpy(item.body, body.c_str(), sizeof(item.body) - 1);
  item.body[sizeof(item.body) - 1] = '\0';
  if (xQueueSend(postQueue, &item, 0) != pdTRUE) {
    if (xSemaphoreTake(fsMutex, 0) == pdTRUE) {
      File f = LittleFS.open("/spool.txt", FILE_APPEND);
      if (f) { f.println(body); f.close(); }
      else droppedPosts++;
      xSemaphoreGive(fsMutex);
    } else {
      droppedPosts++;
    }
  }
}
