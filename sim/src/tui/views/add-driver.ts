/**
 * Add Driver Interactive Screen View
 */

import { ANSI } from '../ansi.js';
import { drawBox, formatCommandBar } from '../components.js';
import { SRI_LANKA_PLACES } from '../../routing/places.js';

export interface AddDriverFormState {
  driverId: string;
  vehicleId: string;
  originIndex: number;
  destIndex: number;
  speedProfileIndex: number;
  activeField: 'driverId' | 'vehicleId' | 'origin' | 'dest' | 'profile' | 'submit';
  isRouting: boolean;
  statusMessage?: string;
}

export const SPEED_PROFILES = ['normal', 'aggressive', 'cautious', 'worst'] as const;

export function renderAddDriver(
  state: AddDriverFormState,
  width = 68,
): string[] {
  const lines: string[] = [];

  const originPlace = SRI_LANKA_PLACES[state.originIndex] || SRI_LANKA_PLACES[0]!;
  const destPlace = SRI_LANKA_PLACES[state.destIndex] || SRI_LANKA_PLACES[6]!;
  const speedProfile = SPEED_PROFILES[state.speedProfileIndex] || 'normal';

  function formatField(label: string, value: string, fieldName: AddDriverFormState['activeField']) {
    const isFocused = state.activeField === fieldName;
    const focusPrefix = isFocused ? `${ANSI.brightCyan}▶ ` : '  ';
    const valColor = isFocused ? `${ANSI.brightWhite}${ANSI.bold}` : ANSI.white;
    return `${focusPrefix}${label.padEnd(16)} [ ${valColor}${value}${ANSI.reset} ]`;
  }

  lines.push(formatField('Driver ID:', state.driverId, 'driverId'));
  lines.push(formatField('Vehicle ID:', state.vehicleId, 'vehicleId'));
  lines.push('');

  lines.push(
    formatField(
      'Origin:',
      `${originPlace.name} (${state.originIndex + 1}/${SRI_LANKA_PLACES.length})`,
      'origin',
    ),
  );
  lines.push(
    formatField(
      'Destination:',
      `${destPlace.name} (${state.destIndex + 1}/${SRI_LANKA_PLACES.length})`,
      'dest',
    ),
  );
  lines.push(
    formatField(
      'Speed Profile:',
      `${speedProfile.toUpperCase()} (${state.speedProfileIndex + 1}/${SPEED_PROFILES.length})`,
      'profile',
    ),
  );
  lines.push('');

  lines.push(`  Route Provider:  ${ANSI.cyan}Real OpenStreetMap via OSRM${ANSI.reset}`);

  if (state.isRouting) {
    lines.push(`  Status:          ${ANSI.brightYellow}Routing via OSRM... please wait${ANSI.reset}`);
  } else if (state.statusMessage) {
    lines.push(`  Status:          ${ANSI.green}${state.statusMessage}${ANSI.reset}`);
  } else {
    lines.push(`  Status:          ${ANSI.dim}Ready to create${ANSI.reset}`);
  }

  lines.push('');
  const isSubmitFocused = state.activeField === 'submit';
  const submitBtn = isSubmitFocused
    ? `${ANSI.bgCyan}${ANSI.bold}${ANSI.black}   [ CREATE DRIVER ]   ${ANSI.reset}`
    : `${ANSI.dim}   [ CREATE DRIVER ]   ${ANSI.reset}`;

  lines.push(`               ${submitBtn}`);
  lines.push('---');

  const commands = [
    { key: 'TAB / ↑↓', label: 'Switch Field' },
    { key: '← / →', label: 'Change Option' },
    { key: 'ENTER', label: 'Confirm & Create' },
    { key: 'ESC', label: 'Cancel' },
  ];

  lines.push(formatCommandBar(commands, width));

  return drawBox('ADD DRIVER WIZARD', lines, width, ANSI.cyan);
}
