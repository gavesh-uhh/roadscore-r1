'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { createClient } from '@/lib/supabase/client';
import { DeviceHealthHeader } from '@/components/hardware/DeviceHealthHeader';
import { RawTelemetryTable, RawTelemetryRow } from '@/components/hardware/RawTelemetryTable';
import { RawPayloadDrawer } from '@/components/hardware/RawPayloadDrawer';
import { ArrowLeft, Activity, Layers } from 'lucide-react';
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
  const [selectedRowPayload, setSelectedRowPayload] = useState<RawTelemetryRow | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function loadDeviceAndTelemetry() {
      try {
        // 1. Fetch specific device metadata
        const { data: devData } = await supabase
          .from('devices')
          .select('*')
          .eq('device_id', deviceId)
          .maybeSingle();

        if (devData) {
          setDevice(devData);
        }

        // 2. Fetch telemetry stream for this device
        const { data: telData } = await supabase
          .from('telemetry')
          .select('*')
          .eq('device_id', deviceId)
          .order('server_received_at', { ascending: false })
          .limit(50);

        if (telData) {
          const mappedTelemetry: RawTelemetryRow[] = telData.map((t: any, i: number) => {
            const vertRms = Number(t.accel_cal?.vertical_rms ?? t.calibrated_accel?.a_vert ?? 1.0);
            const horizPeak = Number(t.accel_cal?.horizontal_peak ?? t.calibrated_accel?.a_long ?? 0.0);
            const magPeak = Number(t.accel_cal?.magnitude_peak ?? t.calibrated_accel?.peak_g ?? 1.0);
            const yaw = Number(t.gyro_cal?.yaw_rate_deg_s ?? t.yaw_rate ?? 0.0);
            const micVal = Number(t.mic?.rms ?? t.mic_rms ?? 1100);

            return {
              id: t.id,
              seq: Number(t.seq || i + 1),
              device_id: String(t.device_id || deviceId),
              uptime_ms: Number(t.uptime_ms || i * 1000),
              t_sec: Number(t.t_sec || Math.floor(new Date(t.ts || t.server_received_at || Date.now()).getTime() / 1000)),
              accel_raw: {
                x: Number(t.accel_raw?.ax ?? t.accel_raw?.x ?? 0),
                y: Number(t.accel_raw?.ay ?? t.accel_raw?.y ?? 0),
                z: Number(t.accel_raw?.az ?? t.accel_raw?.z ?? 16384),
              },
              calibrated_accel: {
                a_long: horizPeak,
                a_lat: 0,
                a_vert: vertRms,
                peak_g: magPeak,
                rms_g: vertRms,
              },
              yaw_rate: yaw,
              mic_rms: micVal,
              gps: {
                speed_kmh: Number(t.gps?.speed_kmh || 0),
                heading_deg: Number(t.gps?.heading || t.gps?.heading_deg || 0),
                lat: Number(t.gps?.lat || 6.9271),
                lon: Number(t.gps?.lon || 79.8612),
                sats: Number(t.gps?.sats || 8),
                hdop: Number(t.gps?.hdop || 0.9),
              },
              flags: {
                gps_fix: Boolean(t.gps?.fix ?? (t.gps?.lat != null)),
                calibrated: Boolean(t.accel_cal != null || t.calibrated_accel != null),
                imu_ready: true,
                mic_active: true,
                storage_ok: true,
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
  }, [deviceId, supabase]);

  const waveformChartData = telemetry.map((row) => ({
    seq: row.seq,
    a_long: row.calibrated_accel.a_long,
    a_vert_rms: row.calibrated_accel.rms_g,
    a_vert_peak: row.calibrated_accel.peak_g,
  }));

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
        <DeviceHealthHeader device={device} />

        {/* Oscilloscope Waveform Scope */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3">
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

          <div className="h-44 w-full">
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
