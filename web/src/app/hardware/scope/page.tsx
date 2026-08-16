'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { createClient } from '@/lib/supabase/client';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { getFleetData } from '@/lib/fleet/api';
import { Activity, Wifi, Compass, Radio } from 'lucide-react';

export default function LiveTelemetryOscilloscope() {
  const [streamData, setStreamData] = useState<any[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<string[]>([]);
  const supabase = createClient();

  useEffect(() => {
    async function loadDevices() {
      try {
        const fleetData = await getFleetData(supabase);
        if (fleetData.devices && fleetData.devices.length > 0) {
          const ids = fleetData.devices.map((d: any) => d.device_id).filter(Boolean);
          if (ids.length > 0) {
            setDevices(ids);
            setDeviceId((prev) => (ids.includes(prev) ? prev : ids[0]));
          }
        }
      } catch (e) {
        console.error('Error loading devices for oscilloscope:', e);
      }
    }
    loadDevices();
  }, [supabase]);

  useEffect(() => {
    let isSubscribed = true;

    async function fetchLatest() {
      if (!deviceId) return;
      try {
        const { data } = await supabase
          .from('telemetry')
          .select('*')
          .eq('device_id', deviceId)
          .order('server_received_at', { ascending: false })
          .limit(60);

        if (data && isSubscribed) {
          const mapped = [...data].reverse().map((r: any) => {
            const timeStr = r.ts ? new Date(r.ts).toLocaleTimeString() : new Date().toLocaleTimeString();
            
            const fsG = Number(r.accel_fs_g || 2);
            const countsPerG = 32768 / fsG;
            const fsDps = Number(r.gyro_fs_dps || 250);
            const countsPerDps = 32768 / fsDps;

            // Accel Calibrated / Raw
            const rawHoriz = r.accel_cal?.horizontal_peak != null 
              ? Number(r.accel_cal.horizontal_peak) 
              : (r.accel_raw?.x != null ? Number(r.accel_raw.x) : (r.accel_raw?.ax != null ? Number(r.accel_raw.ax) : 0.0));
            const horiz = rawHoriz > 100 ? rawHoriz / countsPerG : rawHoriz;

            const rawMag = r.accel_cal?.magnitude_peak != null 
              ? Number(r.accel_cal.magnitude_peak) 
              : (r.accel_raw?.y != null ? Number(r.accel_raw.y) : (r.accel_raw?.ay != null ? Number(r.accel_raw.ay) : 0.0));
            const mag = rawMag > 100 ? rawMag / countsPerG : rawMag;

            const rawVert = r.accel_cal?.vertical_rms != null 
              ? Number(r.accel_cal.vertical_rms) 
              : (r.accel_raw?.z != null ? Number(r.accel_raw.z) : (r.accel_raw?.az != null ? Number(r.accel_raw.az) : countsPerG));
            const vert = rawVert > 100 ? rawVert / countsPerG : rawVert;
            
            // Gyro Calibrated / Raw
            const rawYaw = r.gyro_cal?.yaw_rate_peak != null 
              ? Number(r.gyro_cal.yaw_rate_peak) 
              : (r.gyro_cal?.yaw_rate_deg_s != null 
                  ? Number(r.gyro_cal.yaw_rate_deg_s) 
                  : (r.gyro_raw?.z != null ? Number(r.gyro_raw.z) : (r.gyro_raw?.gz != null ? Number(r.gyro_raw.gz) : 0.0)));
            const yaw = rawYaw > 10 ? rawYaw / countsPerDps : rawYaw;

            const rssi = r.wifi_rssi != null ? Number(r.wifi_rssi) : -65;

            return {
              time: timeStr,
              accelX: parseFloat(horiz.toFixed(3)),
              accelY: parseFloat(mag.toFixed(3)),
              accelZ: parseFloat(vert.toFixed(3)),
              gyroYaw: parseFloat(yaw.toFixed(2)),
              wifiRssi: rssi,
            };
          });
          setStreamData(mapped);
        }
      } catch (e) {
        console.error('Oscilloscope telemetry poll error:', e);
      }
    }

    fetchLatest();
    const interval = setInterval(fetchLatest, 1000);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [deviceId, supabase]);

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header
        title="Telemetry Oscilloscope"
        subtitle="Real-time 50Hz calibrated IMU sensor stream oscilloscope"
      />

      <div className="bg-black border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800 font-mono text-[11px]">
          <Link href="/hardware" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            Fleet Registry
          </Link>
          <Link href="/hardware/scope" className="px-3 py-1 rounded-md bg-zinc-800 text-white font-semibold">
            Oscilloscope
          </Link>
          <Link href="/hardware/anomalies" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            Anomalies & Faults
          </Link>
        </div>

        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-zinc-400">Target Device:</span>
          <select 
            value={deviceId} 
            onChange={(e) => setDeviceId(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1 text-white font-mono text-[11px] focus:outline-none focus:border-zinc-500"
          >
            {devices.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="p-5 space-y-4 w-full font-mono">
        {/* Metric Overview Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 space-y-1">
            <span className="text-[10px] text-zinc-400 uppercase font-semibold flex items-center gap-1">
              <Activity size={12} className="text-emerald-400" />
              Stream Buffer
            </span>
            <p className="text-lg font-bold text-white">{streamData.length} windows</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 space-y-1">
            <span className="text-[10px] text-zinc-400 uppercase font-semibold flex items-center gap-1">
              <Compass size={12} className="text-sky-400" />
              Latest Vert RMS
            </span>
            <p className="text-lg font-bold text-sky-400">
              {streamData.length > 0 ? streamData[streamData.length - 1].accelZ.toFixed(3) : '1.000'} g
            </p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 space-y-1">
            <span className="text-[10px] text-zinc-400 uppercase font-semibold flex items-center gap-1">
              <Radio size={12} className="text-amber-400" />
              Latest Yaw Rate
            </span>
            <p className="text-lg font-bold text-amber-400">
              {streamData.length > 0 ? streamData[streamData.length - 1].gyroYaw.toFixed(2) : '0.00'} °/s
            </p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 space-y-1">
            <span className="text-[10px] text-zinc-400 uppercase font-semibold flex items-center gap-1">
              <Wifi size={12} className="text-emerald-400" />
              WiFi RSSI
            </span>
            <p className="text-lg font-bold text-emerald-400">
              {streamData.length > 0 ? streamData[streamData.length - 1].wifiRssi : -65} dBm
            </p>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 flex flex-col h-80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white uppercase text-[11px] flex items-center gap-1.5">
                <Activity size={13} className="text-emerald-400" />
                Calibrated Accelerometer (g)
              </span>
              <span className="text-zinc-500 text-[10px]">{deviceId}</span>
            </div>

            <div className="flex-1 min-h-0 bg-black p-2 rounded-md border border-zinc-800">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={streamData}>
                  <XAxis dataKey="time" stroke="#52525b" tick={{ fontSize: 9 }} />
                  <YAxis stroke="#52525b" tick={{ fontSize: 9 }} domain={[-1.5, 2.5]} />
                  <Tooltip contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', fontSize: '10px' }} />
                  <Line type="monotone" dataKey="accelX" name="Horiz Peak" stroke="#a1a1aa" dot={false} isAnimationActive={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="accelY" name="Mag Peak" stroke="#71717a" dot={false} isAnimationActive={false} strokeWidth={1.5} />
                  <Line type="monotone" dataKey="accelZ" name="Vert RMS" stroke="#10b981" dot={false} isAnimationActive={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 flex flex-col h-80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-white uppercase text-[11px] flex items-center gap-1.5">
                <Compass size={13} className="text-amber-400" />
                Gyro Yaw Rate (°/s) & WiFi RSSI
              </span>
              <span className="text-zinc-500 text-[10px]">{deviceId}</span>
            </div>

            <div className="flex-1 min-h-0 bg-black p-2 rounded-md border border-zinc-800">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={streamData}>
                  <XAxis dataKey="time" stroke="#52525b" tick={{ fontSize: 9 }} />
                  <YAxis yAxisId="left" stroke="#52525b" tick={{ fontSize: 9 }} domain={[-25, 25]} />
                  <YAxis yAxisId="right" orientation="right" stroke="#71717a" tick={{ fontSize: 9 }} domain={[-100, -30]} />
                  <Tooltip contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', fontSize: '10px' }} />
                  <Line yAxisId="left" type="monotone" dataKey="gyroYaw" name="Gyro Yaw (°/s)" stroke="#f59e0b" dot={false} isAnimationActive={false} strokeWidth={1.5} />
                  <Line yAxisId="right" type="monotone" dataKey="wifiRssi" name="WiFi RSSI (dBm)" stroke="#38bdf8" dot={false} isAnimationActive={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
