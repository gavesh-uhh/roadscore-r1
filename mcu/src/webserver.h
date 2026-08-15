#pragma once
#include "globals.h"

// Wraps the last uploaded telemetry (already-serialized JSON) with a few live
// diagnostics. lastPayload is embedded raw, so this stays plain concatenation.
inline void handleData() {
  const uint32_t ago = lastPostAt ? (millis() - lastPostAt) : 0;
  String out;
  out.reserve(lastPayload.length() + 160);
  out += "{\"ip\":\"" + WiFi.localIP().toString() + "\"";
  out += ",\"rssi\":"        + String(WiFi.RSSI());
  out += ",\"post_code\":"   + String(lastPostCode);
  out += ",\"post_ago_ms\":" + String(ago);
  out += ",\"dropped\":"     + String(droppedPosts);
  out += ",\"telemetry\":"   + lastPayload + "}";
  server.send(200, "application/json", out);
}

inline void handleRoot() {
  static const char PAGE[] PROGMEM = R"HTML(<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>RoadScore Diagnostics</title>
<style>
body{font:14px system-ui,sans-serif;margin:1.5rem;background:#0f1115;color:#e6e6e6}
h1{font-size:1.2rem}h2{font-size:.9rem;color:#8ab4f8;margin:1rem 0 .3rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.5rem}
.card{background:#1a1d24;border:1px solid #2a2e38;border-radius:8px;padding:.6rem .8rem}
.k{color:#8b93a7;font-size:.75rem}.v{font-size:1.1rem;font-weight:600}
.ok{color:#7ee787}.bad{color:#ff7b72}pre{background:#1a1d24;padding:.8rem;border-radius:8px;overflow:auto}
</style></head><body>
<h1>RoadScore Diagnostics</h1>
<div class="grid" id="top"></div>
<h2>Calibration</h2><div class="grid" id="cal"></div>
<h2>Accel (calibrated)</h2><div class="grid" id="acc"></div>
<h2>GPS</h2><div class="grid" id="gps"></div>
<h2>Raw payload</h2><pre id="raw"></pre>
<script>
const card=(k,v,c='')=>`<div class="card"><div class="k">${k}</div><div class="v ${c}">${v??'-'}</div></div>`;
async function tick(){
  try{
    const d=await(await fetch('/data')).json();const t=d.telemetry||{};
    const cal=t.calibration||{},acc=t.accel_cal||{},g=t.gps||{};
    document.getElementById('top').innerHTML=
      card('IP',d.ip)+card('WiFi RSSI',d.rssi+' dBm')+
      card('POST',d.post_code,d.post_code>=200&&d.post_code<300?'ok':'bad')+
      card('POST age',d.post_ago_ms+' ms')+card('Dropped',d.dropped,d.dropped>0?'bad':'ok')+
      card('seq',t.seq)+card('samples',t.samples);
    document.getElementById('cal').innerHTML=
      card('State',cal.state,cal.state==='calibrated'?'ok':'bad')+
      card('Age',(cal.age_ms??0)+' ms')+card('Gravity ref',(cal.gravity_ref||[]).join(', '));
    document.getElementById('acc').innerHTML=
      card('Vert RMS',acc.vertical_rms)+card('Vert peak',acc.vertical_peak)+
      card('Horiz peak',acc.horizontal_peak)+card('Mag peak',acc.magnitude_peak);
    document.getElementById('gps').innerHTML=
      card('Fix',g.fix?'yes':'no',g.fix?'ok':'bad')+card('Lat',g.lat)+card('Lon',g.lon)+
      card('Speed',g.speed_kmh!=null?g.speed_kmh.toFixed(1)+' km/h':'-')+card('Sats',g.sats);
    document.getElementById('raw').textContent=JSON.stringify(t,null,2);
  }catch(e){}
}
setInterval(tick,1000);tick();
</script></body></html>)HTML";
  server.send_P(200, "text/html", PAGE);
}
