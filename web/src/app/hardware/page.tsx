'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { Header } from '@/components/common/Header';
import { createClient } from '@/lib/supabase/client';
import {
  Cpu,
  ArrowRight,
  Plus,
  Edit2,
  Trash2,
  Link2,
  Car,
  User,
  CheckCircle2,
  XCircle,
  MapPin,
  Map as MapIcon,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { OSMMap, MapMarker } from '@/components/map/OSMMap';
import {
  DeviceRecord,
  VehicleRecord,
  DriverRecord,
} from '@/lib/fleet/types';
import {
  getFleetData,
  createDevice,
  updateDevice,
  deleteDevice,
  assignDeviceToVehicle,
  unassignDeviceFromVehicle,
} from '@/lib/fleet/api';
import { DeviceDrawer } from '@/components/fleet/DeviceDrawer';
import { AssignDrawer } from '@/components/fleet/AssignDrawer';

export default function HardwareFleetRegistry() {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [deviceLocations, setDeviceLocations] = useState<Record<string, { lat: number; lon: number; speed_kmh: number; heading: number; sats: number; last_seen?: string }>>({});
  const [showMap, setShowMap] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  // Drawers
  const [deviceDrawerOpen, setDeviceDrawerOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<DeviceRecord | null>(null);
  const [assignDrawerOpen, setAssignDrawerOpen] = useState(false);
  const [assignTargetDevice, setAssignTargetDevice] = useState<DeviceRecord | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const fleet = await getFleetData(supabase);
      setDevices(fleet.devices);
      setVehicles(fleet.vehicles);
      setDrivers(fleet.drivers);

      // Fetch latest GPS positions for fleet hardware units
      const { data: latestTel } = await supabase
        .from('telemetry')
        .select('device_id, gps, server_received_at')
        .order('server_received_at', { ascending: false })
        .limit(200);

      if (latestTel) {
        const locs: Record<string, any> = {};
        for (const row of latestTel) {
          if (!locs[row.device_id] && row.gps?.lat && row.gps?.lon && Number(row.gps.lat) !== 0) {
            locs[row.device_id] = {
              lat: Number(row.gps.lat),
              lon: Number(row.gps.lon),
              speed_kmh: Number(row.gps.speed_kmh ?? 0),
              heading: Number(row.gps.heading ?? 0),
              sats: Number(row.gps.sats ?? 0),
              last_seen: row.server_received_at,
            };
          }
        }
        setDeviceLocations(locs);
      }
    } catch (err) {
      console.error('Error loading hardware fleet:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    setIsMounted(true);
    loadData();

    // Supabase Realtime subscription for device provisioning and pairing changes
    const channel = supabase
      .channel('realtime_fleet_hardware')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => {
        loadData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => {
        loadData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData, supabase]);

  const handleSaveDevice = async (formData: {
    device_id: string;
    accel_fs_g: number;
    gyro_fs_dps: number;
    active: boolean;
    vehicle_id: string;
    driver_id: string;
  }) => {
    if (editingDevice) {
      await updateDevice(supabase, editingDevice.device_id, formData);
    } else {
      await createDevice(supabase, formData);
    }
    await loadData();
  };

  const handleDeleteDevice = async (deviceId: string) => {
    await deleteDevice(supabase, deviceId);
    await loadData();
  };

  const handleSavePairing = async (pairingData: {
    vehicle_id: string;
    device_id: string;
    driver_id: string;
  }) => {
    await assignDeviceToVehicle(
      supabase,
      pairingData.device_id,
      pairingData.vehicle_id,
      pairingData.driver_id || null
    );
    await loadData();
  };

  const handleUnassign = async (vehicleId: string) => {
    await unassignDeviceFromVehicle(supabase, vehicleId);
    await loadData();
  };

  const activeUnitsCount = devices.filter((d) => d.active).length;
  const boundUnitsCount = devices.filter((d) => d.vehicle_id).length;

  const fleetMarkers: MapMarker[] = useMemo(() => {
    return devices
      .filter((d) => deviceLocations[d.device_id])
      .map((d) => {
        const loc = deviceLocations[d.device_id];
        return {
          id: d.device_id,
          lat: loc.lat,
          lon: loc.lon,
          title: `Device ${d.device_id}`,
          type: 'vehicle' as const,
          heading: loc.heading,
          speedKmh: loc.speed_kmh,
          details: `Device: ${d.device_id} | Vehicle: ${d.vehicle_plate || d.vehicle_id || 'Unassigned'} | Speed: ${loc.speed_kmh.toFixed(1)} km/h | Sats: ${loc.sats}`,
        };
      });
  }, [devices, deviceLocations]);

  const fleetCenter: [number, number] = useMemo(() => {
    const validPositions = Object.values(deviceLocations);
    if (validPositions.length > 0) {
      return [validPositions[0].lat, validPositions[0].lon];
    }
    return [6.9271, 79.8612];
  }, [deviceLocations]);

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header
        title="Hardware Operations Hub"
        subtitle="ESP32 telematics fleet calibration, provisioning, and telemetry inspector"
      />

      {/* Navigation Bar */}
      <div className="bg-black border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-md border border-zinc-800 font-mono text-[11px]">
          <Link href="/hardware" className="px-3 py-1 rounded-md bg-zinc-800 text-white font-semibold">
            Fleet Registry
          </Link>
          <Link href="/hardware/scope" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            Oscilloscope
          </Link>
          <Link href="/hardware/anomalies" className="px-3 py-1 rounded-md text-zinc-400 hover:text-white transition-colors">
            Anomalies & Faults
          </Link>
        </div>

        <button
          onClick={() => {
            setEditingDevice(null);
            setDeviceDrawerOpen(true);
          }}
          className="px-3 py-1 rounded-md bg-white text-black hover:bg-zinc-200 font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Plus size={13} />
          <span>Provision Device</span>
        </button>
      </div>

      <div className="p-5 space-y-4 w-full">
        {/* Fleet Hardware Metrics Header */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Provisioned Devices</span>
            <p className="text-xl font-bold font-mono text-white">{devices.length}</p>
            <p className="text-zinc-500 text-[10px]">Total registered telematics units</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">In-Service Bindings</span>
            <p className="text-xl font-bold font-mono text-emerald-400">
              {boundUnitsCount} / {devices.length}
            </p>
            <p className="text-zinc-500 text-[10px]">Units attached to active vehicles</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <span className="text-[11px] text-zinc-400 font-medium">Active Ingestion</span>
            <p className="text-xl font-bold font-mono text-white">{activeUnitsCount} Units</p>
            <p className="text-zinc-500 text-[10px]">Eligible for 50Hz ingestion pipeline</p>
          </div>
        </div>

        {/* Fleet Hardware Geographic Map */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
            <div className="flex items-center gap-2">
              <MapPin size={15} className="text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                Fleet Hardware Geographic Locations
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono text-zinc-400">
                {Object.keys(deviceLocations).length} / {devices.length} Units Located
              </span>
              <button
                onClick={() => setShowMap(!showMap)}
                className="px-2 py-0.5 rounded-sm bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 flex items-center gap-1 font-mono text-[10px] transition-colors"
              >
                {showMap ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                <span>{showMap ? 'Collapse Map' : 'Expand Map'}</span>
              </button>
            </div>
          </div>

          {showMap && (
            <div className="relative h-64 w-full rounded overflow-hidden border border-zinc-800">
              <OSMMap
                center={fleetCenter}
                zoom={11}
                markers={fleetMarkers}
                className="w-full h-full"
              />
              <div className="absolute bottom-2 left-2 bg-black/85 backdrop-blur border border-zinc-800 rounded px-2.5 py-1 text-[10px] font-mono text-zinc-400 z-[500] flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Live GPS Positions of In-Field ESP32 Hardware</span>
              </div>
            </div>
          )}
        </div>

        {/* Hardware Devices Grid */}
        {loading ? (
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-12 text-center text-zinc-500 font-mono">
            Loading provisioned hardware units...
          </div>
        ) : devices.length === 0 ? (
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-12 text-center text-zinc-500 font-mono">
            No hardware devices registered. Click &quot;Provision Device&quot; to onboard an ESP32 unit.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {devices.map((device, idx) => (
              <div
                key={device.device_id ? `dev-${device.device_id}-${idx}` : `dev-${idx}`}
                className="bg-zinc-950 border border-zinc-800 rounded-md p-4 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  {/* Card Header */}
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                    <div className="flex items-center gap-2">
                      <Cpu size={15} className="text-emerald-400" />
                      <h3 className="text-xs font-bold text-white font-mono">{device.device_id}</h3>
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold uppercase font-mono border flex items-center gap-1 ${
                        device.active
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-800/60'
                          : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                      }`}
                    >
                      {device.active ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                      {device.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  {/* Accel & Gyro Scales */}
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="bg-black p-2 rounded-md border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 uppercase font-semibold">Accel FS</span>
                      <p className="font-bold text-white mt-0.5">±{device.accel_fs_g}g</p>
                    </div>
                    <div className="bg-black p-2 rounded-md border border-zinc-800">
                      <span className="text-[10px] text-zinc-500 uppercase font-semibold">Gyro FS</span>
                      <p className="font-bold text-white mt-0.5">±{device.gyro_fs_dps} dps</p>
                    </div>
                  </div>

                  {/* Vehicle & Driver Bindings */}
                  <div className="p-2.5 bg-black rounded-md border border-zinc-800 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500 flex items-center gap-1 text-[11px]">
                        <Car size={12} />
                        Vehicle:
                      </span>
                      <span className="font-mono font-semibold text-white">
                        {device.vehicle_plate || 'Unbound (Spare)'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500 flex items-center gap-1 text-[11px]">
                        <User size={12} />
                        Driver:
                      </span>
                      <span className="font-medium text-zinc-300">
                        {device.driver_name || 'Unassigned'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="pt-2 border-t border-zinc-800 flex items-center justify-between font-mono text-[11px]">
                  <span className="text-zinc-500" suppressHydrationWarning>
                    Installed: {isMounted && device.installed_at ? new Date(device.installed_at).toLocaleDateString() : (device.installed_at ? device.installed_at.slice(0, 10) : 'N/A')}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setAssignTargetDevice(device);
                        setAssignDrawerOpen(true);
                      }}
                      title="Pair / Reassign"
                      className="p-1 rounded text-zinc-400 hover:text-emerald-400 hover:bg-zinc-900 transition-colors"
                    >
                      <Link2 size={13} />
                    </button>

                    <button
                      onClick={() => {
                        setEditingDevice(device);
                        setDeviceDrawerOpen(true);
                      }}
                      title="Edit Device Configuration"
                      className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
                    >
                      <Edit2 size={13} />
                    </button>

                    <button
                      onClick={() => handleDeleteDevice(device.device_id)}
                      title="Decommission Device"
                      className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-900 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>

                    <Link
                      href={`/hardware/${device.device_id}`}
                      className="px-2 py-0.5 rounded bg-zinc-900 text-white border border-zinc-800 hover:bg-zinc-850 transition-colors flex items-center gap-1 font-sans"
                    >
                      <span>Inspect</span>
                      <ArrowRight size={11} />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Drawers */}
      <DeviceDrawer
        isOpen={deviceDrawerOpen}
        onClose={() => setDeviceDrawerOpen(false)}
        device={editingDevice}
        vehicles={vehicles}
        drivers={drivers}
        onSave={handleSaveDevice}
        onDelete={handleDeleteDevice}
      />

      <AssignDrawer
        isOpen={assignDrawerOpen}
        onClose={() => setAssignDrawerOpen(false)}
        targetDevice={assignTargetDevice}
        vehicles={vehicles}
        devices={devices}
        drivers={drivers}
        onSave={handleSavePairing}
        onUnassign={handleUnassign}
      />
    </div>
  );
}
