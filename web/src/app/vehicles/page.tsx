'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Car,
  Plus,
  Search,
  Cpu,
  UserCheck,
  Link2,
  Edit2,
  Trash2,
  Layers,
  Radio,
  Route,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { Header } from '@/components/common/Header';
import { createClient } from '@/lib/supabase/client';
import {
  VehicleRecord,
  DriverRecord,
  DeviceRecord,
} from '@/lib/fleet/types';
import {
  getFleetData,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  assignDeviceToVehicle,
  unassignDeviceFromVehicle,
} from '@/lib/fleet/api';
import { VehicleDrawer } from '@/components/fleet/VehicleDrawer';
import { AssignDrawer } from '@/components/fleet/AssignDrawer';

export default function VehiclesPage() {
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([]);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Search
  const [search, setSearch] = useState('');

  // Drawers
  const [vehicleDrawerOpen, setVehicleDrawerOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<VehicleRecord | null>(null);
  const [assignDrawerOpen, setAssignDrawerOpen] = useState(false);
  const [assignTargetVehicle, setAssignTargetVehicle] = useState<VehicleRecord | null>(null);

  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const data = await getFleetData(supabase);
      setVehicles(data.vehicles);
      setDrivers(data.drivers);
      setDevices(data.devices);
    } catch (err) {
      console.error('Error loading fleet data:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadData(true);

    const channel = supabase
      .channel('vehicles_fleet_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => loadData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'devices' }, () => loadData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => loadData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => loadData(false))
      .subscribe();

    const interval = setInterval(() => {
      loadData(false);
    }, 3000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [loadData, supabase]);

  // Metric computations
  const totalVehicles = vehicles.length;
  const equippedCount = vehicles.filter((v) => v.assigned_device_id).length;
  const activeMovingCount = vehicles.filter((v) => v.is_active_moving).length;
  const totalFleetDistanceKm = vehicles
    .reduce((acc, v) => acc + (v.total_distance_km || 0), 0)
    .toFixed(1);

  // Filtered vehicles
  const filteredVehicles = useMemo(() => {
    return vehicles.filter((v) => {
      const plate = (v.plate || '').toLowerCase();
      const make = (v.make || '').toLowerCase();
      const model = (v.model || '').toLowerCase();
      const deviceId = (v.assigned_device_id || '').toLowerCase();
      const driverName = (v.assigned_driver_name || '').toLowerCase();
      const q = search.toLowerCase();

      return (
        plate.includes(q) ||
        make.includes(q) ||
        model.includes(q) ||
        deviceId.includes(q) ||
        driverName.includes(q)
      );
    });
  }, [vehicles, search]);

  const handleSaveVehicle = async (formData: {
    plate: string;
    make: string;
    model: string;
    year: number | undefined;
    assign_driver_id: string;
    assign_device_id: string;
  }) => {
    if (editingVehicle) {
      await updateVehicle(supabase, editingVehicle.id, formData);
    } else {
      await createVehicle(supabase, formData);
    }
    await loadData();
  };

  const handleDeleteVehicle = async (id: string) => {
    await deleteVehicle(supabase, id);
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

  return (
    <div className="flex flex-col min-h-screen bg-black text-white font-sans text-xs">
      <Header
        title="Fleet Vehicle Registry"
        subtitle="Commercial fleet assets, telematics pairings, and live telemetry tracking"
      />

      <div className="p-5 space-y-4 w-full">
        {/* Metric Cards Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 font-medium">Total Fleet Vehicles</span>
              <Layers size={14} className="text-zinc-500" />
            </div>
            <p className="text-xl font-bold font-mono text-white">{totalVehicles}</p>
            <p className="text-zinc-500 text-[10px]">Registered in database</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
                <span>Active in Motion</span>
                {activeMovingCount > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </span>
              <Activity size={14} className="text-emerald-400" />
            </div>
            <p className="text-xl font-bold font-mono text-emerald-400">
              {activeMovingCount} <span className="text-xs text-zinc-500 font-sans">/ {totalVehicles}</span>
            </p>
            <p className="text-zinc-500 text-[10px]">Vehicles with active trip sessions</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 font-medium">Telematics Equipped</span>
              <Cpu size={14} className="text-blue-400" />
            </div>
            <p className="text-xl font-bold font-mono text-white">
              {equippedCount} <span className="text-xs text-zinc-500 font-sans">/ {totalVehicles}</span>
            </p>
            <p className="text-zinc-500 text-[10px]">Active hardware units installed</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 font-medium">Verified Fleet Odometer</span>
              <Route size={14} className="text-emerald-400" />
            </div>
            <p className="text-xl font-bold font-mono text-white">
              {totalFleetDistanceKm} <span className="text-xs text-zinc-500 font-sans">km</span>
            </p>
            <p className="text-zinc-500 text-[10px]">Cumulative distance across trips</p>
          </div>
        </div>

        {/* Toolbar: Search + Register Button */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-2.5 text-zinc-500" size={14} />
            <input
              type="text"
              placeholder="Search by plate, make, model, device ID, or driver..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-black border border-zinc-800 rounded-md pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={() => {
                setEditingVehicle(null);
                setVehicleDrawerOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-md bg-white text-black hover:bg-zinc-200 font-semibold flex items-center gap-1.5 transition-colors"
            >
              <Plus size={13} />
              <span>Register Vehicle</span>
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-zinc-950 border border-zinc-800 rounded-md overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-900/60 border-b border-zinc-800 text-zinc-400 uppercase text-[11px] font-semibold tracking-wider font-mono">
                <th className="p-3">Vehicle Plate</th>
                <th className="p-3">Status</th>
                <th className="p-3">Make & Model</th>
                <th className="p-3">Assigned Unit</th>
                <th className="p-3">Assigned Driver</th>
                <th className="p-3">Verified Distance</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 text-zinc-300">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-zinc-500 font-mono">
                    Loading commercial fleet registry...
                  </td>
                </tr>
              ) : filteredVehicles.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-zinc-500 font-mono">
                    No vehicles found matching current criteria.
                  </td>
                </tr>
              ) : (
                filteredVehicles.map((vehicle) => {
                  return (
                    <tr key={vehicle.id} className="hover:bg-zinc-900/50 transition-colors">
                      {/* Plate */}
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Car size={14} className="text-zinc-500 shrink-0" />
                          <span className="font-bold text-white font-mono tracking-wide">
                            {vehicle.plate || 'NO-PLATE'}
                          </span>
                        </div>
                      </td>

                      {/* Operational Status */}
                      <td className="p-3">
                        {vehicle.is_active_moving ? (
                          <Link
                            href={vehicle.active_trip_id ? `/trips/${vehicle.active_trip_id}` : '/trips'}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 font-mono text-[10px] font-semibold hover:border-emerald-400 transition-colors"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>In Trip</span>
                            <ArrowRight size={10} />
                          </Link>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 font-mono text-[10px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                            <span>Parked / Idle</span>
                          </span>
                        )}
                      </td>

                      {/* Make & Model */}
                      <td className="p-3 text-zinc-300">
                        <span>{vehicle.make || 'Generic'} {vehicle.model || ''}</span>
                        {vehicle.year && (
                          <span className="text-zinc-500 ml-1.5 font-mono text-[11px]">
                            ({vehicle.year})
                          </span>
                        )}
                      </td>

                      {/* Installed Device */}
                      <td className="p-3 font-mono">
                        {vehicle.assigned_device_id ? (
                          <Link
                            href={`/hardware/${vehicle.assigned_device_id}`}
                            className="px-1.5 py-0.5 rounded-sm bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 font-semibold text-[11px] inline-flex items-center gap-1 hover:border-emerald-400 transition-colors"
                          >
                            <Cpu size={11} />
                            {vehicle.assigned_device_id}
                          </Link>
                        ) : (
                          <span className="text-zinc-500 text-[11px]">Unbound</span>
                        )}
                      </td>

                      {/* Assigned Driver */}
                      <td className="p-3">
                        {vehicle.assigned_driver_name && vehicle.assigned_driver_id ? (
                          <Link
                            href={`/drivers/${vehicle.assigned_driver_id}`}
                            className="text-zinc-200 font-medium hover:text-emerald-400 transition-colors"
                          >
                            {vehicle.assigned_driver_name}
                          </Link>
                        ) : vehicle.assigned_driver_name ? (
                          <span className="text-zinc-200 font-medium">
                            {vehicle.assigned_driver_name}
                          </span>
                        ) : (
                          <span className="text-zinc-500 text-[11px]">Unassigned</span>
                        )}
                      </td>

                      {/* Verified Distance & Trip Count */}
                      <td className="p-3 font-mono">
                        <div className="flex flex-col">
                          <span className="text-white font-medium text-[11px]">
                            {vehicle.total_distance_km !== undefined ? `${vehicle.total_distance_km} km` : '0.0 km'}
                          </span>
                          <span className="text-zinc-500 text-[10px]">
                            {vehicle.total_trips || 0} {(vehicle.total_trips === 1) ? 'trip' : 'trips'}
                          </span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setAssignTargetVehicle(vehicle);
                              setAssignDrawerOpen(true);
                            }}
                            title="Assign Hardware or Driver"
                            className="p-1 rounded text-zinc-400 hover:text-emerald-400 hover:bg-zinc-900 transition-colors"
                          >
                            <Link2 size={13} />
                          </button>

                          <button
                            onClick={() => {
                              setEditingVehicle(vehicle);
                              setVehicleDrawerOpen(true);
                            }}
                            title="Edit Vehicle"
                            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>

                          <button
                            onClick={() => handleDeleteVehicle(vehicle.id)}
                            title="Delete Vehicle"
                            className="p-1 rounded text-zinc-400 hover:text-rose-400 hover:bg-zinc-900 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Drawers */}
      <VehicleDrawer
        isOpen={vehicleDrawerOpen}
        onClose={() => setVehicleDrawerOpen(false)}
        vehicle={editingVehicle}
        drivers={drivers}
        devices={devices}
        onSave={handleSaveVehicle}
        onDelete={handleDeleteVehicle}
      />

      <AssignDrawer
        isOpen={assignDrawerOpen}
        onClose={() => setAssignDrawerOpen(false)}
        targetVehicle={assignTargetVehicle}
        vehicles={vehicles}
        devices={devices}
        drivers={drivers}
        onSave={handleSavePairing}
        onUnassign={handleUnassign}
      />
    </div>
  );
}
