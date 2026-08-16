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
            const timeStr = r.ts
              ? new Date(r.ts).toLocaleTimeString()
              : (r.server_received_at ? new Date(r.server_received_at).toLocaleTimeString() : `#${r.seq ?? ''}`);
            
            const fsG = Number(r.accel_fs_g || 2);
            const countsPerG = 32768 / fsG;
            const fsDps = Number(r.gyro_fs_dps || 250);
            const countsPerDps = 32768 / fsDps;

            // Accel Calibrated / Raw conversions
            let vert = 0;
            if (r.accel_cal?.vertical_rms != null) {
              vert = Number(r.accel_cal.vertical_rms) / countsPerG;
            } else if (r.calibrated_accel?.a_vert != null || r.calibrated_accel?.rms_g != null) {
              vert = Number(r.calibrated_accel.a_vert ?? r.calibrated_accel.rms_g);
            } else if (r.accel_raw?.z != null || r.accel_raw?.az != null) {
              vert = Number(r.accel_raw.z ?? r.accel_raw.az) / countsPerG;
            }

            let horiz = 0;
            if (r.accel_cal?.horizontal_peak != null) {
              horiz = Number(r.accel_cal.horizontal_peak) / countsPerG;
            } else if (r.calibrated_accel?.a_long != null) {
              horiz = Number(r.calibrated_accel.a_long);
            } else if (r.accel_raw?.x != null || r.accel_raw?.ax != null) {
              horiz = Number(r.accel_raw.x ?? r.accel_raw.ax) / countsPerG;
            }

            let mag = 0;
            if (r.accel_cal?.magnitude_peak != null) {
              mag = Number(r.accel_cal.magnitude_peak) / countsPerG;
            } else if (r.calibrated_accel?.peak_g != null) {
              mag = Number(r.calibrated_accel.peak_g);
            } else {
              mag = Math.hypot(horiz, vert);
            }
            
            // Gyro Calibrated / Raw conversions
            let yaw = 0;
            if (r.gyro_cal?.yaw_rate_peak != null) {
              yaw = Number(r.gyro_cal.yaw_rate_peak) / countsPerDps;
            } else if (r.gyro_cal?.yaw_rate_deg_s != null || r.yaw_rate != null) {
              yaw = Number(r.gyro_cal?.yaw_rate_deg_s ?? r.yaw_rate);
            } else if (r.gyro_raw?.z != null || r.gyro_raw?.gz != null) {
              yaw = Number(r.gyro_raw.z ?? r.gyro_raw.gz) / countsPerDps;
            }

            const rssi = r.wifi_rssi != null ? Number(r.wifi_rssi) : -99;

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

    // Supabase Realtime channel subscription for instant 50Hz/1Hz telemetry stream updates
    const channel = supabase
      .channel(`scope_telemetry_${deviceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'telemetry', filter: `device_id=eq.${deviceId}` },
        () => {
          fetchLatest();
        }
      )
      .subscribe();

    const interval = setInterval(fetchLatest, 1500);

    return () => {
      isSubscribed = false;
      supabase.removeChannel(channel);
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
              {streamData.length > 0 ? `${streamData[streamData.length - 1].accelZ.toFixed(3)} g` : '--'}
            </p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 space-y-1">
            <span className="text-[10px] text-zinc-400 uppercase font-semibold flex items-center gap-1">
              <Radio size={12} className="text-amber-400" />
              Latest Yaw Rate
            </span>
            <p className="text-lg font-bold text-amber-400">
              {streamData.length > 0 ? `${streamData[streamData.length - 1].gyroYaw.toFixed(2)} °/s` : '--'}
            </p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 space-y-1">
            <span className="text-[10px] text-zinc-400 uppercase font-semibold flex items-center gap-1">
              <Wifi size={12} className="text-emerald-400" />
              WiFi RSSI
            </span>
            <p className="text-lg font-bold text-emerald-400">
              {streamData.length > 0 && streamData[streamData.length - 1].wifiRssi !== -99
                ? `${streamData[streamData.length - 1].wifiRssi} dBm`
                : '--'}
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
                  <YAxis stroke="#52525b" tick={{ fontSize: 9 }} domain={['auto', 'auto']} />
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
                  <YAxis yAxisId="left" stroke="#52525b" tick={{ fontSize: 9 }} domain={['auto', 'auto']} />
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
