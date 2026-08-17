'use client';

/**
 * Shared hazard presentation metadata (DRIVER_VIEW_UI_POLISH_PLAN P2-4):
 * one source of truth for hazard colors/labels across the radar canvas,
 * NextHazardBar, TripMap, and Simulation Studio.
 */

import React from 'react';
import {
  CircleDot,
  Waves,
  CornerUpRight,
  Droplets,
  CarFront,
} from 'lucide-react';
import type { HazardKind, HazardSeverity } from '@/lib/sim/demoSimulator';

export const HAZARD_COLOR: Record<HazardKind, string> = {
  pothole: '#f43f5e',
  speed_bump: '#f59e0b',
  sharp_curve: '#a78bfa',
  water_pooling: '#38bdf8',
  traffic_queue: '#10b981',
};

export const HAZARD_GLYPH: Record<HazardKind, string> = {
  pothole: '⚠️',
  speed_bump: '〰️',
  sharp_curve: '↪️',
  water_pooling: '🌊',
  traffic_queue: '🚗',
};

export const HAZARD_ICON: Record<
  HazardKind,
  React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>
> = {
  pothole: CircleDot,
  speed_bump: Waves,
  sharp_curve: CornerUpRight,
  water_pooling: Droplets,
  traffic_queue: CarFront,
};

export const HAZARD_SHORT: Record<HazardKind, string> = {
  pothole: 'Pothole',
  speed_bump: 'Speed Bump',
  sharp_curve: 'Hairpin',
  water_pooling: 'Water',
  traffic_queue: 'Queue',
};

export function severityBorderClass(sev: HazardSeverity): string {
  switch (sev) {
    case 'critical':
    case 'high':
      return 'border-rose-500/70';
    case 'medium':
      return 'border-amber-500/60';
    case 'low':
      return 'border-sky-500/50';
    default:
      return 'border-emerald-600/50';
  }
}

export function severityTextClass(sev: HazardSeverity): string {
  switch (sev) {
    case 'critical':
    case 'high':
      return 'text-rose-300';
    case 'medium':
      return 'text-amber-300';
    case 'low':
      return 'text-sky-300';
    default:
      return 'text-emerald-300';
  }
}

export function severityBadgeClass(sev: HazardSeverity): string {
  switch (sev) {
    case 'critical':
    case 'high':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    case 'medium':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'low':
      return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
    default:
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  }
}
