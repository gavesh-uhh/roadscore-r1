/**
 * Reusable UI Components for Terminal Interface
 */

import { ANSI, padRightVisible, truncateVisible, visibleLength } from './ansi.js';

export function makeProgressBar(percent: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filledCount = Math.round((clamped / 100) * width);
  const emptyCount = width - filledCount;
  const bar = '█'.repeat(filledCount) + '░'.repeat(emptyCount);
  return `${ANSI.cyan}${bar}${ANSI.reset} ${String(clamped).padStart(2)}%`;
}

export function makeBadge(text: string, type: 'success' | 'warning' | 'error' | 'info' | 'dim'): string {
  switch (type) {
    case 'success':
      return `${ANSI.green}${ANSI.bold}● ${text}${ANSI.reset}`;
    case 'warning':
      return `${ANSI.yellow}${ANSI.bold}Ⅱ ${text}${ANSI.reset}`;
    case 'error':
      return `${ANSI.red}${ANSI.bold}✕ ${text}${ANSI.reset}`;
    case 'info':
      return `${ANSI.cyan}${ANSI.bold}⚡ ${text}${ANSI.reset}`;
    case 'dim':
    default:
      return `${ANSI.gray}○ ${text}${ANSI.reset}`;
  }
}

export function drawBox(
  title: string,
  lines: string[],
  width = 72,
  borderColor = ANSI.cyan,
): string[] {
  const output: string[] = [];
  const innerWidth = width - 4; // account for "│ " and " │"

  // 1. Top border
  const titleText = title ? ` ${title} ` : '';
  const titleVisibleLen = visibleLength(titleText);
  const remainingBorder = Math.max(0, width - 2 - titleVisibleLen);
  const leftBorder = Math.floor(remainingBorder / 2);
  const rightBorder = remainingBorder - leftBorder;

  output.push(
    `${borderColor}┌${'─'.repeat(leftBorder)}${ANSI.bold}${ANSI.brightWhite}${titleText}${ANSI.reset}${borderColor}${'─'.repeat(rightBorder)}┐${ANSI.reset}`,
  );

  // 2. Content lines
  for (const line of lines) {
    if (line === '---' || line === '__DIVIDER__') {
      output.push(`${borderColor}├${'─'.repeat(width - 2)}┤${ANSI.reset}`);
    } else {
      const truncated = truncateVisible(line, innerWidth);
      const padded = padRightVisible(truncated, innerWidth);
      output.push(`${borderColor}│${ANSI.reset} ${padded} ${borderColor}│${ANSI.reset}`);
    }
  }

  // 3. Bottom border
  output.push(`${borderColor}└${'─'.repeat(width - 2)}┘${ANSI.reset}`);

  return output;
}

export function formatCommandBar(
  commands: { key: string; label: string }[],
  width = 72,
): string {
  const parts = commands.map(
    (c) => `${ANSI.bold}${ANSI.brightYellow}[${c.key}]${ANSI.reset} ${ANSI.white}${c.label}${ANSI.reset}`,
  );
  return parts.join('   ');
}
