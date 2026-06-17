/**
 * M1: CLI entry point — arg parsing and verb dispatch.
 * Each verb is an async function that receives { positional, flags, env }.
 * Side effects (printing, process.exit) happen here; timer.js stays pure.
 */
import {
  ensureDirs,
  readState,
  mutateState,
  applyTransition,
  readPrefs,
  writePrefs,
} from './store.js';
import * as T from './timer.js';
import { appendRecord } from './history.js';
import { scheduleAlarm, cancelAlarm, reconcileAndReschedule } from './alarm.js';
import { renderHelp, renderStatus, renderJson } from './output.js';
import { remaining, formatMMSS, nowEpoch } from './derive.js';
import { setup, uninstall } from './setup.js';
import { render as renderStatusline } from './statusline.js';

// ---------------------------------------------------------------------------
// Arg parser
// ---------------------------------------------------------------------------

// Flags that always consume the next token as their value
const FLAGS_WITH_VALUES = new Set([
  'work',
  'w',
  'short',
  's',
  'long',
  'l',
  'frequency',
  'f',
  'notify',
  'n',
  'label',
  't',
  'title',
  'date',
  'd',
  'timer',
]);

const SHORT = {
  w: 'work',
  s: 'short',
  l: 'long',
  f: 'frequency',
  t: 'label',
  n: 'notify',
};

export const parseArgs = (argv) => {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const eq = key.indexOf('=');
      if (eq !== -1) {
        flags[key.slice(0, eq)] = key.slice(eq + 1);
      } else if (FLAGS_WITH_VALUES.has(key) && argv[i + 1] !== undefined) {
        flags[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    } else if (a.startsWith('-') && a.length === 2 && SHORT[a[1]]) {
      const key = SHORT[a[1]];
      if (FLAGS_WITH_VALUES.has(key) && argv[i + 1] !== undefined) {
        flags[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }

  return { flags, positional };
};

// ---------------------------------------------------------------------------
// Verb handlers
// ---------------------------------------------------------------------------

/**
 * Cancel the prior phase's alarm (by its old PID), spawn a fresh one for the
 * new end_epoch if still running, and persist the new PID. Used by every verb
 * that changes when the current phase ends.
 */
const reschedule = async (state, prevPid) => {
  cancelAlarm(prevPid);
  if (state.run_state !== 'running') return;
  const pid = scheduleAlarm(state);
  await mutateState((s) => ({ ...s, alarm_pid: pid }));
};

const cmdStart = async ({ positional, flags }) => {
  const mins =
    positional[0] && /^\d+$/.test(positional[0]) ? parseInt(positional[0], 10) : null;
  const label =
    positional.slice(mins != null ? 1 : 0).join(' ') ||
    flags.label ||
    flags.title ||
    null;
  const sessionId = process.env.CLAUDE_SESSION_ID ?? null;

  const prefs = readPrefs();
  const config = {
    work: mins ?? parseInt(flags.work ?? '25', 10),
    short: parseInt(flags.short ?? '5', 10),
    long: parseInt(flags.long ?? '15', 10),
    frequency: parseInt(flags.frequency ?? '4', 10),
    notify: parseInt(flags.notify ?? '1', 10),
    // flag > persisted pref > default (matches the mode precedence below)
    mute: 'mute' in flags ? true : (prefs.mute ?? false),
  };
  const mode = flags.mode ?? prefs.mode; // flag > persisted > default (D-006a)

  const { changed, state } = await applyTransition((s) =>
    T.start(s, { config, mode, label, sessionId }),
  );

  if (!changed) {
    const current = readState();
    console.log(
      `A ${current.phase} block is already running (${formatMMSS(remaining(current) ?? 0)} left). ` +
        `Use \`pomo reset\` to restart it, or \`pomo stop\` to end it.`,
    );
    return;
  }

  await reschedule(state, null);
  console.log(
    `Started ${state.config.work}min focus block${label ? ` "${label}"` : ''}. Good luck.`,
  );
};

const cmdPause = async () => {
  const { changed, prev } = await applyTransition((s) => T.pause(s));
  if (!changed) return console.log('Nothing running to pause.');
  cancelAlarm(prev.alarm_pid);
  console.log('Paused.');
};

const cmdResume = async () => {
  const { changed, state, prev } = await applyTransition((s) => T.resume(s));
  if (!changed) return console.log('Not paused.');
  await reschedule(state, prev.alarm_pid);
  console.log('Resumed.');
};

const cmdStop = async () => {
  const { changed, prev, record } = await applyTransition((s) => T.stop(s));
  if (!changed) return console.log('Nothing running.');
  cancelAlarm(prev.alarm_pid);
  if (record) appendRecord(record);
  console.log('Stopped.');
};

const cmdSkip = async () => {
  const { changed, state, prev, record } = await applyTransition((s) => T.skip(s));
  if (!changed) return console.log('Nothing running to skip.');
  if (record) appendRecord(record);
  await reschedule(state, prev.alarm_pid);
  console.log(`Skipped. Next: ${state.phase ?? 'idle'}.`);
};

const cmdReset = async () => {
  const { changed, state, prev } = await applyTransition((s) => T.reset(s));
  if (!changed) return console.log('Nothing running to reset.');
  await reschedule(state, prev.alarm_pid);
  console.log(`Reset. ${formatMMSS(state.planned_min * 60)} on the clock.`);
};

const cmdNext = async () => {
  const now = nowEpoch();
  const { changed, state, prev, record } = await applyTransition((s) =>
    T.next(s, { nowSec: now }),
  );
  if (!changed) {
    return console.log('Not at a waiting boundary. Use `pomo skip` to advance early.');
  }
  if (record) appendRecord(record);
  await reschedule(state, prev.alarm_pid);
  console.log(`Advanced to ${(state.phase ?? 'idle').replace('_', ' ')}.`);
};

const cmdBack = async () => {
  // TODO: M2 — undo last transition within the back-window
  console.log('`back` is not yet implemented.');
};

const cmdExtend = async ({ positional, flags }) => {
  const minutes = parseInt(positional[0] ?? flags.minutes ?? '5', 10);
  const { changed, state, prev } = await applyTransition((s) => T.extend(s, { minutes }));
  if (!changed) return console.log('Nothing running to extend.');
  // The end moved, so the old one-shot would fire early — reschedule it.
  await reschedule(state, prev.alarm_pid);
  console.log(`Extended by ${minutes}min.`);
};

const cmdMode = async ({ positional, flags }) => {
  const MODES = ['auto', 'balanced', 'manual'];
  const value = positional[0];
  const prefs = readPrefs();

  if (!value) {
    console.log(`mode: ${prefs.mode} (options: ${MODES.join(' | ')})`);
    return;
  }
  if (!MODES.includes(value)) {
    console.log(`Unknown mode '${value}'. Choose: ${MODES.join(' | ')}`);
    process.exit(1);
  }
  writePrefs({ ...prefs, mode: value });
  if (flags.json) console.log(renderJson({ mode: value }));
  else console.log(`Mode set to '${value}'.`);
};

const cmdView = async ({ positional, flags }) => {
  const VIEWS = ['minimal', 'classic', 'full'];
  const value = positional[0];
  const prefs = readPrefs();

  if (!value) {
    console.log(`view: ${prefs.view} (options: ${VIEWS.join(' | ')})`);
    return;
  }
  if (!VIEWS.includes(value)) {
    console.log(`Unknown view '${value}'. Choose: ${VIEWS.join(' | ')}`);
    process.exit(1);
  }
  writePrefs({ ...prefs, view: value });
  if (flags.json) console.log(renderJson({ view: value }));
  else console.log(`View set to '${value}'.`);
};

const cmdLabel = async ({ positional }) => {
  const label = positional.join(' ');
  if (!label) {
    console.log('Usage: pomo label "your label"');
    return;
  }
  const state = readState();
  if (state.run_state === 'idle') {
    console.log('No active block. Label will apply on next start.');
    return;
  }
  await mutateState((s) => ({ ...s, label }));
  console.log(`Label set to "${label}".`);
};

const cmdMute = async ({ positional }) => {
  const muting = positional[0] !== 'unmute';
  const prefs = readPrefs();
  writePrefs({ ...prefs, mute: muting });
  await mutateState((s) => ({ ...s, config: { ...s.config, mute: muting } }));
  console.log(muting ? 'Muted.' : 'Unmuted.');
};

const cmdStatus = async ({ flags }) => {
  // Reconcile any overdue boundary first so status reflects reality, not a
  // phase that ended while no session was open (D-009 reconcile-on-observe).
  await reconcileAndReschedule().catch(() => {});
  const state = readState();
  const prefs = readPrefs();
  // TODO: M5 fold today's records for aggregates
  const aggregates = { completedToday: 0, focusMinToday: 0, setIndex: state.set_index };

  if (flags.json) {
    console.log(renderJson({ state, aggregates, prefs }));
  } else {
    console.log(renderStatus(state, aggregates, prefs));
  }
};

const cmdLog = async ({ flags }) => {
  // TODO: M5 — log subcommands (open, backups, --date)
  console.log('`log` is not yet fully implemented. Use --json for raw output.');
  if (flags.json) {
    console.log(renderJson({ records: [] }));
  }
};

const cmdUndo = async () => {
  // TODO: M5 — undo with dry-run/yes flow
  console.log('`undo` is not yet implemented.');
};

const cmdRestore = async () => {
  // TODO: M5 — restore from backup id
  console.log('`restore` is not yet implemented.');
};

const cmdSetup = async ({ flags }) => {
  setup(process.env, { quiet: 'quiet' in flags });
};

const cmdUninstall = async () => {
  uninstall();
};

const cmdHelp = async ({ positional }) => {
  const prefs = readPrefs();
  console.log(renderHelp(positional[0] ?? null, prefs));
};

// ---------------------------------------------------------------------------
// Dispatch table
// ---------------------------------------------------------------------------

const VERBS = {
  start: cmdStart,
  pause: cmdPause,
  resume: cmdResume,
  stop: cmdStop,
  skip: cmdSkip,
  reset: cmdReset,
  next: cmdNext,
  back: cmdBack,
  extend: cmdExtend,
  mode: cmdMode,
  view: cmdView,
  label: cmdLabel,
  mute: cmdMute,
  unmute: (ctx) => cmdMute({ ...ctx, positional: ['unmute'] }),
  status: cmdStatus,
  log: cmdLog,
  undo: cmdUndo,
  restore: cmdRestore,
  statusline: () => renderStatusline(),
  setup: cmdSetup,
  uninstall: cmdUninstall,
  help: cmdHelp,
  '--help': cmdHelp,
  '-h': cmdHelp,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export const main = async (argv) => {
  ensureDirs();

  const { positional, flags } = parseArgs(argv);
  const verb = positional[0] ?? 'help';
  const handler = VERBS[verb];

  if (!handler) {
    console.error(
      `Unknown command: '${verb}'. Run \`pomo help\` for available commands.`,
    );
    process.exit(1);
  }

  await handler({ positional: positional.slice(1), flags });
};
