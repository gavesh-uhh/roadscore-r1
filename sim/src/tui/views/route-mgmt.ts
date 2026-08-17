/**
 * Route Management & Cache Status View
 */

import { ANSI } from '../ansi.js';
import { drawBox, formatCommandBar } from '../components.js';
import { getAllCachedRoutes } from '../../routing/cache.js';

export function renderRouteManagement(
  selectedIndex: number,
  width = 72,
): string[] {
  const lines: string[] = [];
  const routes = getAllCachedRoutes();

  lines.push(`${ANSI.dim}Real OpenStreetMap Routes Cached in Memory & Pre-baked dataset:${ANSI.reset}`);
  lines.push('');

  for (let i = 0; i < routes.length; i++) {
    const r = routes[i]!;
    const isSelected = i === selectedIndex;
    const pointer = isSelected ? `${ANSI.brightCyan}▶ ` : '  ';
    const nameText = isSelected
      ? `${ANSI.brightWhite}${ANSI.bold}${r.name.padEnd(28)}${ANSI.reset}`
      : `${ANSI.white}${r.name.padEnd(28)}${ANSI.reset}`;

    const distKm = `${(r.totalDistanceM / 1000).toFixed(1)} km`.padEnd(10);
    const ptsCount = `${r.points.length} coords`;
    const cachedBadge = `${ANSI.green}CACHED${ANSI.reset}`;

    lines.push(`${pointer}${nameText} ${ANSI.cyan}${distKm}${ANSI.reset} ${ANSI.dim}${ptsCount.padEnd(14)}${ANSI.reset} ${cachedBadge}`);
  }

  lines.push('---');
  if (routes.length > 0) {
    const sel = routes[selectedIndex] || routes[0]!;
    lines.push(`${ANSI.bold}${ANSI.brightWhite}SELECTED ROUTE DETAILS${ANSI.reset}`);
    lines.push(`  Origin:      ${sel.originName} (${sel.origin.lat.toFixed(4)}, ${sel.origin.lon.toFixed(4)})`);
    lines.push(`  Destination: ${sel.destinationName} (${sel.destination.lat.toFixed(4)}, ${sel.destination.lon.toFixed(4)})`);
    lines.push(`  Distance:    ${(sel.totalDistanceM / 1000).toFixed(2)} km`);
    lines.push(`  Est. Time:   ${Math.round(sel.estimatedDurationS / 60)} minutes`);
  }
  lines.push('---');

  const commands = [
    { key: '↑ / ↓', label: 'Navigate Routes' },
    { key: 'ESC', label: 'Back to Dashboard' },
  ];

  lines.push(formatCommandBar(commands, width));

  return drawBox('ROUTE MANAGEMENT & CACHE', lines, width, ANSI.cyan);
}
