/**
 * Trigger Event Selection Modal View
 */

import { ANSI } from '../ansi.js';
import { drawBox, formatCommandBar } from '../components.js';
import type { SimEventType } from '../../types.js';

export interface EventOption {
  type: SimEventType;
  label: string;
  description: string;
}

export const EVENT_OPTIONS: EventOption[] = [
  { type: 'rough_road', label: 'Rough road', description: 'Elevated vertical vibration & acoustic noise across road surface' },
  { type: 'hard_brake', label: 'Hard braking', description: 'Sudden longitudinal deceleration > 5.8 m/s²' },
  { type: 'hard_accel', label: 'Hard acceleration', description: 'Rapid throttle launch > 4.5 m/s²' },
  { type: 'sharp_turn', label: 'Sharp cornering', description: 'High angular yaw rate & lateral centripetal Gs' },
  { type: 'swerve', label: 'Slalom swerving', description: 'Rapid oscillating heading changes in traffic' },
  { type: 'impact', label: 'Impact / Pothole Spike', description: 'Severe vertical acceleration spike > 6.5 m/s² and mic peak' },
  { type: 'normal', label: 'Clear event (Normal drive)', description: 'Reset vehicle state to standard smooth driving' },
];

export function renderTriggerEvent(
  targetDriverId: string,
  selectedIndex: number,
  width = 68,
): string[] {
  const lines: string[] = [];

  lines.push(`Target Driver: ${ANSI.brightCyan}${ANSI.bold}${targetDriverId.toUpperCase()}${ANSI.reset}`);
  lines.push('');

  for (let i = 0; i < EVENT_OPTIONS.length; i++) {
    const opt = EVENT_OPTIONS[i]!;
    const isSelected = i === selectedIndex;
    const pointer = isSelected ? `${ANSI.brightCyan}▶ ` : '  ';
    const labelText = isSelected
      ? `${ANSI.brightWhite}${ANSI.bold}${opt.label.padEnd(28)}${ANSI.reset}`
      : `${ANSI.white}${opt.label.padEnd(28)}${ANSI.reset}`;

    lines.push(`${pointer}${labelText}`);
  }

  lines.push('');
  const selectedOpt = EVENT_OPTIONS[selectedIndex]!;
  lines.push(`${ANSI.dim}Description: ${selectedOpt.description}${ANSI.reset}`);
  lines.push('---');

  const commands = [
    { key: '↑ / ↓', label: 'Navigate' },
    { key: 'ENTER', label: 'Trigger Event' },
    { key: 'ESC', label: 'Cancel' },
  ];

  lines.push(formatCommandBar(commands, width));

  return drawBox(`TRIGGER EVENT — ${targetDriverId.toUpperCase()}`, lines, width, ANSI.magenta);
}
