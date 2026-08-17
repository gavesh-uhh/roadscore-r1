/**
 * Driver Detail Screen View
 */

import { ANSI } from '../ansi.js';
import { drawBox, formatCommandBar, makeProgressBar } from '../components.js';
import type { DriverState } from '../../types.js';

export function renderDriverDetail(
  driver: DriverState,
  width = 68,
): string[] {
  const lines: string[] = [];

  const statusColor =
    driver.status === 'RUNNING'
      ? ANSI.green
      : driver.status === 'PAUSED'
        ? ANSI.yellow
        : ANSI.brightMagenta;

  lines.push(`Status:   ${statusColor}${ANSI.bold}${driver.status}${ANSI.reset}`);
  lines.push(`Vehicle:  ${ANSI.brightWhite}${driver.vehicleId}${ANSI.reset} (${driver.speedProfile} profile)`);
  lines.push(`Route:    ${ANSI.bold}${driver.route.name}${ANSI.reset}`);
  lines.push('');

  const speedStr = `${Math.round(driver.currentSpeedKmh)} km/h`;
  const headingStr = `${String(Math.round(driver.currentHeading)).padStart(3, '0')}°`;
  const posStr = `${driver.currentPosition.lat.toFixed(4)}, ${driver.currentPosition.lon.toFixed(4)}`;
  const progBar = makeProgressBar(driver.progressPercent, 14);

  lines.push(`Speed:        ${ANSI.brightCyan}${speedStr}${ANSI.reset}`);
  lines.push(`Heading:      ${ANSI.yellow}${headingStr}${ANSI.reset}`);
  lines.push(`Position:     ${ANSI.white}${posStr}${ANSI.reset}`);
  lines.push(`Progress:     ${progBar}`);
  lines.push(`Distance:     ${(driver.currentDistanceM / 1000).toFixed(1)} km / ${(driver.route.totalDistanceM / 1000).toFixed(1)} km`);
  lines.push('---');

  lines.push(`${ANSI.bold}${ANSI.brightWhite}TELEMETRY${ANSI.reset}`);
  const lastTel = driver.lastTelemetry;
  const accelG = lastTel ? (lastTel.horizontalPeakMps2 / 9.81).toFixed(2) : '0.00';
  const vibG = lastTel ? (lastTel.verticalAccelMps2 / 9.81).toFixed(2) : '0.00';
  const lastEventStr = driver.activeEvent
    ? `${ANSI.brightMagenta}${driver.activeEvent.label}${ANSI.reset}`
    : `${ANSI.dim}Normal driving${ANSI.reset}`;

  lines.push(`Acceleration: ${ANSI.brightWhite}${accelG} g${ANSI.reset} (${lastTel?.horizontalPeakMps2 || 0} m/s²)`);
  lines.push(`Vibration:    ${ANSI.brightWhite}${vibG} g${ANSI.reset} (${lastTel?.verticalAccelMps2 || 0} m/s²)`);
  lines.push(`Mic Energy:   ${ANSI.brightWhite}${lastTel?.micRms || 0}${ANSI.reset} RMS`);
  lines.push(`Last event:   ${lastEventStr}`);
  lines.push('---');

  lines.push(`${ANSI.bold}${ANSI.brightWhite}H3 SPATIAL CELL (res-12)${ANSI.reset}`);
  lines.push(`  ${ANSI.brightYellow}${ANSI.bold}${driver.currentH3Cell || 'Calculating...'}${ANSI.reset}`);
  lines.push('---');

  const commands = [
    { key: 'P', label: driver.isPaused ? 'Resume Driver' : 'Pause Driver' },
    { key: 'E', label: 'Trigger Event' },
    { key: 'ESC', label: 'Back to Dashboard' },
  ];

  lines.push(formatCommandBar(commands, width));

  return drawBox(`DRIVER DETAIL — ${driver.driverId.toUpperCase()}`, lines, width, ANSI.cyan);
}
