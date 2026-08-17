/**
 * Scenario Selection Modal View
 */

import { ANSI } from '../ansi.js';
import { drawBox, formatCommandBar } from '../components.js';
import { PREDEFINED_SCENARIOS } from '../../core/scenarios.js';

export function renderScenarios(
  selectedIndex: number,
  width = 68,
): string[] {
  const lines: string[] = [];

  lines.push(`${ANSI.dim}Select a predefined demonstration scenario to configure the fleet:${ANSI.reset}`);
  lines.push('');

  for (let i = 0; i < PREDEFINED_SCENARIOS.length; i++) {
    const sc = PREDEFINED_SCENARIOS[i]!;
    const isSelected = i === selectedIndex;
    const pointer = isSelected ? `${ANSI.brightCyan}▶ ` : '  ';
    const nameText = isSelected
      ? `${ANSI.brightWhite}${ANSI.bold}${sc.name}${ANSI.reset}`
      : `${ANSI.white}${sc.name}${ANSI.reset}`;

    lines.push(`${pointer}${nameText}`);
  }

  lines.push('');
  const selectedSc = PREDEFINED_SCENARIOS[selectedIndex]!;
  lines.push(`${ANSI.cyan}${ANSI.bold}Description:${ANSI.reset}`);
  lines.push(`  ${selectedSc.description}`);
  lines.push(`  ${ANSI.dim}Fleet Size: ${selectedSc.drivers.length} vehicle(s)${ANSI.reset}`);
  lines.push('---');

  const commands = [
    { key: '↑ / ↓', label: 'Navigate' },
    { key: 'ENTER', label: 'Start Scenario' },
    { key: 'ESC', label: 'Cancel' },
  ];

  lines.push(formatCommandBar(commands, width));

  return drawBox('SCENARIO SELECTOR', lines, width, ANSI.cyan);
}
