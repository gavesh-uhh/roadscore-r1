'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { createClient } from '@/lib/supabase/client';
import { ShieldCheck, AlertTriangle, Cpu, CheckCircle2 } from 'lucide-react';
import { formatEventType } from '@/lib/events/format';

interface AnomalyEvent {
  id: string;
  device_id: string;
  type: string;
  message: string;
  occurred_at: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
}

export default function HardwareAnomaliesLog() {
  const [anomalies, setAnomalies] = useState<AnomalyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const loadAnomalies = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      // Query events flagged as sensor integrity or mount anomalies
      const { data, error } = await supabase
        .from('driving_events')
        .select('*')
        .or('category.eq.integrity,type.ilike.%integrity%,type.ilike.%sensor%,type.ilike.%mount%')
        .order('occurred_at', { ascending: false })
        .limit(50);

      if (data && !error) {
        const mapped: AnomalyEvent[] = data.map((e: any, idx: number) => {
          let msg = e.evidence?.reason || (Array.isArray(e.evidence?.reasons) ? e.evidence.reasons.join(', ') : e.evidence?.description) || '';
          
          if (e.type === 'integrity.mount_shift' || e.type?.includes('mount')) {
            msg = `Mount angle shift detected (${e.magnitude ? `${e.magnitude}° deviation` : 'dynamic drift'})`;
          } else if (e.type === 'integrity.data_gap' || e.type?.includes('gap') || e.type?.includes('dropout')) {
            const gapS = e.evidence?.time_gap_s ? `${e.evidence.time_gap_s}s gap` : 'sample interruption';
            const missing = e.evidence?.missing_rows ? `missing ~${e.evidence.missing_rows} rows` : 'sequence jump';
            msg = `Data gap: ${missing} (${gapS})`;
          } else if (e.type === 'integrity.device_reboot' || e.type?.includes('reboot')) {
            const prevSeq = e.evidence?.previous_seq != null ? `#${e.evidence.previous_seq}` : '?';
            const newSeq = e.evidence?.new_seq != null ? `#${e.evidence.new_seq}` : '#1';
            msg = `MCU restart / reboot detected (sequence reset: ${prevSeq} -> ${newSeq})`;
          } else if (e.type === 'integrity.calibration_stale' || e.type?.includes('stale')) {
            const staleSec = e.evidence?.stale_for_s ? `for ${e.evidence.stale_for_s}s` : 'timeout';
            msg = `IMU calibration lock stale ${staleSec} (state: ${e.evidence?.calibration_state || 'unknown'})`;
          } else if (e.type === 'integrity.upload_loss' || e.type?.includes('upload') || e.type?.includes('spool')) {
            const rssi = e.evidence?.wifi_rssi != null ? `RSSI: ${e.evidence.wifi_rssi} dBm` : 'spooling active';
            msg = `Telemetry upload loss: ${e.evidence?.cause || 'LittleFS flash spooling'} (${rssi})`;
          } else if (e.type === 'integrity.gps_degraded' || e.type?.includes('gps')) {
            msg = `GNSS degraded: ${e.evidence?.trigger || 'HDOP loss or zero satellite lock'}`;
          } else if (e.type === 'integrity.sensor_degraded' || e.type?.includes('sensor')) {
            const reasons = Array.isArray(e.evidence?.reasons) ? e.evidence.reasons.join(', ') : (e.evidence?.reason || 'signal degradation');
            msg = `Sensor integrity degraded: ${reasons}`;
          }

          if (!msg) {
            msg = 'Hardware integrity condition detected';
          }

          return {
            id: String(e.id || `anom-${idx}`),
            device_id: String(e.device_id || 'Unassigned Device'),
            type: String(e.type || 'integrity.sensor_degraded'),
            message: msg,
            occurred_at: e.occurred_at ? new Date(e.occurred_at).toLocaleString() : 'Recent',
            severity: (e.severity as any) || 'medium',
            confidence: Number(e.confidence ?? 0),
          };
        });
        setAnomalies(mapped);
      }
    } catch (err) {
      console.error('Error loading hardware anomalies:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadAnomalies(true);

    const channel = supabase
      .channel('realtime_hardware_anomalies')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driving_events' }, () => {
        loadAnomalies(false);
      })
      .subscribe();

    const interval = setInterval(() => {
      loadAnomalies(false);
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [loadAnomalies, supabase]);

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header
        title="Hardware Anomalies"
        subtitle="Hardware health faults and sensor integrity alerts"
      />

      <div className="bg-black border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800 font-mono text-[11px]">
          <Link href="/hardware" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            Fleet Registry
          </Link>
          <Link href="/hardware/scope" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            Oscilloscope
          </Link>
          <Link href="/hardware/anomalies" className="px-3 py-1 rounded-md bg-zinc-800 text-white font-semibold">
            Anomalies & Faults
          </Link>
        </div>

        <div className="font-mono text-[11px] text-zinc-400">
          Logged Faults: <strong className="text-amber-400 font-bold">{anomalies.length} Alerts</strong>
        </div>
      </div>

      <div className="p-5 space-y-4 w-full font-mono">
        <div className="bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-900/60 border-b border-zinc-800 text-zinc-400 uppercase text-[11px] font-semibold tracking-wider font-mono">
                <th className="p-3">Log ID</th>
                <th className="p-3">Device ID</th>
                <th className="p-3">Anomaly Type</th>
                <th className="p-3">Details / Evidence</th>
                <th className="p-3">Occurred At</th>
                <th className="p-3 text-right">Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 text-zinc-300 font-sans">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-zinc-500 font-mono">
                    Checking hardware sensor health telemetry...
                  </td>
                </tr>
              ) : anomalies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-10 text-center text-zinc-400 font-mono">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <CheckCircle2 size={24} className="text-emerald-400" />
                      <span className="text-white font-semibold">Hardware Health Optimal</span>
                      <span className="text-zinc-500 text-[11px]">
                        Zero sensor integrity faults, I2C bus hangs, or IMU mount shifts detected.
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                anomalies.map((a, idx) => {
                  const meta = formatEventType(a.type);
                  return (
                    <tr key={a.id ? `anomaly-${a.id}-${idx}` : `anomaly-${idx}`} className="hover:bg-zinc-900/50 transition-colors">
                      <td className="p-3 font-bold text-white font-mono">{a.id.slice(0, 8)}...</td>
                      <td className="p-3 text-emerald-400 font-mono">
                        <Link href={`/hardware/${a.device_id}`} className="hover:underline">
                          {a.device_id}
                        </Link>
                      </td>
                      <td className="p-3 font-mono">
                        <div className="flex items-center gap-1.5 font-semibold text-white font-sans text-xs">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.dotColor }} />
                          <span>{meta.label}</span>
                        </div>
                        <span className="text-[10px] text-zinc-500 font-mono block pl-3">{a.type}</span>
                      </td>
                      <td className="p-3 text-zinc-400">{a.message || meta.description}</td>
                      <td suppressHydrationWarning className="p-3 text-zinc-500 font-mono">{a.occurred_at}</td>
                      <td className="p-3 text-right font-mono">
                        <span
                          className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase border ${
                            a.severity === 'high' || a.severity === 'critical'
                              ? 'bg-rose-950 text-rose-400 border-rose-800/60'
                              : a.severity === 'medium'
                              ? 'bg-amber-950 text-amber-400 border-amber-800/60'
                              : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                          }`}
                        >
                          {a.severity}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
