'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
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

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getFleetData(supabase);
      setVehicles(data.vehicles);
      setDrivers(data.drivers);
      setDevices(data.devices);
    } catch (err) {
      console.error('Error loading fleet data:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Metric computations
  const totalVehicles = vehicles.length;
  const equippedCount = vehicles.filter((v) => v.assigned_device_id).length;
  const assignedDriverCount = vehicles.filter((v) => v.assigned_driver_id).length;
  const activeDeviceCount = devices.filter((d) => d.active).length;

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
        subtitle="Commercial fleet assets, telematics pairings, and driver allocations"
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
              <span className="text-[11px] text-zinc-400 font-medium">Telematics Equipped</span>
              <Cpu size={14} className="text-emerald-400" />
            </div>
            <p className="text-xl font-bold font-mono text-emerald-400">
              {equippedCount} <span className="text-xs text-zinc-500 font-sans">/ {totalVehicles}</span>
            </p>
            <p className="text-zinc-500 text-[10px]">Active hardware units installed</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 font-medium">Assigned Drivers</span>
              <UserCheck size={14} className="text-blue-400" />
            </div>
            <p className="text-xl font-bold font-mono text-white">
              {assignedDriverCount} <span className="text-xs text-zinc-500 font-sans">/ {totalVehicles}</span>
            </p>
            <p className="text-zinc-500 text-[10px]">Allocated to registered operators</p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800 rounded-md p-3.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 font-medium">Active Devices</span>
              <Radio size={14} className="text-emerald-400" />
            </div>
            <p className="text-xl font-bold font-mono text-white">{activeDeviceCount}</p>
            <p className="text-zinc-500 text-[10px]">Ready for ingestion pipeline</p>
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
                <th className="p-3">Make & Model</th>
                <th className="p-3">Model Year</th>
                <th className="p-3">Assigned Hardware Unit</th>
                <th className="p-3">Assigned Driver</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 text-zinc-300">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-zinc-500 font-mono">
                    Loading commercial fleet registry...
                  </td>
                </tr>
              ) : filteredVehicles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-zinc-500 font-mono">
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

                      {/* Make & Model */}
                      <td className="p-3 text-zinc-300">
                        <span>{vehicle.make || 'Generic'} {vehicle.model || ''}</span>
                      </td>

                      {/* Year */}
                      <td className="p-3 font-mono text-zinc-400">
                        {vehicle.year ? vehicle.year : '—'}
                      </td>

                      {/* Installed Device */}
                      <td className="p-3 font-mono">
                        {vehicle.assigned_device_id ? (
                          <span className="px-1.5 py-0.5 rounded-sm bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 font-semibold text-[11px] flex items-center gap-1 w-fit">
                            <Cpu size={11} />
                            {vehicle.assigned_device_id}
                          </span>
                        ) : (
                          <span className="text-zinc-500 text-[11px]">Unbound</span>
                        )}
                      </td>

                      {/* Assigned Driver */}
                      <td className="p-3">
                        {vehicle.assigned_driver_name ? (
                          <span className="text-zinc-200 font-medium">
                            {vehicle.assigned_driver_name}
                          </span>
                        ) : (
                          <span className="text-zinc-500 text-[11px]">Unassigned</span>
                        )}
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
