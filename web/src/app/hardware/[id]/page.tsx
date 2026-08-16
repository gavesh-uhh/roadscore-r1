'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { createClient } from '@/lib/supabase/client';
import { DeviceHealthHeader } from '@/components/hardware/DeviceHealthHeader';
import { RawTelemetryTable, RawTelemetryRow } from '@/components/hardware/RawTelemetryTable';
import { RawPayloadDrawer } from '@/components/hardware/RawPayloadDrawer';
import { ArrowLeft, Activity, Layers, Radio, MapPin, Navigation, Satellite } from 'lucide-react';
import { OSMMap, MapMarker, MapPolyline } from '@/components/map/OSMMap';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';

export default function HardwareDeviceInspector({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const deviceId = resolvedParams.id;

  const [device, setDevice] = useState<any>({
    device_id: deviceId,
    vehicle_id: null,
    driver_id: null,
    accel_fs_g: 2,
    gyro_fs_dps: 250,
    installed_at: null,
    active: true,
  });

  const [telemetry, setTelemetry] = useState<RawTelemetryRow[]>([]);
  const [latestRaw, setLatestRaw] = useState<any | null>(null);
  const [selectedRowPayload, setSelectedRowPayload] = useState<RawTelemetryRow | null>(null);

  const supabase = createClient();

  useEffect(() => {
    let isMounted = true;

    async function loadDeviceAndTelemetry() {
      try {
        // 1. Fetch specific device metadata
        const { data: devData } = await supabase
          .from('devices')
          .select('*')
          .eq('device_id', deviceId)
          .maybeSingle();

        if (devData && isMounted) {
          setDevice(devData);
        }

        // 2. Fetch telemetry stream for this device
        const { data: telData } = await supabase
          .from('telemetry')
          .select('*')
          .eq('device_id', deviceId)
          .order('server_received_at', { ascending: false })
          .limit(60);

        if (telData && isMounted) {
          if (telData.length > 0) {
            setLatestRaw(telData[0]);
          }

          const mappedTelemetry: RawTelemetryRow[] = telData.map((t: any, i: number) => {
            const fsG = Number(t.accel_fs_g || devData?.accel_fs_g || 2);
            const countsPerG = 32768 / fsG;
            const fsDps = Number(t.gyro_fs_dps || devData?.gyro_fs_dps || 250);
            const countsPerDps = 32768 / fsDps;

            // Accel Calibrated / Raw conversion
            let vertRms = 0;
            if (t.accel_cal?.vertical_rms != null) {
              vertRms = Number(t.accel_cal.vertical_rms) / countsPerG;
            } else if (t.calibrated_accel?.a_vert != null || t.calibrated_accel?.rms_g != null) {
              vertRms = Number(t.calibrated_accel.a_vert ?? t.calibrated_accel.rms_g);
            } else if (t.accel_raw?.z != null || t.accel_raw?.az != null) {
              vertRms = Number(t.accel_raw.z ?? t.accel_raw.az) / countsPerG;
            }

            let vertPeak = vertRms;
            if (t.accel_cal?.vertical_peak != null) {
              vertPeak = Number(t.accel_cal.vertical_peak) / countsPerG;
            } else if (t.calibrated_accel?.peak_g != null) {
              vertPeak = Number(t.calibrated_accel.peak_g);
            }

            let horizPeak = 0;
            if (t.accel_cal?.horizontal_peak != null) {
              horizPeak = Number(t.accel_cal.horizontal_peak) / countsPerG;
            } else if (t.calibrated_accel?.a_long != null) {
              horizPeak = Number(t.calibrated_accel.a_long);
            } else if (t.accel_raw?.x != null || t.accel_raw?.ax != null) {
              horizPeak = Number(t.accel_raw.x ?? t.accel_raw.ax) / countsPerG;
            }

            let magPeak = 0;
            if (t.accel_cal?.magnitude_peak != null) {
              magPeak = Number(t.accel_cal.magnitude_peak) / countsPerG;
            } else if (t.calibrated_accel?.peak_g != null) {
              magPeak = Number(t.calibrated_accel.peak_g);
            } else {
              magPeak = Math.hypot(horizPeak, vertRms);
            }

            let latVal = 0;
            if (t.calibrated_accel?.a_lat != null) {
              latVal = Number(t.calibrated_accel.a_lat);
            } else if (t.accel_raw?.y != null || t.accel_raw?.ay != null) {
              latVal = Number(t.accel_raw.y ?? t.accel_raw.ay) / countsPerG;
            }

            // Gyro Calibrated / Raw conversion
            let yaw = 0;
            if (t.gyro_cal?.yaw_rate_peak != null) {
              yaw = Number(t.gyro_cal.yaw_rate_peak) / countsPerDps;
            } else if (t.gyro_cal?.yaw_rate_deg_s != null || t.yaw_rate != null) {
              yaw = Number(t.gyro_cal?.yaw_rate_deg_s ?? t.yaw_rate);
            } else if (t.gyro_raw?.z != null || t.gyro_raw?.gz != null) {
              yaw = Number(t.gyro_raw.z ?? t.gyro_raw.gz) / countsPerDps;
            }

            const micVal = Number(t.mic?.rms ?? t.mic_rms ?? 0);
            const hasFix = Boolean(t.gps?.fix === true || (t.gps?.lat != null && Number(t.gps?.lat) !== 0));
            const isCalibrated = String(t.calibration?.state ?? '').toLowerCase() === 'calibrated' || Boolean(t.accel_cal);
            const storageOk = t.storage_ok ?? (t.dropped_posts != null ? Number(t.dropped_posts) === 0 : true);

            return {
              id: t.id,
              seq: Number(t.seq ?? i + 1),
              device_id: String(t.device_id || deviceId),
              uptime_ms: Number(t.uptime_ms ?? 0),
              t_sec: Number(t.t_sec || (t.ts ? Math.floor(new Date(t.ts).getTime() / 1000) : 0)),
              accel_raw: {
                x: Number(t.accel_raw?.x ?? t.accel_raw?.ax ?? 0),
                y: Number(t.accel_raw?.y ?? t.accel_raw?.ay ?? 0),
                z: Number(t.accel_raw?.z ?? t.accel_raw?.az ?? 0),
              },
              calibrated_accel: {
                a_long: horizPeak,
                a_lat: latVal,
                a_vert: vertRms,
                peak_g: vertPeak > magPeak ? vertPeak : magPeak,
                rms_g: vertRms,
              },
              yaw_rate: yaw,
              mic_rms: micVal,
              gps: {
                speed_kmh: Number(t.gps?.speed_kmh ?? 0),
                heading_deg: Number(t.gps?.heading ?? t.gps?.heading_deg ?? 0),
                lat: Number(t.gps?.lat ?? 0),
                lon: Number(t.gps?.lon ?? 0),
                sats: Number(t.gps?.sats ?? 0),
                hdop: Number(t.gps?.hdop ?? 0),
              },
              flags: {
                gps_fix: hasFix,
                calibrated: isCalibrated,
                imu_ready: Boolean(t.accel_raw || t.accel_cal),
                mic_active: Boolean(t.mic && (Number(t.mic?.rms ?? 0) > 0 || Number(t.mic?.peak ?? 0) > 0)),
                storage_ok: storageOk,
              },
              raw_payload: t,
            };
          });

          setTelemetry(mappedTelemetry);
        }
      } catch {
        // DB error handler
      }
    }

    loadDeviceAndTelemetry();

    // Subscribe to realtime updates for this device
    const channel = supabase
      .channel(`device_telemetry_${deviceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'telemetry', filter: `device_id=eq.${deviceId}` },
        () => {
          loadDeviceAndTelemetry();
        }
      )
      .subscribe();

    const interval = setInterval(loadDeviceAndTelemetry, 1500);

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [deviceId, supabase]);

  // Reverse so waveform renders chronologically from left to right (increasing sequence/time)
  const waveformChartData = [...telemetry].reverse().map((row) => ({
    seq: row.seq,
    a_long: row.calibrated_accel.a_long,
    a_vert_rms: row.calibrated_accel.rms_g,
    a_vert_peak: row.calibrated_accel.peak_g,
  }));

  // Parse actual live values from the latest telemetry frame
  const latestCalib = latestRaw?.calibration;
  const gravityRef = Array.isArray(latestCalib?.gravity_ref)
    ? { x: latestCalib.gravity_ref[0] ?? 0, y: latestCalib.gravity_ref[1] ?? 0, z: latestCalib.gravity_ref[2] ?? 16384 }
    : (latestCalib?.gravity_ref ?? { x: 0, y: 0, z: 16384 });
  const calibState = (latestCalib?.state ?? (latestRaw?.accel_cal ? 'calibrated' : 'calibrating')) as any;
  const liveRssi = latestRaw?.wifi_rssi ?? -99;
  const liveDropped = latestRaw?.dropped_posts ?? 0;
  const liveFw = latestRaw?.fw_version ?? '1.0.0-mcu';
  const freeHeap = latestRaw?.free_heap_kb ?? latestRaw?.heap_free_kb ?? device.free_heap_kb ?? 184;

  // Extract latest valid GPS location
  const latestWithFix = telemetry.find(
    (t) => t.flags.gps_fix && t.gps.lat !== 0 && t.gps.lon !== 0 && !isNaN(t.gps.lat) && !isNaN(t.gps.lon)
  );

  const currentGps = latestWithFix
    ? latestWithFix.gps
    : (latestRaw?.gps?.lat && latestRaw?.gps?.lon && Number(latestRaw.gps.lat) !== 0
        ? {
            lat: Number(latestRaw.gps.lat),
            lon: Number(latestRaw.gps.lon),
            speed_kmh: Number(latestRaw.gps.speed_kmh ?? 0),
            heading_deg: Number(latestRaw.gps.heading ?? 0),
            sats: Number(latestRaw.gps.sats ?? 0),
            hdop: Number(latestRaw.gps.hdop ?? 0),
          }
        : null);

  const hasGpsLocation = Boolean(currentGps && currentGps.lat !== 0 && currentGps.lon !== 0);

  const mapCenter: [number, number] = hasGpsLocation && currentGps
    ? [currentGps.lat, currentGps.lon]
    : [6.9271, 79.8612];

  const mapZoom = hasGpsLocation ? 16 : 10;

  const deviceMarkers: MapMarker[] = hasGpsLocation && currentGps
    ? [
        {
          id: `device-${deviceId}`,
          lat: currentGps.lat,
          lon: currentGps.lon,
          title: `Device ${deviceId}`,
          type: 'vehicle',
          heading: currentGps.heading_deg,
          speedKmh: currentGps.speed_kmh,
          details: `GPS Fix: 3D Locked | Sats: ${currentGps.sats} | HDOP: ${currentGps.hdop.toFixed(2)} | Speed: ${currentGps.speed_kmh.toFixed(1)} km/h | Heading: ${Math.round(currentGps.heading_deg)}°`,
        },
      ]
    : [];

  const gpsTrailPositions: [number, number][] = [...telemetry]
    .reverse()
    .filter((t) => t.flags.gps_fix && t.gps.lat !== 0 && t.gps.lon !== 0 && !isNaN(t.gps.lat) && !isNaN(t.gps.lon))
    .map((t) => [t.gps.lat, t.gps.lon]);

  const trailPolylines: MapPolyline[] = gpsTrailPositions.length > 1
    ? [
        {
          id: `trail-${deviceId}`,
          positions: gpsTrailPositions,
          color: '#10b981',
          weight: 3,
          opacity: 0.85,
        },
      ]
    : [];

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header
        title={`Device Inspector — ${deviceId}`}
        subtitle="ESP32 MCU health, gravity reference lock, and raw telematics stream"
      />

      {/* Top Back Navigation Bar */}
      <div className="bg-black border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <Link
          href="/hardware"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 transition-colors font-mono text-[11px]"
        >
          <ArrowLeft size={13} />
          <span>Back to Fleet Registry</span>
        </Link>

        <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-400">
          <span>Target Device:</span>
          <strong className="text-emerald-400 font-bold">{deviceId}</strong>
        </div>
      </div>

      <div className="p-5 space-y-4 w-full">
        {/* Top Pane: ESP32 Health & IMU Calibration Header */}
        <DeviceHealthHeader
          device={device}
          freeHeapKb={freeHeap}
          wifiRssiDbm={liveRssi}
          droppedPosts={liveDropped}
          firmwareVersion={liveFw}
          gravityVector={gravityRef}
          calibrationState={calibState}
        />

        {/* 2-Column Grid: Waveform Scope & Real-Time Hardware Locator Map */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Oscilloscope Waveform Scope */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3 flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Activity size={15} className="text-emerald-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                  50 Hz Accelerometer Waveform Scope (a_long, a_vert)
                </h2>
              </div>
              <span className="text-[10px] font-mono text-zinc-500 bg-black px-2 py-0.5 rounded-sm border border-zinc-800">
                {telemetry.length} Ingested Frames
              </span>
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={waveformChartData}>
                  <XAxis dataKey="seq" stroke="#52525b" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#52525b" tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#09090b',
                      borderColor: '#27272a',
                      borderRadius: '4px',
                      fontSize: '11px',
                    }}
                  />
                  <Line type="monotone" dataKey="a_long" name="Longitudinal (g)" stroke="#10b981" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="a_vert_rms" name="Vertical RMS (g)" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="a_vert_peak" name="Vertical Peak (g)" stroke="#ef4444" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Real-Time Hardware Geographic Location Map with Marker */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3 flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
              <div className="flex items-center gap-2">
                <MapPin size={15} className="text-emerald-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                  Hardware Geographic Location (GPS Stream)
                </h2>
              </div>
              <div className="flex items-center gap-2 font-mono text-[10px]">
                {hasGpsLocation && currentGps ? (
                  <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 px-2 py-0.5 rounded-sm flex items-center gap-1.5 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    3D FIX ({currentGps.sats} SATS)
                  </span>
                ) : (
                  <span className="bg-amber-950/80 text-amber-400 border border-amber-800/60 px-2 py-0.5 rounded-sm flex items-center gap-1.5 font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                    SEARCHING SATELLITES
                  </span>
                )}
              </div>
            </div>

            <div className="relative h-56 w-full rounded overflow-hidden border border-zinc-800">
              <OSMMap
                center={mapCenter}
                zoom={mapZoom}
                markers={deviceMarkers}
                polylines={trailPolylines}
                className="w-full h-full"
              />

              {/* Real-Time Coordinate & Telemetry HUD Overlay */}
              <div className="absolute bottom-2 left-2 right-2 bg-black/85 backdrop-blur border border-zinc-800 rounded px-2.5 py-1.5 flex items-center justify-between text-[10px] font-mono z-[500]">
                {hasGpsLocation && currentGps ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-500">COORDS:</span>
                      <span className="text-white font-bold">{currentGps.lat.toFixed(6)}, {currentGps.lon.toFixed(6)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-400">
                        SPEED: <strong className="text-emerald-400 font-bold">{currentGps.speed_kmh.toFixed(1)} km/h</strong>
                      </span>
                      <span className="text-zinc-400">
                        HDOP: <strong className="text-zinc-200">{currentGps.hdop.toFixed(2)}</strong>
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between w-full text-zinc-400">
                    <span>GPS antenna searching for satellites...</span>
                    <span className="text-amber-400 font-bold">Awaiting NMEA fix</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Pane: Compact Filterable Raw Telematics Stream */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers size={15} className="text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                Raw Sensor Telemetry Stream (High-Density Tabular Inspection)
              </h2>
            </div>
            <span className="text-[10px] text-zinc-500 font-mono">
              Displaying {telemetry.length} Records
            </span>
          </div>

          <RawTelemetryTable
            rows={telemetry}
            selectedRow={selectedRowPayload}
            onSelectRow={(row) => setSelectedRowPayload(row)}
          />
        </div>
      </div>

      {/* Right Slide-Over JSON Payload Drawer */}
      <RawPayloadDrawer
        selectedRow={selectedRowPayload}
        onClose={() => setSelectedRowPayload(null)}
      />
    </div>
  );
}
