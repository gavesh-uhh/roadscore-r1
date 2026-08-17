/**
 * Full Event and System Log Viewer Screen
 */

import { ANSI } from '../ansi.js';
import { drawBox, formatCommandBar } from '../components.js';
import type { LogEntry } from '../../types.js';

export function renderLogViewer(
  logs: LogEntry[],
  scrollOffset = 0,
  maxDisplayLines = 14,
  width = 74,
): string[] {
  const lines: string[] = [];

  const visibleLogs = logs.slice(scrollOffset, scrollOffset + maxDisplayLines);

  lines.push(`${ANSI.bold}${ANSI.brightWhite}SYSTEM & TELEMETRY EVENT LOGS${ANSI.reset} ${ANSI.dim}(Showing ${visibleLogs.length} of ${logs.length} entries)${ANSI.reset}`);
  lines.push('');

  if (visibleLogs.length === 0) {
    lines.push(`  ${ANSI.dim}No logs recorded yet.${ANSI.reset}`);
  } else {
    for (const log of visibleLogs) {
      let lvlColor = ANSI.gray;
      if (log.level === 'event') lvlColor = ANSI.brightMagenta;
      if (log.level === 'warn') lvlColor = ANSI.yellow;
      if (log.level === 'error') lvlColor = ANSI.red;
      if (log.level === 'info') lvlColor = ANSI.brightCyan;

      const lvlTag = `[${log.level.toUpperCase()}]`.padEnd(9);
      lines.push(`  ${ANSI.dim}${log.timestamp}${ANSI.reset} ${lvlColor}${lvlTag}${ANSI.reset} ${log.message}`);
    }
  }

  // Pad to consistent height
  while (lines.length < maxDisplayLines + 2) {
    lines.push('');
  }

  lines.push('---');

  const commands = [
    { key: '↑ / ↓', label: 'Scroll' },
    { key: 'C', label: 'Clear Logs' },
    { key: 'ESC', label: 'Back to Dashboard' },
  ];

  lines.push(formatCommandBar(commands, width));

  return drawBox('SYSTEM LOGS', lines, width, ANSI.cyan);
}
