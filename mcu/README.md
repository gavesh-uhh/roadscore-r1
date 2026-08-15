# RoadScore MCU

ESP32 firmware that turns a car into a road-quality probe. It samples an
**MPU6050** (accelerometer + gyroscope), a **MAX4466** microphone, and a
**NEO-6M GPS** at 50 Hz, condenses each second into orientation-independent
statistics, and streams one JSON row per second to a **Supabase** table — which
rebroadcasts it live over Supabase Realtime.

The device **self-orients**: it learns the gravity vector at boot (and again
whenever the vehicle stops), so it works no matter how it is mounted. Uploads
run on a separate CPU core, so the blocking network POST never interrupts
sampling.

---

## Directory Structure

```
roadscore-mcu/
├── roadscore-mcu.ino    # Main Arduino sketch entry point (setup & loop)
├── flash.sh             # Bash script to build, flash, and monitor ESP32
├── secrets.h.example    # Credentials template (committed)
├── secrets.h            # Real WiFi + Supabase credentials (gitignored)
├── .gitignore           # Git ignore patterns
├── README.md            # Documentation
├── src/                 # Modular firmware components
│   ├── config.h         # Pin mappings and timing parameters
│   ├── types.h          # Calibration, Window, and PostItem structs + math
│   ├── globals.h        # Global declarations and hardware instances
│   ├── sensors.h        # MPU6050, Mic, and GPS sampling logic
│   ├── calibration.h    # Gravity vector learning and still-state detection
│   ├── uploader.h       # FreeRTOS background queue & Supabase HTTP POST task
│   └── webserver.h      # Diagnostic web server & live HTML dashboard
├── db/                  # Database schemas and setup scripts
│   └── supabase.sql     # Telemetry table, indexes, RLS policies, Realtime pub
└── scripts/             # Utility and automation scripts
    └── flash.sh         # Link/copy to root flash script
```

---

## 1. Hardware

### Bill of materials
- ESP32 dev board (any WROOM/WROVER module)
- MPU6050 (I²C accel + gyro)
- MAX4466 electret microphone amp
- NEO-6M GPS module
- Jumper wires; a stable 5 V/3.3 V supply for the car

### Wiring

| Peripheral | Signal | ESP32 pin |
|------------|--------|-----------|
| MPU6050 | SDA | GPIO 21 |
| MPU6050 | SCL | GPIO 22 |
| MPU6050 | VCC / GND | 3V3 / GND |
| MAX4466 | OUT | GPIO 34 (ADC1, input-only) |
| MAX4466 | VCC / GND | 3V3 / GND |
| NEO-6M | TX → ESP32 RX | GPIO 16 |
| NEO-6M | VCC / GND | 3V3 (or 5 V per module) / GND |
| Status LED | — | GPIO 2 (on-board) |

Notes:
- GPIO 34 is **input-only** and has no internal pull-up — correct for the mic's
  analog output.
- The GPS is read-only here (ESP32 only receives). The `GPS_TX` pin is left
  unset (`-1`).
- The MPU6050 must sit reasonably rigid to the vehicle. Exact angle does not
  matter — calibration handles orientation — but it should not wobble
  independently of the car.

---

## 2. Toolchain & libraries

You can build with `flash.sh`, `arduino-cli`, or the Arduino IDE.

### ESP32 board support
Install the ESP32 core (Espressif):
- **Arduino IDE:** *Boards Manager → "esp32" by Espressif Systems*.
- **CLI:**
  ```bash
  arduino-cli config init
  arduino-cli config add board_manager.additional_urls \
    https://espressif.github.io/arduino-esp32/package_esp32_index.json
  arduino-cli core update-index
  arduino-cli core install esp32:esp32
  ```

### Required libraries
| Library | Author |
|---------|--------|
| `MPU6050` | Electronic Cats / jrowberg |
| `TinyGPSPlus` | Mikal Hart |
| `ArduinoJson` | Benoit Blanchon (v7.x) |

```bash
arduino-cli lib install "MPU6050" "TinyGPSPlus" "ArduinoJson"
```

`WiFi`, `WiFiClientSecure`, `HTTPClient`, `WebServer`, `Wire`, and the FreeRTOS
queue/task APIs ship with the ESP32 core — no extra install.

---

## 3. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of `db/supabase.sql`, and run it. This
   creates the `telemetry` table, indexes, adds it to the Realtime publication,
   and sets Row Level Security policies allowing the device to insert.
3. From **Project Settings → API**, copy:
   - the **Project URL** (`https://<ref>.supabase.co`)
   - the **anon public** API key

The device's REST endpoint is the project URL plus `/rest/v1/telemetry`.

> **Key choice:** the firmware uses the **anon** key with an RLS insert policy.
> Do **not** put a `service_role` key in firmware you don't physically control.
> Before production, tighten the insert policy (e.g. per-device token) instead
> of `with check (true)`.

---

## 4. Configure `secrets.h`

`secrets.h` is gitignored. Copy the template and fill in your values:

```bash
cp secrets.h.example secrets.h
```

```cpp
#define WIFI_SSID      "your-wifi"
#define WIFI_PASSWORD  "your-password"

#define SUPABASE_URL   "https://YOUR_PROJECT_REF.supabase.co/rest/v1/telemetry"
#define SUPABASE_KEY   "YOUR_SUPABASE_ANON_KEY"

#define DEVICE_ID      "ROADSCORE_001"   // unique per physical unit
```

Give every physical device a distinct `DEVICE_ID`.

---

## 5. Build & Flash

### Automated Flashing Script (`flash.sh`)

A dedicated bash script is provided for one-command building, flashing, and monitoring:

```bash
# Auto-detect serial port, compile firmware, and flash ESP32
./flash.sh

# Flash to a specific serial port and launch Serial Monitor
./flash.sh -p /dev/ttyUSB0 --monitor

# Compile-only test (verification build)
./flash.sh --compile-only
```

#### Script Options:
- `-p, --port <PORT>`: Specify target serial port (`/dev/ttyUSB0`, `/dev/ttyACM0`, etc.).
- `-b, --board <FQBN>`: Board target (default: `esp32:esp32:esp32`).
- `-m, --monitor`: Open 115200 baud serial monitor after flashing.
- `--compile-only`: Verify compilation without flashing.
- `--flash-only`: Flash existing build without re-compiling.
- `--clean`: Clean build cache before compiling.

### Manual CLI commands:
```bash
arduino-cli compile --fqbn esp32:esp32:esp32 .
arduino-cli upload  --fqbn esp32:esp32:esp32 -p /dev/ttyUSB0 .
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
```

On boot the serial log (115200 baud) prints the WiFi IP, the diagnostics URL,
and calibration status:

```
MPU6050 OK @ 0x68
Connecting WiFi....
WiFi connected: 192.168.1.42
Diagnostics at http://192.168.1.42/
Calibrating gravity (hold still)...
Calibrated: [210, -320, 16350] stddev=180
POST -> 201
```

> **Keep the device still for ~1 second at boot** so gravity calibration
> succeeds. If it's moving, calibration is skipped and retried automatically the
> next time the vehicle is stopped.

---

## 6. Diagnostic dashboard

Open `http://<device-ip>/` in a browser on the same network. It refreshes once
per second and shows:

- **Connection** — IP, WiFi RSSI
- **POST** — last Supabase HTTP status (green 2xx / red otherwise) and its age
- **Dropped** — count of seconds dropped because the uploader was still busy
  (should stay 0 on healthy WiFi)
- **samples** — inner samples in the last window (should hold near 50)
- **Calibration** — state, age, learned gravity vector
- **Accel (calibrated)** — vertical RMS/peak, horizontal peak, magnitude peak
- **GPS** — fix, lat/lon, speed, satellites
- **Raw payload** — the exact JSON last sent to Supabase

`GET /data` returns the same data as JSON if you want to script against it.

---

## 7. Verifying the stream

In Supabase, open **Table Editor → telemetry** — rows should appear ~1/second
while the device runs. To watch the live Realtime feed, subscribe from a client:

```js
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

supabase
  .channel('telemetry')
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'telemetry' },
      ({ new: row }) => console.log(row.device_id, row.accel_cal, row.gps))
  .subscribe()
```

---

## 8. Payload shape

Each row is one 1-second window:

```json
{
  "device_id": "ROADSCORE_001",
  "seq": 4821,
  "uptime_ms": 1049320,
  "window_ms": 1000,
  "samples": 50,
  "ts": "2026-07-25T09:14:03Z",
  "calibration": { "gravity_ref": [210, -320, 16350], "state": "calibrated", "age_ms": 84200 },
  "accel_raw": { "x": 190, "y": -310, "z": 16880 },
  "gyro_raw":  { "x": 12, "y": -5, "z": 3 },
  "accel_cal": { "vertical_rms": 1042, "vertical_peak": 4871, "horizontal_peak": 980, "magnitude_peak": 5120 },
  "gyro_cal":  { "yaw_rate_peak": 190, "magnitude_peak": 210 },
  "mic": { "rms": 412, "peak": 2871 },
  "gps": { "fix": true, "lat": 6.90548, "lon": 79.86121, "speed_kmh": 34.2, "heading": 118.4, "altitude": 8.1, "sats": 7, "hdop": 1.2 },
  "wifi_rssi": -63
}
```

- **`*_raw`** — untouched last sensor reading (all six axes), so the server can
  re-derive anything.
- **`*_cal`** — decomposed against the learned gravity vector: `vertical`
  (roughness / potholes), `horizontal` (cornering + braking combined),
  `magnitude` (orientation-independent), `yaw_rate` (turning about "down").
- Server-side analysis (map-matching, speed normalization, roughness scoring,
  event classification) is intended to run on the data — the device stays a
  dumb, fast sensor.

---

## Tuning

All timing/thresholds live in the `cfg` namespace in `src/config.h`:

| Constant | Meaning |
|----------|---------|
| `SAMPLE_INTERVAL_MS` | Inner sampling period (20 ms = 50 Hz) |
| `POST_INTERVAL_MS` | Upload cadence (1000 ms = 1 Hz) |
| `CALIB_MAX_STDDEV` | Stillness threshold to accept a gravity estimate (lower = stricter) |
| `STOPPED_SPEED_KMH` | Below this speed the vehicle counts as stopped |
| `RECALIB_STILL_MS` | How long stopped before re-learning gravity |

---

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `MPU6050 FAILED` | I²C wiring / address (expects `0x68`) |
| Stuck "Connecting WiFi…" | Wrong SSID/password in `secrets.h` |
| POST code `401/403` | Wrong Supabase key, or RLS policy blocks inserts |
| POST code `404` | `SUPABASE_URL` missing `/rest/v1/telemetry` |
| POST code `-1` | WiFi dropped mid-upload |
| **Dropped** climbing | Weak WiFi / slow uploads — the queue is shedding load |
| `samples` well under 50 | I²C read stalls, or `SAMPLE_INTERVAL_MS` too aggressive |
| GPS `fix: false` | No sky view yet — cold start can take minutes outdoors |
| `state: calibrating` forever | Device never held still — stop and keep it steady briefly |

---

## Security notes

- `secrets.h` is gitignored — keep it that way; never commit real credentials.
- TLS certificate verification is disabled (`client.setInsecure()`) for
  prototyping. For production, pin the Supabase CA certificate.
- Restrict the RLS insert policy before deploying real devices.
