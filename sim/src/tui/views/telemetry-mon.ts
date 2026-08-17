/**
 * Live Telemetry & Event Stream Monitor View
 */

import { ANSI } from '../ansi.js';
import { drawBox, formatCommandBar } from '../components.js';
import type { DriverState, LogEntry } from '../../types.js';

export function renderTelemetryMonitor(
  drivers: DriverState[],
  logs: LogEntry[],
  width = 72,
): string[] {
  const lines: string[] = [];

  // 1. Table Header
  lines.push(
    `${ANSI.bold}${ANSI.brightWhite}${'DRIVER'.padEnd(8)} ${'SPEED'.padEnd(10)} ${'ACCEL'.padEnd(10)} ${'VIBRATION'.padEnd(12)} ${'H3 CELL (12)'.padEnd(18)} ${'STATUS'}${ANSI.reset}`,
  );
  lines.push(`${ANSI.dim}${'─'.repeat(width - 4)}${ANSI.reset}`);

  if (drivers.length === 0) {
    lines.push(`  ${ANSI.dim}No active telemetry streams.${ANSI.reset}`);
  } else {
    for (const d of drivers) {
      const idStr = d.driverId.slice(-6).padEnd(8);
      const speedStr = `${Math.round(d.currentSpeedKmh)} km/h`.padEnd(10);
      const accelG = d.lastTelemetry ? `${(d.lastTelemetry.horizontalPeakMps2 / 9.81).toFixed(2)}g` : '0.00g';
      const vibG = d.lastTelemetry ? `${(d.lastTelemetry.verticalAccelMps2 / 9.81).toFixed(2)}g` : '0.00g';
      const h3Str = (d.currentH3Cell || '-').padEnd(18);

      let statusColor = ANSI.green;
      if (d.status === 'PAUSED') statusColor = ANSI.yellow;
      if (d.status === 'EVENT') statusColor = ANSI.brightMagenta;

      lines.push(
        `${ANSI.bold}${idStr}${ANSI.reset} ${ANSI.cyan}${speedStr}${ANSI.reset} ${accelG.padEnd(10)} ${vibG.padEnd(12)} ${ANSI.yellow}${h3Str}${ANSI.reset} ${statusColor}${d.status}${ANSI.reset}`,
      );
    }
  }

  lines.push('---');

  // 2. Events Log Section
  lines.push(`${ANSI.bold}${ANSI.brightWhite}LIVE EVENT STREAM${ANSI.reset}`);
  const eventLogs = logs.filter((l) => l.level === 'event' || l.level === 'warn').slice(0, 8);
  if (eventLogs.length === 0) {
    lines.push(`  ${ANSI.dim}No recent telemetry events recorded.${ANSI.reset}`);
  } else {
    for (const log of eventLogs) {
      const lvlColor = log.level === 'event' ? ANSI.brightMagenta : ANSI.yellow;
      lines.push(`  ${ANSI.dim}${log.timestamp}${ANSI.reset}  ${lvlColor}${log.message}${ANSI.reset}`);
    }
  }

  lines.push('---');

  const commands = [
    { key: 'SPACE', label: 'Pause/Resume' },
    { key: 'E', label: 'Trigger Event' },
    { key: 'ESC', label: 'Back to Dashboard' },
  ];

  lines.push(formatCommandBar(commands, width));

  return drawBox('LIVE TELEMETRY MONITOR', lines, width, ANSI.cyan);
}
