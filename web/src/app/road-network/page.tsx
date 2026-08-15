'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { MapHexagon, OSMMap } from '@/components/map/OSMMap';
import { createClient } from '@/lib/supabase/client';
import { cellToBoundary } from 'h3-js';
import { Layers, Activity, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';

interface RoadCellRow {
  h3_12: string;
  roughness_index: number;
  pass_count: number;
  spike_count: number;
  speed_p85_kmh: number;
  defect_confidence: number;
  last_pass_at?: string;
}

export default function RoadNetworkQuality() {
  const [roadCells, setRoadCells] = useState<RoadCellRow[]>([]);
  const [selectedCell, setSelectedCell] = useState<RoadCellRow | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const loadRoadCells = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('road_cells')
        .select('*')
        .order('roughness_index', { ascending: false })
        .limit(200);

      if (data && !error) {
        const mapped: RoadCellRow[] = data.map((c: any) => ({
          h3_12: String(c.h3_12 || ''),
          roughness_index: Number(c.roughness_index ?? 0),
          pass_count: Number(c.pass_count ?? 0),
          spike_count: Number(c.spike_count ?? 0),
          speed_p85_kmh: Number(c.speed_p85_kmh ?? 0),
          defect_confidence: Number(c.defect_confidence ?? 0),
          last_pass_at: c.last_pass_at ? String(c.last_pass_at) : undefined,
        }));
        setRoadCells(mapped);
        if (mapped.length > 0 && !selectedCell) {
          setSelectedCell(mapped[0]);
        }
      }
    } catch (err) {
      console.error('Error loading road cells:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRoadCells();
  }, [supabase]);

  const mapHexagons: MapHexagon[] = roadCells.map((cell) => {
    let color = '#22c55e';
    if (cell.roughness_index >= 80) color = '#ef4444';
    else if (cell.roughness_index >= 55) color = '#f97316';
    else if (cell.roughness_index >= 25) color = '#eab308';

    let boundary: [number, number][] = [];
    try {
      boundary = cellToBoundary(cell.h3_12);
    } catch {
      boundary = [
        [6.915, 79.852],
        [6.916, 79.854],
        [6.915, 79.856],
        [6.914, 79.854],
      ];
    }

    return {
      id: cell.h3_12,
      boundary,
      color,
      fillOpacity: 0.55,
      roughnessIndex: cell.roughness_index,
      passCount: cell.pass_count,
      spikeCount: cell.spike_count,
      speedP85: cell.speed_p85_kmh,
      defectConfidence: cell.defect_confidence,
      tooltipText: `H3: ${cell.h3_12} | Roughness: ${cell.roughness_index.toFixed(1)}/100 | Passes: ${cell.pass_count}`,
    };
  });

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-black text-white font-sans text-xs">
      <Header
        title="Road Quality Map"
        subtitle="H3 grid spatial surface quality heatmap and roughness index"
      />

      <div className="bg-black border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800 font-mono text-[11px]">
          <Link href="/road-network" className="px-3 py-1 rounded-md bg-zinc-800 text-white font-semibold">
            H3 Grid
          </Link>
          <Link href="/road-network/defects" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            Defects Inventory
          </Link>
          <Link href="/road-network/predictions" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            Hazard Predictions
          </Link>
        </div>

        <div className="flex items-center gap-4 font-mono text-[11px] text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span>Smooth (0-25)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 inline-block" />
            <span>Wear (26-55)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" />
            <span>Rough (56-80)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
            <span className="text-white font-bold">Severe (&gt;80)</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden p-3 gap-3">
        <div className="flex-1 rounded-md border border-zinc-800 overflow-hidden bg-zinc-950">
          <OSMMap
            center={[6.915, 79.852]}
            zoom={14}
            hexagons={mapHexagons}
          />
        </div>

        <div className="w-80 bg-zinc-950 border border-zinc-800 rounded-md p-3.5 flex flex-col space-y-3 font-mono text-[11px]">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2 font-semibold text-zinc-300 uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Layers size={13} className="text-emerald-400" />
              Spatial Cell Inspector
            </span>
            <button
              onClick={loadRoadCells}
              className="text-zinc-500 hover:text-white transition-colors"
              title="Refresh road cells"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="bg-black p-3 rounded-md border border-zinc-800 space-y-1">
            <span className="text-zinc-500 text-[10px] uppercase font-semibold">Loaded H3 Cells</span>
            <p className="text-lg font-bold text-white">{roadCells.length} cells indexed</p>
          </div>

          <div className="bg-black p-3 rounded-md border border-zinc-800 space-y-1">
            <span className="text-zinc-500 text-[10px] uppercase font-semibold">Grid Resolution</span>
            <p className="font-bold text-white">Res 12 (~9.4m hexagon edge)</p>
          </div>

          {selectedCell ? (
            <div className="bg-black p-3 rounded-md border border-zinc-800 space-y-2">
              <span className="text-zinc-500 text-[10px] uppercase font-semibold block">Active Cell Details</span>
              <p className="font-bold text-emerald-400 font-mono text-xs">{selectedCell.h3_12}</p>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-zinc-900 text-[10px]">
                <div>
                  <span className="text-zinc-500">Roughness:</span>
                  <p className="text-white font-bold">{selectedCell.roughness_index.toFixed(1)} / 100</p>
                </div>
                <div>
                  <span className="text-zinc-500">Pass Count:</span>
                  <p className="text-white font-bold">{selectedCell.pass_count} passes</p>
                </div>
                <div>
                  <span className="text-zinc-500">Spike Count:</span>
                  <p className="text-white font-bold">{selectedCell.spike_count} spikes</p>
                </div>
                <div>
                  <span className="text-zinc-500">P85 Speed:</span>
                  <p className="text-white font-bold">{selectedCell.speed_p85_kmh.toFixed(1)} km/h</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-black rounded-md border border-zinc-800 text-center text-zinc-500">
              {loading ? 'Loading H3 cells...' : 'No road cells ingested yet.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
