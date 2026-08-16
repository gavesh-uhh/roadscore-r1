export interface DriverRecord {
  id: string;
  name: string;
  licence_ref: string | null;
  created_at: string;
  // Computed / joined fields from active devices
  assigned_vehicle_id?: string | null;
  assigned_vehicle_plate?: string | null;
  assigned_device_id?: string | null;
}

export interface VehicleRecord {
  id: string;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  // Computed / joined fields from active devices
  assigned_driver_id?: string | null;
  assigned_driver_name?: string | null;
  assigned_device_id?: string | null;
  // Computed utilization metrics from public.trips
  total_distance_km?: number;
  total_trips?: number;
  active_trip_id?: string | null;
  is_active_moving?: boolean;
}

export interface DeviceRecord {
  device_id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  accel_fs_g: number;
  gyro_fs_dps: number;
  installed_at: string | null;
  active: boolean;
  // Computed / joined fields
  vehicle_plate?: string | null;
  driver_name?: string | null;
}

export interface CreateDriverInput {
  name: string;
  licence_ref?: string | null;
  assign_vehicle_id?: string;
}

export interface UpdateDriverInput {
  name?: string;
  licence_ref?: string | null;
  assign_vehicle_id?: string;
}

export interface CreateVehicleInput {
  plate: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  assign_driver_id?: string;
  assign_device_id?: string;
}

export interface UpdateVehicleInput {
  plate?: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  assign_driver_id?: string;
  assign_device_id?: string;
}

export interface CreateDeviceInput {
  device_id: string;
  accel_fs_g?: number;
  gyro_fs_dps?: number;
  active?: boolean;
  vehicle_id?: string;
  driver_id?: string;
}

export interface UpdateDeviceInput {
  accel_fs_g?: number;
  gyro_fs_dps?: number;
  active?: boolean;
  vehicle_id?: string | null;
  driver_id?: string | null;
}
