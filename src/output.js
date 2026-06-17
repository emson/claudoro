/**
 * M6: TTY-aware output rendering.
 * One renderer: color + structure on a TTY, clean plain text when captured (D-008).
 * Honor NO_COLOR and CLAUDORO_COLOR=auto|always|never (default auto).
 *
 * Reuses the same icon/color/palette as the status-line segment (D-006 #3 unified visual language).
 */
import { stdout } from 'node:process';

// ---------------------------------------------------------------------------
// TTY and color detection
// ---------------------------------------------------------------------------

export const isTTY = () => stdout.isTTY === true;

export const colorMode = () => {
  const c = process.env.CLAUDORO_COLOR ?? 'auto';
  if (c === 'always') return true;
  if (c === 'never') return false;
  return isTTY() && process.env.NO_COLOR === undefined;
};

// ---------------------------------------------------------------------------
// ANSI helpers (no-op when color is off)
// ---------------------------------------------------------------------------

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  tomato: '\x1b[38;5;203m', // 256-color tomato red for focus
  coffee: '\x1b[38;5;178m', // amber for breaks
  teal: '\x1b[38;5;73m', // teal for long break
};

const wrap = (code, text) => (colorMode() ? `${code}${text}${C.reset}` : text);

export const dim = (t) => wrap(C.dim, t);
export const bold = (t) => wrap(C.bold, t);
export const red = (t) => wrap(C.red, t);
export const green = (t) => wrap(C.green, t);
export const yellow = (t) => wrap(C.yellow, t);
export const cyan = (t) => wrap(C.cyan, t);
export const tomato = (t) => wrap(C.tomato, t);
export const amber = (t) => wrap(C.coffee, t);
export const teal = (t) => wrap(C.teal, t);

// ---------------------------------------------------------------------------
// Phase icons (emoji with ASCII fallback for non-UTF8 terminals)
// ---------------------------------------------------------------------------

const supportsEmoji = () => process.env.TERM !== 'dumb' && isTTY();

export const ICONS = {
  focus: () => (supportsEmoji() ? '🍅' : '[F]'),
  short_break: () => (supportsEmoji() ? '☕' : '[S]'),
  long_break: () => (supportsEmoji() ? '🌴' : '[L]'),
  paused: () => (supportsEmoji() ? '⏸' : '||'),
};

// ---------------------------------------------------------------------------
// Help rendering (M6)
// ---------------------------------------------------------------------------

const COLUMNS = () => (process.env.COLUMNS ? parseInt(process.env.COLUMNS, 10) : 80);

const row = (left, right, width = COLUMNS()) => {
  const gap = Math.max(2, width - left.length - right.length);
  return `  ${left}${' '.repeat(gap)}${right}`;
};

/** Render the full help page. Pure: returns a string, does not print. */
export const renderHelp = (topic = null, prefs = {}) => {
  if (topic) return renderCommandHelp(topic, prefs);

  const title = bold(tomato('Claudoro')) + dim(' — Pomodoro timer for Claude Code');
  const sections = [
    title,
    '',
    bold('CONTROL'),
    row('  start [mins] [-w -s -l -f] [-t label]', 'begin a focus block'),
    row('  pause / resume / stop', 'control the running block'),
    row('  skip', 'finish current phase early, advance'),
    row('  reset', 'restart current phase, keep cycle'),
    row('  next', 'advance a waiting boundary'),
    row('  back', 'undo last transition (short window)'),
    row('  extend [N]', 'add N minutes to current phase'),
    '',
    bold('CONFIG'),
    row(
      `  mode [auto|balanced|manual]`,
      `transition mode (current: ${dim(prefs.mode ?? 'auto')})`,
    ),
    row(
      `  view [minimal|classic|full]`,
      `status-line layout (current: ${dim(prefs.view ?? 'classic')})`,
    ),
    row('  label "text"', 'set session label'),
    row('  mute / unmute', 'toggle sound'),
    '',
    bold('LOG & DATA'),
    row('  status [--json]', 'rich current status'),
    row('  log [--today] [--date YYYY-MM-DD]', 'show history'),
    row('  log open', "open today's log in $EDITOR"),
    row('  log backups', 'list available backups'),
    row('  undo [N] [--dry-run] [--yes]', 'remove last N completed records'),
    row('  restore [backup-id]', 'restore from a backup'),
    '',
    bold('SETUP'),
    row('  setup', 'wire Claude Code (command file, statusLine, hooks)'),
    row('  uninstall', 'reverse setup, remove all Claudoro wiring'),
    row('  help [command]', 'this help, or per-command detail'),
    '',
    dim(`State: ${process.env.XDG_STATE_HOME ?? '~/.local/state'}/claudoro/`),
    dim('Docs:  https://github.com/benemson/claudoro'),
  ];

  return sections.join('\n');
};

const renderCommandHelp = (topic, _prefs) => {
  // TODO: M6 — per-verb help with examples
  return `No detailed help for '${topic}' yet. Run ${bold('pomo help')} for all commands.`;
};

// ---------------------------------------------------------------------------
// Status output
// ---------------------------------------------------------------------------

/** Render /pomo status detail into the conversation. Returns a string. */
export const renderStatus = (state, aggregates, prefs) => {
  // TODO: M6 — rich multi-line status block
  return JSON.stringify({ state, aggregates, prefs }, null, 2);
};

/** Format output for --json flag. Always plain JSON, no ANSI. */
export const renderJson = (data) => JSON.stringify(data, null, 2);
