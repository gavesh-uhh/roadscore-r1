/**
 * Predefined Demonstration Scenarios for RoadScore
 */

import type { ScenarioDefinition } from '../types.js';

export const PREDEFINED_SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'normal_fleet',
    name: 'Normal Fleet',
    description: '3 concurrent vehicles commuting on major Sri Lankan arterial corridors (Colombo, Kandy, Galle).',
    drivers: [
      {
        driverId: 'driver-01',
        vehicleId: 'ROADSCORE_001',
        origin: 'Colombo Fort',
        destination: 'Kandy (Dalada Maligawa)',
        speedProfile: 'normal',
      },
      {
        driverId: 'driver-02',
        vehicleId: 'DUMMY-001',
        origin: 'Galle Face Green',
        destination: 'Galle Fort',
        speedProfile: 'normal',
      },
      {
        driverId: 'driver-03',
        vehicleId: 'DUMMY-002',
        origin: 'Kandy (Dalada Maligawa)',
        destination: 'Colombo Fort',
        speedProfile: 'normal',
      },
    ],
  },
  {
    id: 'rough_road_discovery',
    name: 'Rough Road Discovery',
    description: 'Vehicles traversing rough urban sectors and pothole corridors, emitting high vibration and IMU spikes.',
    drivers: [
      {
        driverId: 'driver-01',
        vehicleId: 'ROADSCORE_001',
        origin: 'Colombo Fort',
        destination: 'Mount Lavinia',
        speedProfile: 'normal',
        initialEvents: [
          { triggerAfterDistanceM: 500, event: 'rough_road', magnitude: 3.6, durationS: 8 },
          { triggerAfterDistanceM: 1800, event: 'pothole', magnitude: 4.8, durationS: 3 },
          { triggerAfterDistanceM: 3200, event: 'rough_road', magnitude: 4.0, durationS: 12 },
        ],
      },
      {
        driverId: 'driver-02',
        vehicleId: 'DUMMY-001',
        origin: 'Battaramulla (Parliament)',
        destination: 'Colombo Fort',
        speedProfile: 'normal',
        initialEvents: [
          { triggerAfterDistanceM: 800, event: 'rough_road', magnitude: 3.5, durationS: 10 },
          { triggerAfterDistanceM: 2200, event: 'impact', magnitude: 6.2, durationS: 2 },
        ],
      },
    ],
  },
  {
    id: 'multiple_drivers',
    name: 'Multiple Drivers (10 Vehicles)',
    description: '10 concurrent vehicles operating independently across national inter-city expressways & highways.',
    drivers: [
      { driverId: 'driver-01', vehicleId: 'ROADSCORE_001', origin: 'Colombo Fort', destination: 'Kandy (Dalada Maligawa)', speedProfile: 'normal' },
      { driverId: 'driver-02', vehicleId: 'DUMMY-001', origin: 'Galle Face Green', destination: 'Galle Fort', speedProfile: 'normal' },
      { driverId: 'driver-03', vehicleId: 'DUMMY-002', origin: 'Kandy (Dalada Maligawa)', destination: 'Colombo Fort', speedProfile: 'normal' },
      { driverId: 'driver-04', vehicleId: 'DUMMY-003', origin: 'Colombo Fort', destination: 'Negombo Beach', speedProfile: 'normal' },
      { driverId: 'driver-05', vehicleId: 'DUMMY-004', origin: 'Galle Fort', destination: 'Matara City', speedProfile: 'normal' },
      { driverId: 'driver-06', vehicleId: 'DUMMY-005', origin: 'Colombo Fort', destination: 'Mount Lavinia', speedProfile: 'normal' },
      { driverId: 'driver-07', vehicleId: 'DUMMY-006', origin: 'Battaramulla (Parliament)', destination: 'Colombo Fort', speedProfile: 'normal' },
      { driverId: 'driver-08', vehicleId: 'DUMMY-007', origin: 'Colombo Fort', destination: 'Kurunegala Clock Tower', speedProfile: 'normal' },
      { driverId: 'driver-09', vehicleId: 'DUMMY-008', origin: 'Galle Fort', destination: 'Colombo Fort', speedProfile: 'normal' },
      { driverId: 'driver-10', vehicleId: 'DUMMY-009', origin: 'Negombo Beach', destination: 'Colombo Fort', speedProfile: 'normal' },
    ],
  },
  {
    id: 'hard_braking_event',
    name: 'Hard Braking & Aggressive Drive',
    description: 'Heavy traffic simulation with sudden brake slams, rapid accelerations, and sharp cornering maneuvers.',
    drivers: [
      {
        driverId: 'driver-01',
        vehicleId: 'ROADSCORE_001',
        origin: 'Colombo Fort',
        destination: 'Mount Lavinia',
        speedProfile: 'aggressive',
        initialEvents: [
          { triggerAfterDistanceM: 300, event: 'hard_accel', magnitude: 4.8, durationS: 3 },
          { triggerAfterDistanceM: 1200, event: 'hard_brake', magnitude: 6.2, durationS: 3 },
          { triggerAfterDistanceM: 2400, event: 'sharp_turn', magnitude: 25, durationS: 2 },
          { triggerAfterDistanceM: 3500, event: 'swerve', magnitude: 6.5, durationS: 4 },
        ],
      },
      {
        driverId: 'driver-02',
        vehicleId: 'DUMMY-001',
        origin: 'Galle Face Green',
        destination: 'Galle Fort',
        speedProfile: 'worst',
        initialEvents: [
          { triggerAfterDistanceM: 600, event: 'hard_brake', magnitude: 7.0, durationS: 3 },
          { triggerAfterDistanceM: 1900, event: 'swerve', magnitude: 6.8, durationS: 4 },
        ],
      },
    ],
  },
  {
    id: 'roadscore_coverage',
    name: 'RoadScore Coverage Demo',
    description: 'Dispersed regional fleet maximizing H3 resolution-12 grid indexing coverage across Sri Lanka.',
    drivers: [
      { driverId: 'driver-01', vehicleId: 'ROADSCORE_001', origin: 'Colombo Fort', destination: 'Kandy (Dalada Maligawa)', speedProfile: 'normal' },
      { driverId: 'driver-02', vehicleId: 'DUMMY-001', origin: 'Galle Face Green', destination: 'Galle Fort', speedProfile: 'normal' },
      { driverId: 'driver-03', vehicleId: 'DUMMY-002', origin: 'Colombo Fort', destination: 'Kurunegala Clock Tower', speedProfile: 'normal' },
      { driverId: 'driver-04', vehicleId: 'DUMMY-003', origin: 'Colombo Fort', destination: 'Negombo Beach', speedProfile: 'normal' },
      { driverId: 'driver-05', vehicleId: 'DUMMY-004', origin: 'Galle Fort', destination: 'Matara City', speedProfile: 'normal' },
    ],
  },
];
