import { SupabaseClient } from '@supabase/supabase-js';
import {
  DriverRecord,
  VehicleRecord,
  DeviceRecord,
  CreateDriverInput,
  UpdateDriverInput,
  CreateVehicleInput,
  UpdateVehicleInput,
  CreateDeviceInput,
  UpdateDeviceInput,
} from './types';

/**
 * Fetch all drivers, vehicles, and devices with joined assignment metadata.
 * Strictly queries canonical tables: public.drivers, public.vehicles, public.devices.
 */
export async function getFleetData(supabase: SupabaseClient) {
  const [driversRes, vehiclesRes, devicesRes] = await Promise.all([
    supabase.from('drivers').select('*').order('created_at', { ascending: false }),
    supabase.from('vehicles').select('*').order('plate', { ascending: true }),
    supabase.from('devices').select('*').order('device_id', { ascending: true }),
  ]);

  const rawDrivers = driversRes.data || [];
  const rawVehicles = vehiclesRes.data || [];
  const rawDevices = devicesRes.data || [];

  // Build lookups
  const vehicleMap = new Map<string, any>();
  rawVehicles.forEach((v) => vehicleMap.set(v.id, v));

  const driverMap = new Map<string, any>();
  rawDrivers.forEach((d) => driverMap.set(d.id, d));

  const deviceMapByVehicle = new Map<string, any>();
  const deviceMapByDriver = new Map<string, any>();
  rawDevices.forEach((d) => {
    if (d.vehicle_id) deviceMapByVehicle.set(d.vehicle_id, d);
    if (d.driver_id) deviceMapByDriver.set(d.driver_id, d);
  });

  const drivers: DriverRecord[] = rawDrivers.map((d: any) => {
    const dev = deviceMapByDriver.get(d.id);
    const v = dev?.vehicle_id ? vehicleMap.get(dev.vehicle_id) : null;
    return {
      id: d.id,
      name: d.name,
      licence_ref: d.licence_ref ?? null,
      created_at: d.created_at,
      assigned_vehicle_id: v?.id ?? null,
      assigned_vehicle_plate: v?.plate ?? null,
      assigned_device_id: dev?.device_id ?? null,
    };
  });

  const vehicles: VehicleRecord[] = rawVehicles.map((v: any) => {
    const dev = deviceMapByVehicle.get(v.id);
    const d = dev?.driver_id ? driverMap.get(dev.driver_id) : null;
    return {
      id: v.id,
      plate: v.plate ?? null,
      make: v.make ?? null,
      model: v.model ?? null,
      year: v.year ?? null,
      assigned_driver_id: d?.id ?? null,
      assigned_driver_name: d?.name ?? null,
      assigned_device_id: dev?.device_id ?? null,
    };
  });

  const devices: DeviceRecord[] = rawDevices.map((dev: any) => {
    const v = dev.vehicle_id ? vehicleMap.get(dev.vehicle_id) : null;
    const d = dev.driver_id ? driverMap.get(dev.driver_id) : null;
    return {
      device_id: dev.device_id,
      vehicle_id: dev.vehicle_id ?? null,
      driver_id: dev.driver_id ?? null,
      accel_fs_g: Number(dev.accel_fs_g ?? 2),
      gyro_fs_dps: Number(dev.gyro_fs_dps ?? 250),
      installed_at: dev.installed_at ?? null,
      active: Boolean(dev.active ?? true),
      vehicle_plate: v?.plate ?? null,
      driver_name: d?.name ?? null,
    };
  });

  return { drivers, vehicles, devices };
}

/**
 * DRIVERS CRUD
 * Table: public.drivers (id uuid, name text not null, licence_ref text, created_at timestamptz)
 */
export async function createDriver(supabase: SupabaseClient, input: CreateDriverInput) {
  const insertPayload = {
    name: input.name.trim(),
    licence_ref: input.licence_ref ? input.licence_ref.trim() : null,
  };

  const { data, error } = await supabase.from('drivers').insert([insertPayload]).select().single();
  if (error) throw error;

  // Handle vehicle assignment if specified
  if (input.assign_vehicle_id && data?.id) {
    await assignVehicleToDriver(supabase, input.assign_vehicle_id, data.id);
  }

  return data;
}

export async function updateDriver(supabase: SupabaseClient, id: string, input: UpdateDriverInput) {
  const updatePayload: Record<string, any> = {};
  if (input.name !== undefined) updatePayload.name = input.name.trim();
  if (input.licence_ref !== undefined) updatePayload.licence_ref = input.licence_ref ? input.licence_ref.trim() : null;

  if (Object.keys(updatePayload).length > 0) {
    const { data, error } = await supabase.from('drivers').update(updatePayload).eq('id', id).select().single();
    if (error) throw error;
  }

  if (input.assign_vehicle_id !== undefined) {
    if (input.assign_vehicle_id) {
      await assignVehicleToDriver(supabase, input.assign_vehicle_id, id);
    } else {
      await unassignDriver(supabase, id);
    }
  }

  return true;
}

export async function deleteDriver(supabase: SupabaseClient, id: string) {
  // Clear FK in devices first
  await supabase.from('devices').update({ driver_id: null }).eq('driver_id', id);
  const { error } = await supabase.from('drivers').delete().eq('id', id);
  if (error) throw error;
  return true;
}

/**
 * VEHICLES CRUD
 * Table: public.vehicles (id uuid, plate text unique, make text, model text, year int)
 */
export async function createVehicle(supabase: SupabaseClient, input: CreateVehicleInput) {
  const insertPayload = {
    plate: input.plate.trim().toUpperCase(),
    make: input.make ? input.make.trim() : null,
    model: input.model ? input.model.trim() : null,
    year: input.year ? Number(input.year) : null,
  };

  const { data, error } = await supabase.from('vehicles').insert([insertPayload]).select().single();
  if (error) throw error;

  if (input.assign_device_id && data?.id) {
    await assignDeviceToVehicle(supabase, input.assign_device_id, data.id, input.assign_driver_id);
  } else if (input.assign_driver_id && data?.id) {
    await assignVehicleToDriver(supabase, data.id, input.assign_driver_id);
  }

  return data;
}

export async function updateVehicle(supabase: SupabaseClient, id: string, input: UpdateVehicleInput) {
  const updatePayload: Record<string, any> = {};
  if (input.plate !== undefined) updatePayload.plate = input.plate.trim().toUpperCase();
  if (input.make !== undefined) updatePayload.make = input.make ? input.make.trim() : null;
  if (input.model !== undefined) updatePayload.model = input.model ? input.model.trim() : null;
  if (input.year !== undefined) updatePayload.year = input.year ? Number(input.year) : null;

  if (Object.keys(updatePayload).length > 0) {
    const { data, error } = await supabase.from('vehicles').update(updatePayload).eq('id', id).select().single();
    if (error) throw error;
  }

  if (input.assign_device_id !== undefined) {
    if (input.assign_device_id) {
      await assignDeviceToVehicle(supabase, input.assign_device_id, id, input.assign_driver_id);
    } else {
      await unassignDeviceFromVehicle(supabase, id);
    }
  } else if (input.assign_driver_id !== undefined) {
    if (input.assign_driver_id) {
      await assignVehicleToDriver(supabase, id, input.assign_driver_id);
    } else {
      await supabase.from('devices').update({ driver_id: null }).eq('vehicle_id', id);
    }
  }

  return true;
}

export async function deleteVehicle(supabase: SupabaseClient, id: string) {
  // Clear FK in devices first
  await supabase.from('devices').update({ vehicle_id: null, driver_id: null }).eq('vehicle_id', id);
  const { error } = await supabase.from('vehicles').delete().eq('id', id);
  if (error) throw error;
  return true;
}

/**
 * DEVICES CRUD & PROVISIONING
 * Table: public.devices (device_id text PK, vehicle_id uuid FK, driver_id uuid FK, accel_fs_g numeric, gyro_fs_dps numeric, installed_at timestamptz, active bool)
 */
export async function createDevice(supabase: SupabaseClient, input: CreateDeviceInput) {
  const deviceId = input.device_id.trim();

  // Enforce 1-to-1: unlink any prior device on this vehicle
  if (input.vehicle_id) {
    await supabase.from('devices').update({ vehicle_id: null }).eq('vehicle_id', input.vehicle_id);
  }

  const insertPayload = {
    device_id: deviceId,
    accel_fs_g: input.accel_fs_g ? Number(input.accel_fs_g) : 2,
    gyro_fs_dps: input.gyro_fs_dps ? Number(input.gyro_fs_dps) : 250,
    active: input.active !== undefined ? input.active : true,
    installed_at: new Date().toISOString(),
    vehicle_id: input.vehicle_id || null,
    driver_id: input.driver_id || null,
  };

  const { data, error } = await supabase.from('devices').insert([insertPayload]).select().single();
  if (error) throw error;
  return data;
}

export async function updateDevice(supabase: SupabaseClient, deviceId: string, input: UpdateDeviceInput) {
  const updatePayload: Record<string, any> = {};
  if (input.accel_fs_g !== undefined) updatePayload.accel_fs_g = Number(input.accel_fs_g);
  if (input.gyro_fs_dps !== undefined) updatePayload.gyro_fs_dps = Number(input.gyro_fs_dps);
  if (input.active !== undefined) updatePayload.active = input.active;

  if (input.vehicle_id !== undefined) {
    if (input.vehicle_id) {
      // Unlink any other device on this vehicle
      await supabase.from('devices').update({ vehicle_id: null }).eq('vehicle_id', input.vehicle_id).neq('device_id', deviceId);
      updatePayload.vehicle_id = input.vehicle_id;
    } else {
      updatePayload.vehicle_id = null;
    }
  }

  if (input.driver_id !== undefined) {
    updatePayload.driver_id = input.driver_id || null;
  }

  const { data, error } = await supabase.from('devices').update(updatePayload).eq('device_id', deviceId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteDevice(supabase: SupabaseClient, deviceId: string) {
  const { error } = await supabase.from('devices').delete().eq('device_id', deviceId);
  if (error) throw error;
  return true;
}

/**
 * ATOMIC ASSIGNMENT ACTIONS (1-to-1 Device-Vehicle-Driver Bridge)
 */
export async function assignDeviceToVehicle(
  supabase: SupabaseClient,
  deviceId: string,
  vehicleId: string,
  driverId?: string | null
) {
  // 1. Unlink other device currently on this vehicle
  await supabase.from('devices').update({ vehicle_id: null }).eq('vehicle_id', vehicleId).neq('device_id', deviceId);

  // 2. Attach target device to this vehicle
  const updatePayload: Record<string, any> = {
    vehicle_id: vehicleId,
    installed_at: new Date().toISOString(),
  };
  if (driverId !== undefined) {
    updatePayload.driver_id = driverId || null;
  }

  const { data, error } = await supabase.from('devices').update(updatePayload).eq('device_id', deviceId).select().single();
  if (error) throw error;
  return data;
}

export async function assignVehicleToDriver(
  supabase: SupabaseClient,
  vehicleId: string,
  driverId: string
) {
  // Find device attached to this vehicle
  const { data: dev } = await supabase.from('devices').select('device_id').eq('vehicle_id', vehicleId).maybeSingle();

  if (dev?.device_id) {
    await supabase.from('devices').update({ driver_id: null }).eq('driver_id', driverId).neq('device_id', dev.device_id);
    await supabase.from('devices').update({ driver_id: driverId }).eq('device_id', dev.device_id);
  } else {
    // If vehicle has no device yet, check if driver has a device and bind it
    const { data: driverDev } = await supabase.from('devices').select('device_id').eq('driver_id', driverId).maybeSingle();
    if (driverDev?.device_id) {
      await assignDeviceToVehicle(supabase, driverDev.device_id, vehicleId, driverId);
    }
  }
}

export async function unassignDeviceFromVehicle(supabase: SupabaseClient, vehicleId: string) {
  const { error } = await supabase.from('devices').update({ vehicle_id: null, driver_id: null }).eq('vehicle_id', vehicleId);
  if (error) throw error;
  return true;
}

export async function unassignDriver(supabase: SupabaseClient, driverId: string) {
  const { error } = await supabase.from('devices').update({ driver_id: null }).eq('driver_id', driverId);
  if (error) throw error;
  return true;
}
