'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { createClient } from '@/lib/supabase/client';
import { AlertTriangle, ShieldCheck, MapPin, Layers, ArrowRight, Check, X } from 'lucide-react';

interface DefectRow {
  id: string;
  h3_12: string;
  headingSector: number;
  lat: number;
  lon: number;
  confidence: number;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  distinctDevices: number;
  spikeRate: number;
  firstSeen: string;
  status: 'active' | 'repaired' | 'disputed';
}

export default function ConfirmedDefectsInventory() {
  const [defects, setDefects] = useState<DefectRow[]>([]);
  const supabase = createClient();

  async function loadDefects() {
    try {
      const { data, error } = await supabase
        .from('road_defects')
        .select('*')
        .order('first_seen', { ascending: false })
        .limit(50);

      if (data && !error) {
        const mappedData: DefectRow[] = data.map((e: any, idx: number) => ({
          id: String(e.id || `def-${idx}`),
          h3_12: String(e.h3_12 || 'N/A'),
          headingSector: Number(e.heading_sector ?? 0),
          lat: Number(e.lat ?? 0),
          lon: Number(e.lon ?? 0),
          severity: (e.severity as any) || 'info',
          confidence: Number(e.confidence ?? 0),
          distinctDevices: Number(e.distinct_devices ?? 1),
          spikeRate: Number(e.spike_rate ?? 0),
          firstSeen: String(e.first_seen || e.last_seen || ''),
          status: e.status || 'active',
        }));
        setDefects(mappedData);
      }
    } catch {
      // Clean DB error handler
    }
  }

  useEffect(() => {
    loadDefects();
  }, [supabase]);

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      await supabase
        .from('road_defects')
        .update({ status: newStatus })
        .eq('id', id);
      
      setDefects((prev) => 
        prev.map((d) => d.id === id ? { ...d, status: newStatus as any } : d)
      );
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header
        title="Defects Inventory"
        subtitle="Verified road hazards and structural surface defects"
      />

      <div className="bg-black border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800 font-mono text-[11px]">
          <Link href="/road-network" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            H3 Grid
          </Link>
          <Link href="/road-network/defects" className="px-3 py-1 rounded-md bg-zinc-800 text-white font-semibold">
            Defects Inventory
          </Link>
          <Link href="/road-network/predictions" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            Hazard Predictions
          </Link>
        </div>

        <div className="font-mono text-[11px] text-zinc-400">
          Total Inventory: <strong className="text-amber-400 font-bold">{defects.length} Hazards</strong>
        </div>
      </div>

      <div className="p-5 space-y-4 w-full">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Confirmed Defect Clusters</span>
            <p className="text-xl font-bold font-mono text-amber-400">{defects.length}</p>
            <p className="text-zinc-500 text-[10px]">Multi-device consensus confirmed</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Critical Hazards</span>
            <p className="text-xl font-bold font-mono text-rose-400">
              {defects.filter((d) => d.severity === 'critical').length}
            </p>
            <p className="text-zinc-500 text-[10px]">Severe potholes & surface drops</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Average Confidence</span>
            <p className="text-xl font-bold font-mono text-emerald-400">
              {defects.length > 0 ? ((defects.reduce((a, d) => a + d.confidence, 0) / defects.length) * 100).toFixed(1) : '100.0'}%
            </p>
            <p className="text-zinc-500 text-[10px]">Statistical confidence score</p>
          </div>
        </div>

        {/* Defects Table */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-900/60 text-zinc-400 border-b border-zinc-800 uppercase text-[11px] font-semibold tracking-wider">
                <th className="p-3">Defect ID</th>
                <th className="p-3">H3 Index</th>
                <th className="p-3">Coordinates</th>
                <th className="p-3">Severity</th>
                <th className="p-3">Confidence</th>
                <th className="p-3">Devices</th>
                <th className="p-3 text-right">Status & Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 text-zinc-300 font-sans">
              {defects.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-zinc-500">
                    No confirmed defect records found.
                  </td>
                </tr>
              ) : (
                defects.map((d) => (
                  <tr key={d.id} className="hover:bg-zinc-900/50 transition-colors">
                    <td className="p-3 font-semibold text-white font-mono">{d.id.slice(0, 8)}...</td>
                    <td className="p-3 font-mono text-emerald-400">{d.h3_12}</td>
                    <td className="p-3 font-mono text-zinc-400">
                      {d.lat.toFixed(4)}, {d.lon.toFixed(4)}
                    </td>
                    <td className="p-3 font-mono">
                      <span
                        className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase border ${
                          d.severity === 'critical'
                            ? 'bg-rose-950 text-rose-400 border-rose-800/60'
                            : d.severity === 'high'
                            ? 'bg-amber-950 text-amber-400 border-amber-800/60'
                            : 'bg-zinc-900 text-zinc-400 border-zinc-800'
                        }`}
                      >
                        {d.severity}
                      </span>
                    </td>
                    <td className="p-3 font-bold font-mono">{(d.confidence * 100).toFixed(0)}%</td>
                    <td className="p-3 font-mono text-zinc-300">{d.distinctDevices} units</td>
                    <td className="p-3 text-right font-mono flex items-center justify-end gap-2">
                      <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold border uppercase ${
                        d.status === 'repaired' ? 'bg-emerald-950 text-emerald-400 border-emerald-800/60' :
                        d.status === 'disputed' ? 'bg-rose-950 text-rose-400 border-rose-800/60' :
                        'bg-amber-950 text-amber-400 border-amber-800/60'
                      }`}>
                        {d.status}
                      </span>
                      {d.status === 'active' && (
                        <>
                          <button
                            onClick={() => handleUpdateStatus(d.id, 'repaired')}
                            className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-emerald-400 transition-colors"
                            title="Mark as Repaired"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => handleUpdateStatus(d.id, 'disputed')}
                            className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-rose-400 transition-colors"
                            title="Dispute"
                          >
                            <X size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
