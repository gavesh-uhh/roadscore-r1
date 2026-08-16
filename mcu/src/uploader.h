#pragma once
#include "globals.h"

inline void enqueuePost(const String& body);

inline String buildPayload(bool isInstantSpike = false) {
  JsonDocument doc;
  doc["device_id"] = DEVICE_ID;
  doc["seq"]       = seq;
  doc["uptime_ms"] = millis();
  doc["window_ms"] = isInstantSpike ? cfg::SAMPLE_INTERVAL_MS : cfg::POST_INTERVAL_MS;
  doc["samples"]   = isInstantSpike ? 1 : (win.samples > 0 ? win.samples : 1);
  if (isInstantSpike) {
    doc["is_instant_spike"] = true;
  }

  bool tsSet = false;
  if (gps.time.isValid() && gps.date.isValid() &&
      gps.date.year() >= 2024 &&
      gps.date.month() >= 1 && gps.date.month() <= 12 &&
      gps.date.day() >= 1 && gps.date.day() <= 31) {
    char ts[25];
    snprintf(ts, sizeof(ts), "%04d-%02d-%02dT%02d:%02d:%02dZ",
             gps.date.year(), gps.date.month(), gps.date.day(),
             gps.time.hour(), gps.time.minute(), gps.time.second());
    doc["ts"] = ts;
    tsSet = true;
  }
  
  if (!tsSet) {
    time_t now;
    time(&now);
    if (now > 1700000000) { // Valid NTP time (> Nov 2023)
      struct tm timeinfo;
      gmtime_r(&now, &timeinfo);
      if (timeinfo.tm_year >= 124) { // Year >= 2024
        char ts[25];
        strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
        doc["ts"] = ts;
      }
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
  acal["vertical_rms"]    = isInstantSpike ? int(win.vertPeak) : int(sqrt(win.vertSumSq / n));
  acal["vertical_peak"]   = int(win.vertPeak);
  acal["horizontal_peak"] = int(win.horizPeak);
  acal["magnitude_peak"]  = int(win.accelMagPeak);

  JsonObject gcal = doc["gyro_cal"].to<JsonObject>();
  gcal["yaw_rate_peak"]   = int(win.yawRatePeak);
  gcal["pitch_rate_peak"] = int(win.pitchRatePeak);
  gcal["roll_rate_peak"]  = int(win.rollRatePeak);
  gcal["magnitude_peak"]  = int(win.gyroMagPeak);

  JsonObject mic = doc["mic"].to<JsonObject>();
  mic["rms"]  = isInstantSpike ? int(win.micPeak) : int(sqrt(win.micSumSq / n));
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

inline void triggerInstantSpikePush() {
  String payload = buildPayload(true);
  enqueuePost(payload);
}


inline void windowReset() { win = Window{}; }

// Fast Supabase poster that supports both single object and batch JSON arrays
inline int sendSupabasePost(WiFiClientSecure& client, HTTPClient& http, const char* payload, size_t length) {
  // Always call begin() to reset internal header state while keeping underlying TLS connection alive
  http.begin(client, SUPABASE_URL);
  http.setReuse(true);
  http.setTimeout(8000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");

  int code = http.POST((uint8_t*)payload, length);
  lastPostAt = millis();
  lastPostCode = code;

  if (code < 200 || code >= 300) {
    http.end(); // Reset client connection on failure
  }

  return code;
}

inline void uploaderTask(void*) {
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
  client.setTimeout(8000);

  HTTPClient http;
  http.setReuse(true);

  PostItem liveItem;
  uint32_t lastReconnectAttempt = 0;

  for (;;) {
    // 1. WiFi connectivity check
    if (WiFi.status() != WL_CONNECTED) {
      http.end();
      if (xQueueReceive(postQueue, &liveItem, pdMS_TO_TICKS(100)) == pdTRUE) {
        if (xSemaphoreTake(fsMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
          File f = LittleFS.open("/spool.txt", FILE_APPEND);
          if (f) {
            if (f.size() < 200000) {
              f.println(liveItem.body);
            } else {
              droppedPosts++;
            }
            f.close();
          } else {
            droppedPosts++;
          }
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
      delay(50);
      continue;
    }

    // 2. LIVE QUEUE PRIORITY: Send live data immediately with zero backlog latency
    if (xQueueReceive(postQueue, &liveItem, 0) == pdTRUE) {
      if (strstr(liveItem.body, "2000-00-00") == nullptr && strlen(liveItem.body) >= 20) {
        int code = sendSupabasePost(client, http, liveItem.body, strlen(liveItem.body));
        if (code >= 200 && code < 300) {
          Serial.printf("POST live -> %d\n", code);
        } else {
          Serial.printf("POST live failed (%d)\n", code);
          if (xSemaphoreTake(fsMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            File f = LittleFS.open("/spool.txt", FILE_APPEND);
            if (f) { f.println(liveItem.body); f.close(); }
            xSemaphoreGive(fsMutex);
          }
        }
      }
      continue;
    }

    // 3. SPOOL BATCH DRAIN: When live queue is clear, drain spool in high-speed batches
    bool hadSpool = false;
    if (xSemaphoreTake(fsMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      if (LittleFS.exists("/spool.txt")) {
        File spool = LittleFS.open("/spool.txt", FILE_READ);
        if (spool && spool.size() > 0) {
          hadSpool = true;
          String batchJson;
          batchJson.reserve(8192);
          batchJson = "[";
          int batchCount = 0;

          while (spool.available() && batchCount < 10) {
            String line = spool.readStringUntil('\n');
            line.trim();
            if (line.length() >= 20 && line.indexOf("device_id") >= 0 && line.indexOf("2000-00-00") < 0) {
              if (batchCount > 0) batchJson += ",";
              batchJson += line;
              batchCount++;
            }
          }
          batchJson += "]";

          if (batchCount > 0) {
            int code = sendSupabasePost(client, http, batchJson.c_str(), batchJson.length());
            if (code >= 200 && code < 300) {
              Serial.printf("POST spool batch (%d rows) -> %d\n", batchCount, code);
              if (spool.available()) {
                LittleFS.remove("/tmp.txt");
                File tmp = LittleFS.open("/tmp.txt", FILE_WRITE);
                if (tmp) {
                  while (spool.available()) {
                    String line = spool.readStringUntil('\n');
                    line.trim();
                    if (line.length() > 0) tmp.println(line);
                  }
                  tmp.close();
                  spool.close();
                  LittleFS.remove("/spool.txt");
                  LittleFS.rename("/tmp.txt", "/spool.txt");
                } else {
                  spool.close();
                  Serial.println("[Spool] ERROR: Failed to open /tmp.txt for spool rewrite");
                }
              } else {
                spool.close();
                LittleFS.remove("/spool.txt");
                LittleFS.remove("/tmp.txt");
                Serial.println("[Spool] Fully drained offline spool.");
              }
            } else {
              Serial.printf("POST spool batch failed (%d)\n", code);
              spool.close();
            }
          } else {
            spool.close();
            LittleFS.remove("/spool.txt");
          }
        } else {
          if (spool) spool.close();
          LittleFS.remove("/spool.txt");
        }
      }
      xSemaphoreGive(fsMutex);
    }

    if (!hadSpool) {
      delay(40);
    }
  }
}

// Non-blocking hand-off with mutex protection
inline void enqueuePost(const String& body) {
  if (body.length() < 20 || body.indexOf("device_id") < 0 || body.indexOf("2000-00-00") >= 0) return;
  if (body.length() >= sizeof(PostItem::body)) { droppedPosts++; return; }
  PostItem item;
  strncpy(item.body, body.c_str(), sizeof(item.body) - 1);
  item.body[sizeof(item.body) - 1] = '\0';

  if (xQueueSend(postQueue, &item, 0) != pdTRUE) {
    if (xSemaphoreTake(fsMutex, 0) == pdTRUE) {
      File f = LittleFS.open("/spool.txt", FILE_APPEND);
      if (f) {
        if (f.size() < 200000) {
          f.println(body);
        } else {
          droppedPosts++;
        }
        f.close();
      } else {
        droppedPosts++;
      }
      xSemaphoreGive(fsMutex);
    } else {
      droppedPosts++;
    }
  }
}
