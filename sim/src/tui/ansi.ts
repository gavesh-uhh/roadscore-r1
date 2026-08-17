/**
 * Terminal ANSI Styling & Cursor Controls
 */

export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  bgDarkGray: '\x1b[100m',

  // Cursor & Screen controls
  clearScreen: '\x1b[2J',
  clearLine: '\x1b[2K',
  cursorHome: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  enterAltScreen: '\x1b[?1049h',
  exitAltScreen: '\x1b[?1049l',
};

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

export function padRightVisible(str: string, targetLength: number): string {
  const visLen = visibleLength(str);
  if (visLen >= targetLength) return str;
  return str + ' '.repeat(targetLength - visLen);
}

export function padLeftVisible(str: string, targetLength: number): string {
  const visLen = visibleLength(str);
  if (visLen >= targetLength) return str;
  return ' '.repeat(targetLength - visLen) + str;
}

export function truncateVisible(str: string, maxLength: number): string {
  if (visibleLength(str) <= maxLength) return str;
  const stripped = stripAnsi(str);
  return stripped.slice(0, Math.max(0, maxLength - 1)) + '…';
}
