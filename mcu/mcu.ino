#include "src/globals.h"
#include "src/sensors.h"
#include "src/calibration.h"
#include "src/uploader.h"
#include "src/webserver.h"

// --- Global instances definition ---
MPU6050        mpu(0x68);
TinyGPSPlus    gps;
HardwareSerial GPSSerial(2);
WebServer      server(80);

Calibration calib;
Window      win;

QueueHandle_t postQueue;
SemaphoreHandle_t fsMutex;
String        lastPayload  = "{}";
volatile int  lastPostCode = 0;
volatile uint32_t lastPostAt   = 0;
volatile uint32_t droppedPosts = 0;

uint32_t lastSampleMs = 0, lastPostMs = 0, stoppedSince = 0, seq = 0;
bool recalibratedThisStop = false;

// --- Helper WiFi Connection with Timeout ---
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting WiFi");
  
  uint32_t startAttempt = millis();
  const uint32_t timeoutMs = 15000; // 15s connection timeout

  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < timeoutMs) {
    digitalWrite(pins::LED, LOW);
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(pins::LED, HIGH);
    Serial.printf("\nWiFi connected: %s\n", WiFi.localIP().toString().c_str());
    configTime(0, 0, "pool.ntp.org");
  } else {
    digitalWrite(pins::LED, LOW);
    Serial.println("\nWiFi connection timed out! Will auto-retry in background.");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(pins::LED, OUTPUT);
  digitalWrite(pins::LED, LOW);
  pinMode(pins::MIC, INPUT);

  // Configure I2C with clock speed (400kHz Fast Mode) & timeout
  recoverI2CBus(pins::I2C_SDA, pins::I2C_SCL);
  Wire.setTimeOut(100);
  Wire.begin(pins::I2C_SDA, pins::I2C_SCL);
  Wire.setClock(400000);
  setupMPU();

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS Mount Failed");
  }

  // Configure GPS Serial with enlarged 1024-byte RX buffer
  GPSSerial.setRxBufferSize(1024);
  GPSSerial.begin(9600, SERIAL_8N1, pins::GPS_RX, pins::GPS_TX);

  connectWiFi();

  postQueue = xQueueCreate(30, sizeof(PostItem));
  fsMutex   = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(uploaderTask, "uploader", 8192, nullptr, 1, nullptr, 0);

  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.begin();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Diagnostics at http://" + WiFi.localIP().toString() + "/");
  } else {
    Serial.println("Diagnostics ready on webserver once WiFi connects.");
  }

  loadSavedCalibration();
  Serial.println("Calibrating gravity (hold still)...");
  attemptCalibration(CalibState::Calibrating);

  lastSampleMs = lastPostMs = millis();
}

void loop() {
  serviceGPS();
  server.handleClient();

  if (checkSleepMode()) {
    Serial.println("Motionless for >5 minutes. Entering low-power sleep (30s periodic timer wakeup)...");
    esp_sleep_enable_timer_wakeup(30ULL * 1000000ULL); // Wake every 30s to check GPS motion
    esp_deep_sleep_start();
  }

  uint32_t now = millis();

  // Accurate 50 Hz sampling cadence without drift
  if (now - lastSampleMs >= cfg::SAMPLE_INTERVAL_MS) {
    lastSampleMs += cfg::SAMPLE_INTERVAL_MS;
    // Cap lag if loop was severely delayed
    if (now - lastSampleMs > cfg::SAMPLE_INTERVAL_MS * 5) {
      lastSampleMs = now;
    }
    sampleSensors();
  }

  // 1 Hz payload compilation and queueing
  if (now - lastPostMs >= cfg::POST_INTERVAL_MS) {
    lastPostMs += cfg::POST_INTERVAL_MS;
    if (now - lastPostMs > cfg::POST_INTERVAL_MS * 2) {
      lastPostMs = now;
    }
    seq++;
    maybeRecalibrate();
    if (win.samples > 0) {
      lastPayload = buildPayload();
      enqueuePost(lastPayload);
    }
    windowReset();
  }
}
