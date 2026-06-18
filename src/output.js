/**
 * M6: TTY-aware output rendering.
 * One renderer: color + structure on a TTY, clean plain text when captured (D-008).
 * Honor NO_COLOR and CLAUDORO_COLOR=auto|always|never (default auto).
 *
 * Reuses the same icon/color/palette as the status-line segment (D-006 #3 unified visual language).
 */
import { stdout } from 'node:process';
import {
  remaining,
  formatMMSS,
  isOvertime,
  overtimeSec,
  progressFraction,
  nowEpoch,
} from './derive.js';

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

// Color decision for the STATUS-LINE segment. Unlike colorMode() it does NOT
// require a TTY: Claude Code captures the segment's stdout (so `isTTY()` is
// false there) yet the host terminal renders ANSI fine — the same reason
// supportsEmoji()/supportsLinks() bypass the TTY check. Gating segment color on
// colorMode() meant it was silently never colored. Honor NO_COLOR and
// CLAUDORO_COLOR (=never forces plain, =always forces on).
export const segmentColorMode = () => {
  const c = process.env.CLAUDORO_COLOR ?? 'auto';
  if (c === 'always') return true;
  if (c === 'never') return false;
  return process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';
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
  grass: '\x1b[38;5;71m', // 256-color green for the resting progress bar
};

// Build a palette of color functions gated on a chosen mode predicate, so the
// same ANSI codes serve two render contexts with opposite needs when stdout is
// piped: CLI output (help/status/log) must be plain when captured (colorMode,
// TTY-gated, D-008); the status-line segment must color whenever the terminal
// can render it (segmentColorMode, TERM-gated).
const makePalette = (on) => {
  const w = (code) => (t) => (on() ? `${code}${t}${C.reset}` : t);
  return {
    dim: w(C.dim),
    bold: w(C.bold),
    red: w(C.red),
    green: w(C.green),
    yellow: w(C.yellow),
    cyan: w(C.cyan),
    tomato: w(C.tomato),
    amber: w(C.coffee),
    teal: w(C.teal),
    grass: w(C.grass),
  };
};

// CLI palette (TTY-gated). Individually exported to preserve existing call sites.
const cli = makePalette(colorMode);
export const dim = cli.dim;
export const bold = cli.bold;
export const red = cli.red;
export const green = cli.green;
export const yellow = cli.yellow;
export const cyan = cli.cyan;
export const tomato = cli.tomato;
export const amber = cli.amber;
export const teal = cli.teal;
export const grass = cli.grass;

// Status-line palette (TERM-gated): used by the segment renderer (D-006 colors).
export const seg = makePalette(segmentColorMode);

// ---------------------------------------------------------------------------
// OSC 8 hyperlinks (click targets on the status line, D-010)
// ---------------------------------------------------------------------------

// Like emoji, links do NOT require a TTY: Claude Code captures the status
// line's stdout (so `isTTY()` is false) yet the host terminal renders the
// hyperlink fine. Gate only on signals that predict a terminal that mangles
// OSC 8 — `TERM=dumb` and an explicit opt-out — so the click target shows by
// default. Set CLAUDORO_LINKS=never to force bare text; =always to force on.
const supportsLinks = () => {
  const pref = process.env.CLAUDORO_LINKS;
  if (pref === 'always') return true;
  if (pref === 'never') return false;
  return process.env.TERM !== 'dumb';
};

const OSC8 = '\x1b]8;;';
const ST = '\x1b\\'; // String Terminator: ESC \ (more robust than BEL through tmux)

/**
 * Wrap text in an OSC 8 hyperlink. Total + degrading: when links are off it
 * returns the bare text, so a terminal that can't render OSC 8 never shows
 * escape garbage on the status line (graceful-degradation invariant).
 * @param {string} url   the target URI (e.g. `claudoro://toggle`)
 * @param {string} text  the visible, already-styled link text
 * @returns {string}
 */
export const osc8 = (url, text) =>
  supportsLinks() ? `${OSC8}${url}${ST}${text}${OSC8}${ST}` : text;

// ---------------------------------------------------------------------------
// Phase icons (emoji with ASCII fallback for non-UTF8 terminals)
// ---------------------------------------------------------------------------

// Emoji do NOT require a TTY: Claude Code captures the status line's stdout
// (so `isTTY()` is false there) yet the host terminal renders emoji fine. Gate
// only on signals that actually predict broken glyphs — `TERM=dumb` and an
// explicit opt-out — so the tomato shows by default. Set CLAUDORO_EMOJI=never
// to force the ASCII fallback ([F]/[S]/[L]/||); =always to force emoji on.
const supportsEmoji = () => {
  const pref = process.env.CLAUDORO_EMOJI;
  if (pref === 'always') return true;
  if (pref === 'never') return false;
  return process.env.TERM !== 'dumb';
};

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

// ---------------------------------------------------------------------------
// Per-command help data (static frozen map, presentation-only)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} CommandHelpFlag
 * @property {string} flag
 * @property {string} desc
 */

/**
 * @typedef {object} CommandHelpExample
 * @property {string} cmd
 * @property {string} desc
 */

/**
 * @typedef {object} CommandHelpEntry
 * @property {string} summary       one-line description
 * @property {string} [whenToUse]   agent-facing decision cue: WHEN/WHY to pick this verb
 * @property {string} usage         usage pattern
 * @property {string[]} [aliases]   alternative spellings handled by this page
 * @property {CommandHelpFlag[]} [flags]  flag/arg table rows
 * @property {CommandHelpExample[]} examples  2-3 concrete examples
 * @property {string[]} [notes]     bullet notes (non-obvious WHY / gotchas)
 * @property {string[]} [next]      forward-priming follow-on actions (what an agent does after)
 * @property {string[]} [seeAlso]   related verbs
 */

/** @type {Readonly<Record<string, CommandHelpEntry>>} */
export const COMMAND_HELP = Object.freeze({
  start: {
    summary: 'Begin a focus block. All four durations are overridable per run.',
    whenToUse:
      'The user wants to start focusing or begin a pomodoro cycle. Only valid when the timer is idle; if a block already runs, start is rejected (use extend/reset/stop instead).',
    usage: 'pomo start [mins] [-w N -s N -l N -f N] [-n N] [--mute] [-t "label"]',
    flags: [
      {
        flag: '[mins]',
        desc: 'focus minutes, positional shorthand for -w (overrides -w)',
      },
      { flag: '-w, --work N', desc: 'focus block length in minutes (default 25)' },
      { flag: '-s, --short N', desc: 'short break length in minutes (default 5)' },
      { flag: '-l, --long N', desc: 'long break length in minutes (default 15)' },
      { flag: '-f, --frequency N', desc: 'focus blocks between long breaks (default 4)' },
      {
        flag: '-n, --notify N',
        desc: 'warning cue N minutes before phase end (default 1)',
      },
      { flag: '--mute', desc: 'start with sound off for this run' },
      {
        flag: '-t, --label TEXT',
        desc: 'label stamped on the completed record (supports #tags for grouping)',
      },
    ],
    examples: [
      {
        cmd: 'pomo start',
        desc: 'defaults: 25min focus, 5min short, 15min long, every 4',
      },
      { cmd: 'pomo start 50', desc: '50min focus, short/long/frequency unchanged' },
      {
        cmd: 'pomo start -s 10 -l 30',
        desc: 'change break lengths only, keep 25min focus',
      },
      {
        cmd: 'pomo start -t "auth #project-x #coding"',
        desc: 'labelled with #tags so sessions group later',
      },
    ],
    notes: [
      'All four durations (-w/-s/-l/-f) are fixed for the session. To change them, stop and start again.',
      'Prefer setting -t at start: it labels every record in the cycle and primes future grouping.',
      'A second start while one runs is rejected (one global timer, D-009).',
    ],
    next: [
      'Confirm it began with `pomo status`.',
      'Adjust on the fly: `pomo pause` (interruption), `pomo extend` (in flow), `pomo skip` (done early).',
      'Wrong durations? `pomo stop` then start again with new flags.',
    ],
    seeAlso: ['pause', 'extend', 'stop', 'mode'],
  },

  pause: {
    summary: 'Pause the running block. The countdown freezes; the alarm is cancelled.',
    whenToUse:
      'The user is stepping away briefly but intends to resume THIS block (call, interruption). Choose pause over stop when the work is not finished.',
    usage: 'pomo pause',
    examples: [{ cmd: 'pomo pause', desc: 'freeze the current phase' }],
    notes: [
      'Remaining time is preserved; resume continues from where it stopped.',
      'Works from any session (one global timer).',
    ],
    next: [
      'Resume with `pomo resume` when the user returns.',
      'If they are actually done, `pomo stop` instead.',
    ],
    seeAlso: ['resume', 'stop'],
  },

  resume: {
    summary: 'Resume a paused block from where it stopped.',
    whenToUse: 'A block is paused and the user is ready to continue it.',
    usage: 'pomo resume',
    examples: [{ cmd: 'pomo resume', desc: 'continue the paused phase' }],
    notes: [
      'The end time is recomputed from now plus the remaining minutes; the alarm is rescheduled.',
    ],
    next: ['Check time left with `pomo status`.'],
    seeAlso: ['pause'],
  },

  stop: {
    summary: 'Stop the timer and return to idle. The current phase is not counted.',
    whenToUse:
      'The user is finished and wants the timer cleared. WARNING: the current phase is discarded, not counted. To count it first, run skip before stop.',
    usage: 'pomo stop',
    examples: [{ cmd: 'pomo stop', desc: 'end the session, clear the live timer' }],
    notes: [
      'Stop does not finalize the current phase as completed; use skip to count it.',
      'Any pending alarm is cancelled and the detached one-shot is reaped.',
    ],
    next: [
      'To record the current phase before ending, `pomo skip` first, then stop.',
      'Begin again later with `pomo start`.',
    ],
    seeAlso: ['skip', 'reset'],
  },

  skip: {
    summary: 'Finish the current phase early and advance to the next.',
    whenToUse:
      'The user finished early and wants to move on AND keep the phase in history. Unlike stop, skip counts the phase.',
    usage: 'pomo skip',
    examples: [{ cmd: 'pomo skip', desc: 'finalize current phase, move on' }],
    notes: [
      'The current phase is finalized as skipped in the log (it still appears in history).',
      'In manual/balanced modes this advances past a waiting boundary too.',
    ],
    next: [
      'See the new phase with `pomo status`.',
      'Skipped by accident? `pomo back` reverts within ~2 minutes.',
    ],
    seeAlso: ['next', 'back'],
  },

  reset: {
    summary: 'Restart the current phase from its full duration, keeping cycle position.',
    whenToUse:
      'The user lost the start of the current phase (distraction, false start) and wants its clock restarted without disturbing the cycle count.',
    usage: 'pomo reset',
    examples: [{ cmd: 'pomo reset', desc: 'start the current phase over' }],
    notes: [
      'Cycle position and completed counts are unchanged; only the current clock restarts.',
    ],
    next: ['Confirm the fresh clock with `pomo status`.'],
    seeAlso: ['skip', 'stop'],
  },

  next: {
    summary: 'Advance a waiting boundary (manual / balanced mode).',
    whenToUse:
      'A boundary is WAITING for confirmation (balanced/manual mode, shown as overtime in status) and the user is ready to enter the next phase. A no-op in auto mode.',
    usage: 'pomo next',
    examples: [{ cmd: 'pomo next', desc: 'step into the next phase now' }],
    notes: [
      'Only meaningful when a boundary is waiting for confirmation (modes balanced/manual, D-006a).',
      'In auto mode transitions happen on their own, so next is usually a no-op.',
    ],
    next: [
      'Advanced too soon? `pomo back` reverts within the window.',
      'Change how boundaries behave with `pomo mode`.',
    ],
    seeAlso: ['mode', 'skip'],
  },

  back: {
    summary: 'Undo the last phase transition within a short window (default 2 min).',
    whenToUse:
      'A transition just happened (often an auto-advance into a break) and the user wants to revert to the previous phase. Only works within ~2 minutes of the transition.',
    usage: 'pomo back',
    examples: [{ cmd: 'pomo back', desc: 'return to the prior phase if just advanced' }],
    notes: [
      'If an auto-advance dropped you into a break, back returns to the preceding focus phase.',
      'Only works inside the back-window (default 2 minutes after the transition).',
    ],
    next: ['Re-advance when ready with `pomo next` or `pomo skip`.'],
    seeAlso: ['next', 'skip'],
  },

  extend: {
    summary: 'Add minutes to the current phase without breaking the cycle.',
    whenToUse:
      'The user is in flow and wants more time on the CURRENT phase. Prefer extend over reset/restart: it keeps elapsed time and the cycle intact.',
    usage: 'pomo extend [N]',
    flags: [{ flag: '[N]', desc: 'minutes to add (default 5)' }],
    examples: [
      { cmd: 'pomo extend', desc: 'add 5 minutes to the current phase' },
      { cmd: 'pomo extend 10', desc: 'add 10 minutes' },
    ],
    notes: [
      'The end time moves later and the alarm is rescheduled so it still fires on time.',
    ],
    next: ['Verify the new end time with `pomo status`.'],
    seeAlso: ['start', 'reset'],
  },

  mode: {
    summary: 'Get or set the phase transition mode.',
    whenToUse:
      'The user wants to control whether phases auto-advance. Read it first (no argument) before changing, so you report the current value.',
    usage: 'pomo mode [auto|balanced|manual] [--json]',
    flags: [
      { flag: 'auto', desc: 'transitions advance automatically (default)' },
      { flag: 'balanced', desc: 'breaks auto-advance, focus waits for confirmation' },
      { flag: 'manual', desc: 'every boundary waits for next' },
      { flag: '--json', desc: 'print the current/new mode as JSON' },
    ],
    examples: [
      { cmd: 'pomo mode', desc: 'show the current mode' },
      { cmd: 'pomo mode manual', desc: 'require confirmation at every boundary' },
    ],
    notes: [
      'With no argument it prints the current mode; with an argument it sets it (D-006a).',
    ],
    next: ['In balanced/manual, advance a waiting boundary with `pomo next`.'],
    seeAlso: ['next', 'view'],
  },

  view: {
    summary: 'Get or set the status-line layout.',
    whenToUse:
      'The user wants more or less detail in the status line. Display-only; it never changes timing. Read first (no argument) to report the current layout.',
    usage: 'pomo view [minimal|classic|full] [--json]',
    flags: [
      { flag: 'minimal', desc: 'icon + time only' },
      { flag: 'classic', desc: 'icon + time + cycle (default)' },
      { flag: 'full', desc: 'adds label and today stats' },
      { flag: '--json', desc: 'print the current/new view as JSON' },
    ],
    examples: [
      { cmd: 'pomo view', desc: 'show the current view' },
      { cmd: 'pomo view full', desc: 'switch to the detailed layout' },
    ],
    notes: [
      'The view is a display preference only; it never changes timer state (D-004).',
    ],
    next: ['See the same data in chat with `pomo status`.'],
    seeAlso: ['mode', 'status'],
  },

  note: {
    summary:
      'Append a note to the current block (additive). --set overwrites, --clear empties.',
    whenToUse:
      'The user wants to record WHAT this block is about, or add context as it evolves. ADDITIVE by default: each call appends to the existing label rather than replacing it, so notes accumulate over a session. Use --set only to overwrite wholesale.',
    usage: 'pomo note "TEXT" [--set] [--clear]',
    flags: [
      { flag: '--set', desc: 'overwrite the label with TEXT instead of appending' },
      { flag: '--clear', desc: 'empty the label' },
    ],
    examples: [
      { cmd: 'pomo note "auth work"', desc: 'set the note (label was empty)' },
      {
        cmd: 'pomo note "debugging OAuth"',
        desc: 'appends: "auth work debugging OAuth"',
      },
      { cmd: 'pomo note --set "fresh label"', desc: 'overwrite everything' },
      { cmd: 'pomo note --clear', desc: 'empty the label' },
    ],
    notes: [
      'Additive by default; `pomo label` is a back-compat alias for this command.',
      'Works at any point during a running or paused block, not only at start.',
      'For #tags, prefer `pomo tag review` (quote-free, deduped) over typing "#" here (the shell treats an unquoted # as a comment).',
      'The label is stamped onto the completed record when the block ends.',
      'To annotate a block that has already completed, use `pomo log open`.',
    ],
    next: [
      'Add structured tags with `pomo tag <name>`.',
      'Review notes and tags in history with `pomo log`.',
      'Set an initial note at start with `pomo start -t "text"`.',
    ],
    seeAlso: ['tag', 'start', 'log', 'status'],
  },

  tag: {
    summary: 'Add one or more #tags to the current block (quote-free, deduped).',
    whenToUse:
      'The user wants to categorise this block for later grouping/reports. Adds #tags to the label without touching existing prose. Quote-free: type the bare name, the verb adds the "#", normalises to #kebab-case, and skips tags already present.',
    usage: 'pomo tag <name> [name...]',
    examples: [
      { cmd: 'pomo tag review', desc: 'append #review to the label' },
      { cmd: 'pomo tag review project-x', desc: 'add #review and #project-x at once' },
      { cmd: 'pomo tag "Code Review"', desc: 'normalises to #code-review' },
      { cmd: 'pomo tag review', desc: 'again: no-op, already present (deduped)' },
    ],
    notes: [
      'Tags live inside the same label field as #tokens; there is no separate tags field (derive, do not store, D-007).',
      'Each argument becomes one tag; quote multi-word tags so they kebab-case together.',
      'Reporting tools group records by parsing #tags from labels, which is why normalisation and dedupe matter.',
    ],
    next: [
      'Add free-text context with `pomo note "text"`.',
      'See tagged history with `pomo log` (use --json to group).',
    ],
    seeAlso: ['note', 'log', 'status'],
  },

  label: {
    summary: 'Alias for `pomo note` (additive). See `pomo help note`.',
    whenToUse:
      'Back-compat alias for `note`. Behaves identically: additive by default, --set overwrites, --clear empties. Prefer `pomo note` and `pomo tag` in new usage.',
    usage: 'pomo label "TEXT" [--set] [--clear]',
    examples: [
      { cmd: 'pomo label "review PR"', desc: 'append to the label (same as note)' },
      { cmd: 'pomo label --set "x"', desc: 'overwrite' },
    ],
    notes: [
      'Identical to `pomo note`; kept so existing muscle memory and scripts keep working.',
    ],
    next: ['Use `pomo note` for prose and `pomo tag` for #tags.'],
    seeAlso: ['note', 'tag', 'log'],
  },

  mute: {
    summary: 'Turn the end and warning cues off.',
    whenToUse:
      'The user wants silence (meeting, deep focus) but still wants the visual countdown. Global, not per session.',
    usage: 'pomo mute',
    examples: [{ cmd: 'pomo mute', desc: 'silence all cues' }],
    notes: [
      'Mute is global state, not per session; unmute reverses it.',
      'Visual cues in the status line still update when muted.',
    ],
    next: ['Re-enable sound with `pomo unmute`.'],
    seeAlso: ['unmute', 'start'],
  },

  unmute: {
    summary: 'Turn the cues back on.',
    whenToUse: 'Sound was muted and the user wants audible cues back.',
    usage: 'pomo unmute',
    examples: [{ cmd: 'pomo unmute', desc: 're-enable sound' }],
    seeAlso: ['mute'],
  },

  status: {
    summary: 'Print rich current status into the conversation.',
    whenToUse:
      'You (the agent) need the current timer state to answer the user or decide a next action. This is the primary READ verb: run it before acting, and use --json to parse reliably.',
    usage: 'pomo status [--json]',
    flags: [
      { flag: '--json', desc: 'machine-readable status object (schema-versioned)' },
    ],
    examples: [
      { cmd: 'pomo status', desc: 'pretty multi-line status block' },
      { cmd: 'pomo status --json', desc: 'stable JSON for scripts and agents' },
    ],
    notes: [
      'Shows phase, time remaining, cycle position, label, mode, mute, and today stats.',
      'Today stats (completed blocks, focus minutes) are derived from the log, not stored (D-007).',
    ],
    next: [
      'Act on the state: `pomo pause`, `pomo extend`, `pomo skip`, `pomo stop`.',
      'Drill into past sessions with `pomo log`.',
    ],
    seeAlso: ['log', 'view'],
  },

  log: {
    summary: 'Show session history, open the log, or list backups.',
    whenToUse:
      'The user asks about past sessions, productivity, or wants to annotate/edit history. Use --json to aggregate or group records (e.g. by #tags in labels).',
    usage:
      'pomo log [--today | --date YYYY-MM-DD] [--json]   |   pomo log open   |   pomo log backups',
    flags: [
      { flag: '--today', desc: 'records for today (default)' },
      { flag: '-d, --date DATE', desc: 'records for a given day (YYYY-MM-DD)' },
      { flag: '--json', desc: 'records as a JSON array (parse #tags from labels here)' },
      {
        flag: 'open',
        desc: 'open today\'s log in $EDITOR; edit the "label" field to annotate past records',
      },
      { flag: 'backups', desc: 'list available backups with ids and timestamps' },
    ],
    examples: [
      { cmd: 'pomo log', desc: "today's completed phases" },
      { cmd: 'pomo log --date 2026-06-10', desc: 'a specific day' },
      { cmd: 'pomo log --json', desc: 'machine-readable records for grouping/reports' },
      { cmd: 'pomo log open', desc: 'edit the raw JSONL to annotate completed records' },
    ],
    notes: [
      'To annotate a running block at any time, use `pomo label "text"`: it updates the live label and stamps it on the completed record.',
      'To annotate a completed record, use `pomo log open` and edit the "label" field. Run `pomo log backups` first as a safety net.',
      'History is folded from immutable JSONL records; counts are derived on read.',
    ],
    next: [
      'Remove mis-logged records with `pomo undo` (backs up first).',
      'Reverse an undo or a bad edit with `pomo restore`.',
    ],
    seeAlso: ['label', 'status', 'undo', 'restore'],
  },

  undo: {
    summary: 'Remove the last N completed records, backing up first.',
    whenToUse:
      'The user wants to remove recent records (mis-logged, test runs, a wrong day). DESTRUCTIVE: always run --dry-run first, show the user exactly what would go, get explicit confirmation, then re-run with --yes (D-007).',
    usage: 'pomo undo [N] [--today] [--dry-run] [--yes]',
    flags: [
      { flag: '[N]', desc: 'number of records to remove (default 1)' },
      { flag: '--today', desc: "wipe all of today's records (ignores N)" },
      { flag: '--dry-run', desc: 'print what would be removed, change nothing' },
      { flag: '--yes', desc: 'skip the confirmation prompt' },
      { flag: '--json', desc: 'report the removed records as JSON' },
    ],
    examples: [
      {
        cmd: 'pomo undo --dry-run',
        desc: 'preview the last record removal (do this first)',
      },
      { cmd: 'pomo undo 2 --yes', desc: 'remove the last two records, no prompt' },
      {
        cmd: 'pomo undo --today --yes',
        desc: "reset today: remove all of today's records",
      },
    ],
    notes: [
      'A timestamped backup is written unconditionally before anything is removed (D-007).',
      'Aggregates are re-derived after undo; there are no stored counters to fix up.',
      '--today removes every record for today (focus and breaks), not just completed focus.',
      'Without --yes on a TTY you are prompted to confirm.',
    ],
    next: [
      'Verify the result with `pomo log`.',
      'Made a mistake? Reverse it with `pomo restore <backup-id>` (the id is printed after undo).',
    ],
    seeAlso: ['restore', 'log'],
  },

  restore: {
    summary: 'Restore the log from a backup; with no id, list backups.',
    whenToUse:
      'The user wants to reverse an undo or a manual log edit. Run with no id first to list available backups, then restore the chosen one.',
    usage: 'pomo restore [backup-id]',
    flags: [
      { flag: '[backup-id]', desc: 'backup to restore (omit to list available backups)' },
      { flag: '--json', desc: 'report the result as JSON' },
    ],
    examples: [
      { cmd: 'pomo restore', desc: 'list available backups (do this first)' },
      { cmd: 'pomo restore 2026-06-17T09-30-00', desc: 'restore that backup' },
    ],
    notes: [
      'Restore reverses an undo or edit; the current log is itself backed up first.',
    ],
    next: ['Confirm the restored history with `pomo log`.'],
    seeAlso: ['undo', 'log'],
  },

  setup: {
    summary: 'Wire Claudoro into Claude Code (idempotent).',
    whenToUse:
      'First-time install, or re-wiring after an upgrade moved the binary. Safe to run repeatedly.',
    usage: 'pomo setup',
    examples: [{ cmd: 'pomo setup', desc: 'install command file, statusLine, hooks' }],
    notes: [
      'Preserves your existing status line (model, context, git) by composing, not clobbering (D-005).',
      'Safe to run repeatedly; a manifest records exactly what was added.',
    ],
    next: [
      'Start your first block with `pomo start`.',
      'Remove everything later with `pomo uninstall`.',
    ],
    seeAlso: ['uninstall'],
  },

  uninstall: {
    summary: 'Reverse setup and remove all Claudoro wiring.',
    whenToUse:
      'The user wants Claudoro removed from Claude Code, restoring their prior status line.',
    usage: 'pomo uninstall',
    examples: [
      { cmd: 'pomo uninstall', desc: 'restore prior status line, remove hooks' },
    ],
    notes: [
      'Restores the previous status line from backup and leaves no orphaned processes (D-005).',
    ],
    next: ['Reinstall any time with `pomo setup`.'],
    seeAlso: ['setup'],
  },

  help: {
    summary: 'Show all commands, or detail for one command.',
    whenToUse:
      "You are unsure which verb fits, or need a verb's flags and follow-on actions. Run `pomo help <verb>` for a detail page with WHEN TO USE and NEXT sections.",
    usage: 'pomo help [command]',
    examples: [
      { cmd: 'pomo help', desc: 'the full command index' },
      { cmd: 'pomo help start', desc: 'this style of detail page' },
    ],
    next: ['Pick the right verb and run it; each detail page lists likely next actions.'],
    seeAlso: [],
  },
});

// ---------------------------------------------------------------------------
// Section builders (each returns string[], skipped when data is absent)
// ---------------------------------------------------------------------------

/** @param {string} key @param {CommandHelpEntry} e @returns {string[]} */
const headerSection = (key, e) => [
  bold(tomato(`pomo ${key}`)) + '  ' + dim(e.summary),
  '',
];

/** @param {CommandHelpEntry} e @returns {string[]} */
const whenToUseSection = (e) =>
  !e.whenToUse ? [] : [bold('WHEN TO USE'), '  ' + e.whenToUse, ''];

/** @param {CommandHelpEntry} e @returns {string[]} */
const usageSection = (e) => [bold('USAGE'), '  ' + e.usage, ''];

/** @param {CommandHelpEntry} e @returns {string[]} */
const flagsSection = (e) =>
  !e.flags?.length ? [] : [bold('FLAGS'), ...e.flags.map((f) => row(f.flag, f.desc)), ''];

/** @param {CommandHelpEntry} e @returns {string[]} */
const examplesSection = (e) => [
  bold('EXAMPLES'),
  ...e.examples.map((x) => row(x.cmd, dim(x.desc))),
  '',
];

/** @param {CommandHelpEntry} e @returns {string[]} */
const notesSection = (e) =>
  !e.notes?.length ? [] : [bold('NOTES'), ...e.notes.map((n) => '  - ' + n), ''];

/** @param {CommandHelpEntry} e @returns {string[]} */
const nextSection = (e) =>
  !e.next?.length ? [] : [bold('NEXT'), ...e.next.map((n) => '  - ' + n), ''];

/** @param {CommandHelpEntry} e @returns {string[]} */
const seeAlsoSection = (e) =>
  !e.seeAlso?.length ? [] : [dim('See also: ' + e.seeAlso.join(', '))];

/**
 * Render a per-command help page. Pure: returns a string, prints nothing.
 * Total: an unknown topic degrades to a helpful fallback, never throws.
 * @param {string} topic   the verb name (already lowercased by caller)
 * @param {object} [_prefs] current prefs (unused, kept for signature symmetry with renderHelp)
 * @returns {string}
 */
const renderCommandHelp = (topic, _prefs = {}) => {
  const key = String(topic).toLowerCase().replace(/^-+/, '');
  const entry = COMMAND_HELP[key];

  if (!entry) {
    const known = Object.keys(COMMAND_HELP).sort().join(', ');
    return [
      `Unknown command '${key}'.`,
      '',
      dim('Known commands: ') + known,
      `Run ${bold('pomo help')} for the full index.`,
    ].join('\n');
  }

  const lines = [
    ...headerSection(key, entry),
    ...whenToUseSection(entry),
    ...usageSection(entry),
    ...flagsSection(entry),
    ...examplesSection(entry),
    ...notesSection(entry),
    ...nextSection(entry),
    ...seeAlsoSection(entry),
  ];

  return lines.join('\n').replace(/\n+$/, '');
};

/** Fixed two-column entry: left pads to COL chars, description starts there. */
const COL = 34;
const cmdEntry = (verb, hint, desc) => {
  const left = hint ? `  ${verb} ${hint}` : `  ${verb}`;
  const gap = Math.max(2, COL - left.length);
  return left + ' '.repeat(gap) + dim(desc);
};

/** Pull the first sentence from a summary, strip trailing period, lowercase first char. */
const brief = (verb) => {
  const s = COMMAND_HELP[verb]?.summary ?? '';
  const dot = s.indexOf('. ');
  const sentence = dot !== -1 ? s.slice(0, dot) : s.replace(/\.$/, '');
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
};

/** Render the full help index. Pure: returns a string, does not print. */
export const renderHelp = (topic = null, prefs = {}) => {
  if (topic) return renderCommandHelp(topic, prefs);

  const title = bold(tomato('Claudoro')) + dim(' - Pomodoro timer for Claude Code');
  const hint = dim('  (pomo help <command> for details)');
  const sections = [
    title,
    hint,
    '',
    bold('CONTROL'),
    cmdEntry('start', '[mins] [-t label]', 'begin a focus block'),
    cmdEntry('pause', '', brief('pause')),
    cmdEntry('resume', '', brief('resume')),
    cmdEntry('stop', '', brief('stop')),
    cmdEntry('skip', '', brief('skip')),
    cmdEntry('reset', '', brief('reset')),
    cmdEntry('next', '', brief('next')),
    cmdEntry('back', '', brief('back')),
    cmdEntry('extend', '[N]', brief('extend')),
    '',
    bold('CONFIG'),
    cmdEntry(
      'mode',
      `[auto|balanced|manual]`,
      `transition mode (current: ${prefs.mode ?? 'auto'})`,
    ),
    cmdEntry(
      'view',
      `[minimal|classic|full]`,
      `status-line layout (current: ${prefs.view ?? 'classic'})`,
    ),
    cmdEntry('label', '"text"', brief('label')),
    cmdEntry('mute', '', brief('mute')),
    cmdEntry('unmute', '', brief('unmute')),
    '',
    bold('LOG & DATA'),
    cmdEntry('status', '[--json]', brief('status')),
    cmdEntry('log', '[--today|--date|open|backups]', brief('log')),
    cmdEntry('undo', '[N] [--today] [--dry-run] [--yes]', brief('undo')),
    cmdEntry('restore', '[backup-id]', brief('restore')),
    '',
    bold('SETUP'),
    cmdEntry('setup', '', brief('setup')),
    cmdEntry('uninstall', '', brief('uninstall')),
    cmdEntry('help', '[command]', brief('help')),
    '',
    dim(`State: ${process.env.XDG_STATE_HOME ?? '~/.local/state'}/claudoro/`),
    dim('Docs:  https://github.com/emson/claudoro'),
  ];

  return sections.join('\n');
};

// ---------------------------------------------------------------------------
// Status output helpers
// ---------------------------------------------------------------------------

/** Map a phase value to its display word. */
const phaseWord = (phase) => {
  if (phase === 'focus') return 'Focus';
  if (phase === 'long_break') return 'Long break';
  return 'Short break';
};

/**
 * Local phase color selector (mirrors segment.js — duplicated to keep M6
 * free of an M3 dependency; just 3 lines, no layering inversion).
 */
const phaseColor = (phase) => {
  if (phase === 'focus') return tomato;
  if (phase === 'long_break') return teal;
  return amber;
};

/** Pluralize a count: 1 pomodoro, 3 pomodoros. */
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Line 1: phase icon + phase + time or idle marker.
 * Clock is read once by the caller and passed in.
 */
const statusHeadline = (state, now) => {
  const { run_state, phase } = state;

  if (run_state === 'paused') {
    const remSec = remaining(state, now) ?? 0;
    const icon = ICONS.paused();
    const word = phaseWord(phase);
    const colorFn = phaseColor(phase);
    return `${icon} ${colorFn(`Paused: ${word}, ${formatMMSS(remSec)} left`)}`;
  }

  const icon = ICONS[phase]?.() ?? ICONS.focus();
  const colorFn = phaseColor(phase);
  const word = phaseWord(phase);

  if (isOvertime(state, now)) {
    const over = overtimeSec(state, now);
    return `${icon} ${colorFn(`${word}: +${formatMMSS(over)} over`)}`;
  }

  const remSec = remaining(state, now) ?? 0;
  const pct = Math.round(progressFraction(state, now) * 100);
  return `${icon} ${colorFn(`${word}: ${formatMMSS(remSec)} remaining (${pct}%)`)}`;
};

/** Line 2: Mode / View / Mute config summary. */
const statusConfigLine = (prefs, state) => {
  const mode = state.mode ?? prefs?.mode ?? 'auto';
  const view = prefs?.view ?? 'classic';
  const muteOn = (state.config?.mute ?? prefs?.mute) ? 'on' : 'off';
  return (
    `${dim('Mode:')} ${mode}` +
    `${dim('  |  ')}${dim('View:')} ${view}` +
    `${dim('  |  ')}${dim('Mute:')} ${muteOn}`
  );
};

/** Line 3: Today's completed pomodoros and focus minutes. */
const statusTodayLine = (aggregates) => {
  const n = aggregates?.completedToday ?? 0;
  const m = Math.round(aggregates?.focusMinToday ?? 0);
  return `${dim('Today:')} ${plural(n, 'pomodoro')}, ${m} min focus`;
};

/**
 * Line 4: Next long break countdown (only when not idle).
 * Uses live set_index from aggregates (see design note in cmdStatus).
 */
const statusNextBreakLine = (aggregates) => {
  if (aggregates == null) return null;
  const freq = aggregates.frequency ?? 4;
  const pos = (aggregates.setIndex ?? 0) % freq;
  const untilLong = pos === 0 ? freq : freq - pos;
  const msg =
    untilLong === 1
      ? 'Next long break: after this focus'
      : `Next long break: after ${untilLong} more focuses`;
  return dim(msg);
};

/** Line 5: Label, when present. */
const statusLabelLine = (state) => `${dim('Label:')} "${state.label}"`;

/** Line 6: Overtime nudge (yellow, gentle). */
const statusOvertimeLine = (state, now) => {
  const over = overtimeSec(state, now);
  return yellow(
    `Running over by ${formatMMSS(over)}. Use \`pomo next\` to advance or \`pomo back\` to revert.`,
  );
};

// ---------------------------------------------------------------------------
// Status output
// ---------------------------------------------------------------------------

/** Render /pomo status detail into the conversation. Returns a string. */
export const renderStatus = (state, aggregates, prefs) => {
  const now = nowEpoch();

  if (!state || state.run_state === 'idle') {
    return [
      dim('○ Idle. Run `pomo start` to begin.'),
      statusConfigLine(prefs ?? {}, state ?? {}),
      statusTodayLine(aggregates ?? { completedToday: 0, focusMinToday: 0 }),
    ].join('\n');
  }

  return [
    statusHeadline(state, now),
    statusConfigLine(prefs ?? {}, state),
    statusTodayLine(aggregates),
    statusNextBreakLine(aggregates),
    state.label ? statusLabelLine(state) : null,
    isOvertime(state, now) ? statusOvertimeLine(state, now) : null,
  ]
    .filter(Boolean)
    .join('\n');
};

/** Format output for --json flag. Always plain JSON, no ANSI. */
export const renderJson = (data) => JSON.stringify(data, null, 2);

// ---------------------------------------------------------------------------
// Log rendering helpers (M5/M6)
// ---------------------------------------------------------------------------

/**
 * Format minutes as a human-readable duration: "2h 05m", "45m", "0m".
 * @param {number} min
 * @returns {string}
 */
const formatFocus = (min) => {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

/**
 * Format an epoch-seconds timestamp as "HH:MM" (local time).
 * @param {number} epochSec
 * @returns {string}
 */
const formatClock = (epochSec) => {
  const d = new Date(epochSec * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Parse a backup id back into a readable "YYYY-MM-DD HH:MM:SS" string.
 * Backup ids are ISO timestamps with colons and dots replaced by hyphens,
 * e.g. "2026-06-17T14-30-05-123Z". Degrades to the raw id on unexpected shapes.
 * @param {string} id
 * @returns {string}
 */
const formatBackupTime = (id) => {
  try {
    const tIdx = id.indexOf('T');
    if (tIdx === -1) return id;
    const datePart = id.slice(0, tIdx);
    const timePart = id.slice(tIdx + 1).replace('Z', '');
    // timePart is "HH-MM-SS-mmm"
    const segments = timePart.split('-');
    if (segments.length < 3) return id;
    const [hh, mm, ss] = segments;
    return `${datePart} ${hh}:${mm}:${ss}`;
  } catch {
    return id;
  }
};

/**
 * Render one log record as a single line.
 * @param {object} record - PhaseRecord
 * @returns {string}
 */
const renderLogRow = (record) => {
  const time = `${formatClock(record.started)}-${formatClock(record.ended)}`;
  const icon = ICONS[record.phase]?.() ?? ICONS.focus();
  const baseDur = formatFocus(record.actual_min ?? record.planned_min ?? 0);
  const overtime = record.overtime_min > 0 ? dim(`+${record.overtime_min}m`) : '';
  const dur = overtime ? `${baseDur} ${overtime}` : baseDur;

  let statusWord;
  switch (record.status) {
    case 'completed':
      statusWord = green('done');
      break;
    case 'skipped':
      statusWord = yellow('skip');
      break;
    case 'aborted':
      statusWord = red('stop');
      break;
    case 'partial':
      statusWord = yellow('part');
      break;
    default:
      statusWord = dim(record.status ?? 'unknown');
  }

  const label = record.label ? `  ${dim(`"${record.label}"`)}` : '';
  return `  ${time}  ${icon}  ${dur}  ${statusWord}${label}`;
};

/**
 * Render a day's records as a table (TTY) or clean plain text (captured).
 * @param {string} date - ISO 'YYYY-MM-DD'
 * @param {object[]} records - PhaseRecords for that date, chronological
 * @param {{completedToday:number, focusMinToday:number}} aggregates
 * @returns {string}
 */
export const renderLog = (date, records, aggregates) => {
  if (!records || records.length === 0) return `No records for ${date}.`;

  const header =
    `${bold(date)}  ` +
    `${dim(`${aggregates.completedToday} completed`)}  ` +
    `${dim(`${formatFocus(aggregates.focusMinToday)} focus`)}`;

  const rows = records.map(renderLogRow);
  const footer = dim(`total focus: ${formatFocus(aggregates.focusMinToday)}`);

  return [header, '', ...rows, '', footer].join('\n');
};

/**
 * Render a list of backup ids for display.
 * @param {string[]} backups - ids from listBackups (descending, most recent first)
 * @returns {string}
 */
export const renderBackups = (backups) => {
  if (!backups || backups.length === 0) return 'No backups yet.';

  const header = `${bold('Backups')}${dim(' (most recent first)')}`;
  const rows = backups.map((id) => row(id, dim(formatBackupTime(id))));
  return [header, '', ...rows].join('\n');
};

// ---------------------------------------------------------------------------
// Undo / restore rendering helpers (M5/M6)
// ---------------------------------------------------------------------------

/**
 * Format one completed record as a single display line for undo previews.
 * @param {object} record - PhaseRecord
 * @returns {string}
 */
const PHASE_NOUN = {
  focus: 'focus',
  short_break: 'short break',
  long_break: 'long break',
};

export const formatRecordLine = (record) => {
  const when = new Date(record.started * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 16);
  const mins = record.actual_min ?? record.planned_min ?? 0;
  const noun = PHASE_NOUN[record.phase] ?? record.phase ?? 'focus';
  const label = record.label ? ` "${record.label}"` : '';
  return `  ${when}  ${mins}min ${noun}${label}`;
};

/**
 * Render the "would remove" plan for dry-run and the pre-prompt TTY preview.
 * @param {object[]} records - records that would be removed
 * @param {number} requested - the N the user asked for
 * @param {{today?: boolean}} [opts] - today scopes to a full-day wipe
 * @returns {string}
 */
export const renderUndoPlan = (records, requested, opts = {}) => {
  if (opts.today) {
    const head = bold(`Would remove all ${records.length} record(s) for today:`);
    return [head, ...records.map(formatRecordLine)].join('\n');
  }
  const head = bold(`Would remove ${records.length} completed focus record(s):`);
  const note =
    records.length < requested
      ? dim(`(only ${records.length} of ${requested} requested are available)`)
      : '';
  return [head, ...records.map(formatRecordLine), note].filter(Boolean).join('\n');
};

/**
 * Render the post-undo confirmation message.
 * @param {object[]} records - records that were removed
 * @param {string} backupId - the id of the backup written before removal
 * @returns {string}
 */
export const renderUndoResult = (records, backupId) =>
  `${green('Removed')} ${records.length} record(s). Backup saved: ${bold(backupId)}.\n` +
  dim(`Restore with: pomo restore ${backupId}`);

/**
 * Render a list of backup ids for the restore subcommand (most recent first).
 * @param {string[]} backups - ids from listBackups
 * @returns {string}
 */
export const renderBackupList = (backups) => {
  if (!backups || backups.length === 0)
    return 'No backups found. Backups are written automatically before every undo or restore.';

  const head = bold(`${backups.length} backup(s) available (most recent first):`);
  const rows = backups.map((id, i) => `  ${i === 0 ? green('*') : ' '} ${id}`);
  return [head, ...rows, '', dim('Restore one with: pomo restore <backup-id>')].join(
    '\n',
  );
};

/**
 * Render the post-restore confirmation message.
 * @param {string} id - the backup id that was restored
 * @returns {string}
 */
export const renderRestoreResult = (id) =>
  `${green('Restored')} from backup ${bold(id)}. A safety backup of the previous state was saved first.`;
