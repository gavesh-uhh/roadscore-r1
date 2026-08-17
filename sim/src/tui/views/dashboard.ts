/**
 * Main Presentation Dashboard View
 */

import { ANSI } from '../ansi.js';
import { drawBox, formatCommandBar, makeBadge, makeProgressBar } from '../components.js';
import type { DriverState, SimulatorStats } from '../../types.js';

export function renderDashboard(
  stats: SimulatorStats,
  drivers: DriverState[],
  selectedIndex: number,
  logs: { timestamp: string; level: string; message: string }[],
  width = 74,
): string[] {
  const lines: string[] = [];

  // 1. Status Header
  const statusBadge = stats.isPaused
    ? makeBadge('PAUSED', 'warning')
    : makeBadge('RUNNING', 'success');

  const routingBadge =
    stats.routingStatus === 'OK' || stats.routingStatus === 'CACHED'
      ? `${ANSI.green}${ANSI.bold}OK${ANSI.reset}`
      : `${ANSI.red}${ANSI.bold}OFFLINE${ANSI.reset}`;

  const supabaseBadge =
    stats.supabaseStatus === 'OK'
      ? `${ANSI.green}${ANSI.bold}OK${ANSI.reset}`
      : stats.supabaseStatus === 'SENDING'
        ? `${ANSI.cyan}${ANSI.bold}SENDING${ANSI.reset}`
        : `${ANSI.yellow}${ANSI.bold}OFFLINE${ANSI.reset}`;

  const speedBadge = `${ANSI.brightYellow}${ANSI.bold}${stats.simSpeedMultiplier}x${ANSI.reset}`;

  lines.push(
    `STATUS: ${statusBadge}     ROUTING: ${routingBadge}    SUPABASE: ${supabaseBadge}    SPEED: ${speedBadge}`,
  );
  lines.push('---');

  // 2. Drivers Section
  lines.push(`${ANSI.bold}${ANSI.brightWhite}DRIVERS${ANSI.reset}`);
  lines.push('');

  if (drivers.length === 0) {
    lines.push(`  ${ANSI.dim}No drivers active. Press [A] to add a driver or [S] for scenarios.${ANSI.reset}`);
  } else {
    for (let i = 0; i < drivers.length; i++) {
      const d = drivers[i]!;
      const isSelected = i === selectedIndex;
      const selector = isSelected ? `${ANSI.brightCyan}▶${ANSI.reset}` : ' ';

      let statusIcon = '●';
      let statusColor = ANSI.green;
      if (d.status === 'PAUSED') {
        statusIcon = 'Ⅱ';
        statusColor = ANSI.yellow;
      } else if (d.status === 'EVENT') {
        statusIcon = '⚡';
        statusColor = ANSI.brightMagenta;
      } else if (d.status === 'COMPLETED') {
        statusIcon = '✓';
        statusColor = ANSI.blue;
      }

      const idStr = String(i + 1).padStart(2, '0');
      const routeStr = d.route.name.padEnd(23);
      const speedStr = `${String(Math.round(d.currentSpeedKmh)).padStart(2)} km/h`;
      const progStr = makeProgressBar(d.progressPercent, 8);
      const statusStr = `${statusColor}${d.status.padEnd(8)}${ANSI.reset}`;

      lines.push(
        `${selector} ${statusColor}${statusIcon}${ANSI.reset} ${ANSI.bold}${idStr}${ANSI.reset}  ${routeStr} ${speedStr}   ${progStr}   ${statusStr}`,
      );
    }
  }

  lines.push('---');

  // 3. Telemetry Stats Section
  lines.push(`${ANSI.bold}${ANSI.brightWhite}TELEMETRY & H3 STATS${ANSI.reset}`);
  lines.push(
    `  Points sent:         ${ANSI.brightCyan}${stats.pointsSent.toLocaleString()}${ANSI.reset}         Active vehicles:     ${ANSI.brightGreen}${stats.activeVehicles}${ANSI.reset} / ${stats.totalVehicles}`,
  );
  lines.push(
    `  H3 cells observed:   ${ANSI.brightYellow}${stats.h3CellsObserved.size.toLocaleString()}${ANSI.reset} (res-12)     Events triggered:    ${ANSI.brightMagenta}${stats.eventsTriggered}${ANSI.reset}`,
  );

  lines.push('---');

  // 4. Recent Activity Log Snippet (last 3 items)
  lines.push(`${ANSI.bold}${ANSI.brightWhite}RECENT ACTIVITY${ANSI.reset}`);
  const recentLogs = logs.slice(0, 3);
  if (recentLogs.length === 0) {
    lines.push(`  ${ANSI.dim}Simulation running normally.${ANSI.reset}`);
  } else {
    for (const log of recentLogs) {
      let lvlColor = ANSI.gray;
      if (log.level === 'event') lvlColor = ANSI.brightMagenta;
      if (log.level === 'warn') lvlColor = ANSI.yellow;
      if (log.level === 'error') lvlColor = ANSI.red;
      lines.push(`  ${ANSI.dim}[${log.timestamp}]${ANSI.reset} ${lvlColor}${log.message}${ANSI.reset}`);
    }
  }

  lines.push('---');

  // 5. Command Bar
  const commands = [
    { key: 'SPACE', label: stats.isPaused ? 'Resume' : 'Pause' },
    { key: 'A', label: 'Add Driver' },
    { key: 'D', label: 'Drivers' },
    { key: 'R', label: 'Routes' },
    { key: 'S', label: 'Scenario' },
    { key: 'E', label: 'Event' },
    { key: 'T', label: 'Telemetry' },
    { key: 'L', label: 'Logs' },
    { key: '+/-', label: 'Speed' },
    { key: 'Q', label: 'Quit' },
  ];

  lines.push(formatCommandBar(commands, width));

  return drawBox('ROAD SCORE SIMULATOR', lines, width, ANSI.cyan);
}
