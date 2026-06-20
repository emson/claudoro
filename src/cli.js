/**
 * M1: CLI entry point — arg parsing and verb dispatch.
 * Each verb is an async function that receives { positional, flags, env }.
 * Side effects (printing, process.exit) happen here; timer.js stays pure.
 */
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  ensureDirs,
  readState,
  mutateState,
  applyTransition,
  readPrefs,
  writePrefs,
} from './store.js';
import { claudoroPaths } from './platform/paths.js';
import { openPath } from './platform/open.js';
import { foldStats } from './stats.js';
import { renderStatsHtml } from './render/dashboard.js';
import * as T from './timer.js';
import {
  appendRecord,
  findLastNCompleted,
  findAllForToday,
  undoRecords,
  readTodayRecords,
  readAllRecords,
  readRangeByDay,
  listLogDates,
  listBackups,
  restoreBackup,
  ensureLogFile,
} from './history.js';
import { armAlarm, reconcileAndReschedule } from './alarm.js';
import {
  renderHelp,
  renderStatus,
  renderStats,
  renderJson,
  renderLog,
  renderLogSummary,
  renderLogRecords,
  renderBackups,
  renderUndoPlan,
  renderUndoResult,
  renderBackupList,
  renderRestoreResult,
  isTTY,
} from './output.js';
import {
  remaining,
  formatMMSS,
  nowEpoch,
  foldRecords,
  deriveCadence,
  today,
  shiftDate,
} from './derive.js';
import { appendText, addTags, parseTags, normalizeTag } from './label.js';
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
  // log range + filter selectors
  'last',
  'since',
  'until',
  'tag',
  'phase',
  'status',
  'grep',
  'max-overtime',
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
    // Overtime credited before a forgotten block is treated as abandoned (D-012).
    max_overtime: parseInt(flags['max-overtime'] ?? '30', 10),
  };
  const mode = flags.mode ?? prefs.mode; // flag > persisted > default (D-006a)

  // Derive the cycle position from records so a fresh start reflects real
  // history, never a stale counter left by undo or a hand-edited log (D-007).
  const cadence = deriveCadence(readAllRecords());

  const { changed, state } = await applyTransition((s) =>
    T.start(s, { config, mode, label, sessionId, cadence }),
  );

  if (!changed) {
    const current = readState();
    console.log(
      `A ${current.phase} block is already running (${formatMMSS(remaining(current) ?? 0)} left). ` +
        `Use \`pomo reset\` to restart it, or \`pomo stop\` to end it.`,
    );
    return;
  }

  await armAlarm();
  console.log(
    `Started ${state.config.work}min focus block${label ? ` "${label}"` : ''}. Good luck.`,
  );
};

const cmdPause = async () => {
  const { changed } = await applyTransition((s) => T.pause(s));
  if (!changed) return console.log('Nothing running to pause.');
  await armAlarm(); // disarms: the bump retires the running worker, which self-exits
  console.log('Paused.');
};

const cmdResume = async () => {
  const { changed } = await applyTransition((s) => T.resume(s));
  if (!changed) return console.log('Not paused.');
  await armAlarm();
  console.log('Resumed.');
};

const cmdToggle = async () => {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const before = readState();
  const { changed, state } = await applyTransition((s) => T.toggle(s, { nowSec, nowMs }));
  if (!changed) {
    if (before.run_state === 'idle') {
      console.log('Nothing running to toggle. Use `pomo start` to begin.');
    }
    return;
  }
  // One call handles both directions: armAlarm arms when running, disarms when
  // paused (the generation bump retires the worker either way).
  await armAlarm();
  console.log(state.run_state === 'paused' ? 'Paused.' : 'Resumed.');
};

const cmdStop = async ({ flags }) => {
  const full = flags.full === true;
  const { changed, record } = await applyTransition((s) => T.stop(s, { full }));
  if (!changed) return console.log('Nothing running.');
  await armAlarm(); // disarms
  if (record) appendRecord(record);
  if (record?.abandoned) {
    console.log(
      `Stopped. This block ran long unattended, so ${record.actual_min}min of focus was ` +
        `credited (not the full elapsed time). Use \`pomo stop --full\` to keep it all.`,
    );
  } else {
    console.log('Stopped.');
  }
};

/**
 * Force state to idle and immediately kill any detached alarm workers.
 *
 * `pomo stop` requires a running phase and goes through the normal transition path.
 * `pomo kill-all` is the escape hatch: it force-resets state regardless, then kills
 * _alarm-worker.js processes by name so they don't linger for up to POLL_MS (30 s).
 * Use when `pkill -f pomo` left orphaned workers behind (workers have no "pomo" in
 * their argv, so the name filter misses them).
 */
const cmdKillAll = async () => {
  const prev = await mutateState((s) => ({
    ...s,
    run_state: 'idle',
    phase: null,
    alarm_pid: null,
    alarms_fired: [],
    back_checkpoint: null,
    alarm_seq: (s.alarm_seq ?? 0) + 1,
  }));
  const wasRunning = prev.run_state !== 'idle';

  // Hard-kill surviving alarm workers by script name (cross-platform where supported).
  let killed = 0;
  if (process.platform !== 'win32') {
    const result = spawnSync('pkill', ['-f', '_alarm-worker.js'], { encoding: 'utf8' });
    // pkill exit 0 = matched, 1 = no match, other = error; we treat both 0 and 1 as OK
    if (result.status === 0) killed = 1; // pkill doesn't give a count; signal success
  }

  const stateMsg = wasRunning ? 'Timer stopped.' : 'No timer was running.';
  const workerMsg = killed ? ' Alarm workers killed.' : ' No alarm workers found.';
  console.log(stateMsg + workerMsg);
};

const cmdSkip = async () => {
  const { changed, state, record } = await applyTransition((s) => T.skip(s));
  if (!changed) return console.log('Nothing running to skip.');
  if (record) appendRecord(record);
  await armAlarm();
  console.log(`Skipped. Next: ${state.phase ?? 'idle'}.`);
};

const cmdReset = async () => {
  const { changed, state } = await applyTransition((s) => T.reset(s));
  if (!changed) return console.log('Nothing running to reset.');
  await armAlarm();
  console.log(`Reset. ${formatMMSS(state.planned_min * 60)} on the clock.`);
};

const cmdNext = async ({ flags }) => {
  const now = nowEpoch();
  const full = flags.full === true;
  const { changed, state, record } = await applyTransition((s) =>
    T.next(s, { nowSec: now, full }),
  );
  if (!changed) {
    return console.log('Not at a waiting boundary. Use `pomo skip` to advance early.');
  }
  if (record) appendRecord(record);
  await armAlarm();
  console.log(`Advanced to ${(state.phase ?? 'idle').replace('_', ' ')}.`);
};

const cmdBack = async () => {
  const now = nowEpoch();
  const before = readState();
  const result = T.back(before, { nowSec: now });

  if (!result.ok) {
    if (result.reason === 'none') {
      console.log('Nothing to undo. `back` only reverses the last phase transition.');
    } else {
      console.log(
        `Back window closed (${result.windowSec}s; ${result.sinceSec}s have elapsed). ` +
          `Use \`pomo start\` to begin a new block.`,
      );
    }
    return;
  }

  // Remove the auto-completed log record BEFORE restoring state (D-007): the
  // backup inside undoRecords then captures the post-transition state, so a
  // later `pomo restore` reproduces the moment just before the user ran `back`.
  // undoRecords only uses r.id and r.started from each record; the pre-transition
  // state's `started` field is the exact started epoch of the phase that was
  // finalized, so this stub is sufficient.
  if (result.removeRecordId) {
    undoRecords([
      {
        id: result.removeRecordId,
        started: before.back_checkpoint.state.started,
      },
    ]);
  }

  // Restore the pre-transition state under the lock. Re-read inside the mutation
  // and guard on transition_epoch so two racing `back`s cannot double-restore.
  let applied = false;
  const restored = await mutateState((s) => {
    if (
      !s.back_checkpoint ||
      s.back_checkpoint.transition_epoch !== before.back_checkpoint.transition_epoch
    ) {
      return s; // state moved on or another session already backed out
    }
    applied = true;
    // Keep the LIVE alarm generation, never the (older) one in the snapshot:
    // alarm_seq is alarm bookkeeping, not timer state, and must stay monotonic
    // so the worker for the now-undone phase is reliably superseded (D-009).
    return { ...result.state, alarm_seq: s.alarm_seq };
  });

  if (!applied) {
    console.log('Nothing to undo (state changed since you ran back).');
    return;
  }

  // Arm the restored phase. The bump retires the worker for the undone phase;
  // the restored alarms_fired carries over from the pre-transition snapshot, so
  // if the end cue already fired it will not re-fire (cuesDue finds it claimed).
  await armAlarm();

  const remSec = remaining(restored, now) ?? 0;
  console.log(
    `Back to ${(restored.phase ?? 'idle').replace('_', ' ')} (${formatMMSS(remSec)} left).`,
  );
};

const cmdExtend = async ({ positional, flags }) => {
  const minutes = parseInt(positional[0] ?? flags.minutes ?? '5', 10);
  const { changed } = await applyTransition((s) => T.extend(s, { minutes }));
  if (!changed) return console.log('Nothing running to extend.');
  // The end moved, so re-arm: the bump retires the worker bound to the old
  // deadline and spawns one bound to the new one.
  await armAlarm();
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

// `label` OVERWRITES the current label (replace semantics, the original
// behaviour): `pomo label "x"` sets it to exactly "x". An empty arg or --clear
// empties it. For additive use, see `cmdNote`; for #tags, see `cmdTag`.
const cmdLabel = async ({ positional, flags }) => {
  const text = positional.join(' ').trim();
  const state = readState();
  if (state.run_state === 'idle') {
    console.log('No active block. Start one first with `pomo start`.');
    return;
  }

  // `pomo label` with no args at all is a usage hint, not an accidental clear.
  if (positional.length === 0 && !flags.clear) {
    console.log('Usage: pomo label "text"   ("" or --clear empties; note appends)');
    return;
  }

  if (flags.clear || text === '') {
    await mutateState((s) => ({ ...s, label: null }));
    console.log('Label cleared.');
    return;
  }

  await mutateState((s) => ({ ...s, label: text }));
  console.log(`Label set to "${text}".`);
};

// `note` is additive by default: it APPENDS to the current label (prose or
// quoted #tags). --set overwrites, --clear empties. For replace semantics use
// `cmdLabel`; tag-aware sugar lives in `cmdTag`.
const cmdNote = async ({ positional, flags }) => {
  const text = positional.join(' ').trim();
  const state = readState();
  if (state.run_state === 'idle') {
    console.log('No active block. Start one first with `pomo start`.');
    return;
  }

  if (flags.clear) {
    await mutateState((s) => ({ ...s, label: null }));
    console.log('Label cleared.');
    return;
  }

  if (flags.set) {
    await mutateState((s) => ({ ...s, label: text || null }));
    console.log(text ? `Label set to "${text}".` : 'Label cleared.');
    return;
  }

  if (!text) {
    console.log('Usage: pomo note "text"   (--set overwrites, --clear empties)');
    return;
  }

  const updated = await mutateState((s) => ({ ...s, label: appendText(s.label, text) }));
  console.log(`Label: "${updated.label}".`);
};

// `tag` adds one or more #tags to the current label: quote-free (no shell-`#`
// footgun), normalised to #kebab-case, and deduped against tags already present.
const cmdTag = async ({ positional }) => {
  const state = readState();
  if (state.run_state === 'idle') {
    console.log('No active block. Start one first with `pomo start`.');
    return;
  }
  if (positional.length === 0) {
    console.log('Usage: pomo tag <name> [name...]   (e.g. pomo tag review project-x)');
    return;
  }

  let added = [];
  const updated = await mutateState((s) => {
    const result = addTags(s.label, positional);
    added = result.added;
    return { ...s, label: result.label };
  });
  if (added.length === 0) {
    console.log('Already tagged; nothing added.');
    return;
  }
  console.log(`Tagged ${added.join(' ')} -> "${updated.label}".`);
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
  const records = readTodayRecords();
  const folded = foldRecords(records);
  const aggregates = {
    completedToday: folded.completedToday,
    focusMinToday: folded.focusMinToday,
    setIndex: state.set_index, // live state is authoritative for in-flight cycle position
    setNumber: state.set_number,
    frequency: state.config?.frequency ?? 4,
  };

  if (flags.json) {
    console.log(renderJson({ state, aggregates, prefs }));
  } else {
    console.log(renderStatus(state, aggregates, prefs));
  }
};

/**
 * Derived analytics over the whole record set (M9/D-011). One fold, three
 * surfaces: terminal panel (default), `--web` HTML dashboard, `--json` payload.
 * `deps.open` is injectable so tests can assert the path-printing branch.
 */
export const cmdStats = async ({ flags }, deps = { open: openPath }) => {
  const now = nowEpoch();
  const payload = foldStats(readAllRecords(), now);
  const generatedAt = new Date(now * 1000).toISOString();

  if (flags.json) {
    console.log(renderJson({ ...payload, generatedAt }));
    return;
  }

  if (flags.web) {
    const { dashboardFile } = claudoroPaths();
    writeFileSync(dashboardFile, renderStatsHtml(payload, { generatedAt }), 'utf8');
    const opened = deps.open(dashboardFile);
    console.log(
      opened
        ? `Dashboard opened in your browser:\n  ${dashboardFile}`
        : `Dashboard written. Open it in a browser:\n  ${dashboardFile}`,
    );
    return;
  }

  console.log(renderStats(payload));
};

// ISO date validation pattern
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const badDate = (d) => {
  console.error(`Invalid date '${d}'. Expected YYYY-MM-DD.`);
  process.exit(1);
};

/**
 * Resolve the range-selector flags to an inclusive [since, until] pair.
 * At most one selector may be set; conflicts and bad input exit(1). Defaults to
 * today. ISO date strings compare chronologically, so since <= until is lexical.
 * @param {object} flags
 * @returns {{ since: string, until: string }}
 */
const resolveRange = (flags) => {
  const t = today();
  const selectors = [
    flags.today === true,
    flags.date != null,
    flags.last != null,
    flags.all === true,
    flags.since != null || flags.until != null,
  ].filter(Boolean).length;
  if (selectors > 1) {
    console.error(
      'Choose one range: --today | --date DATE | --last N | --since/--until | --all.',
    );
    process.exit(1);
  }

  if (flags.all === true) {
    const dates = listLogDates();
    return { since: dates[0] ?? t, until: t };
  }
  if (flags.date != null) {
    if (!ISO_DATE.test(flags.date)) badDate(flags.date);
    return { since: flags.date, until: flags.date };
  }
  if (flags.last != null) {
    const n = parseInt(flags.last, 10);
    if (!Number.isInteger(n) || n < 1 || String(n) !== String(flags.last)) {
      console.error('Usage: pomo log --last N   (N is a whole number >= 1)');
      process.exit(1);
    }
    return { since: shiftDate(t, -(n - 1)), until: t };
  }
  if (flags.since != null || flags.until != null) {
    const since = flags.since ?? t;
    const until = flags.until ?? t;
    if (!ISO_DATE.test(since)) badDate(since);
    if (!ISO_DATE.test(until)) badDate(until);
    if (since > until) {
      console.error(`--since ${since} is after --until ${until}.`);
      process.exit(1);
    }
    return { since, until };
  }
  return { since: t, until: t }; // default + --today
};

/** Narrow a record set by the filter flags (all compose, AND). */
const applyFilters = (records, flags) => {
  let out = records;
  if (flags.tag != null) {
    const want = normalizeTag(flags.tag);
    out = out.filter((r) => want != null && parseTags(r.label).includes(want));
  }
  if (flags.focus === true) out = out.filter((r) => r.phase === 'focus');
  if (typeof flags.phase === 'string') out = out.filter((r) => r.phase === flags.phase);
  if (typeof flags.status === 'string')
    out = out.filter((r) => r.status === flags.status);
  if (typeof flags.grep === 'string') {
    const q = flags.grep.toLowerCase();
    out = out.filter((r) => (r.label ?? '').toLowerCase().includes(q));
  }
  return out;
};

/**
 * List history. Default is today (record listing); range selectors widen it.
 * Single day -> record listing; multi-day -> per-day summary, or full records
 * with --records; --json always returns the flat filtered record array (the
 * dashboard's feed). Filters (--tag/--focus/--phase/--status/--grep) compose.
 */
const logList = async (flags) => {
  const { since, until } = resolveRange(flags);

  const groups = readRangeByDay(since, until)
    .map((g) => ({ date: g.date, records: applyFilters(g.records, flags) }))
    .filter((g) => g.records.length > 0);
  const flat = groups.flatMap((g) => g.records);

  if (flags.json) {
    console.log(renderJson({ since, until, records: flat }));
    return;
  }

  if (since === until) {
    const aggregates = foldRecords(flat, since);
    console.log(renderLog(since, flat, aggregates));
    return;
  }

  console.log(
    flags.records ? renderLogRecords(groups) : renderLogSummary(groups, since, until),
  );
};

/** List available backups. */
const logBackups = async (flags) => {
  const backups = listBackups();
  if (flags.json) {
    console.log(renderJson({ backups }));
  } else {
    console.log(renderBackups(backups));
  }
};

/** Open today's log file in $EDITOR or print the path. */
const logOpen = async (flags) => {
  const file = ensureLogFile();
  const editor = process.env.VISUAL || process.env.EDITOR;

  if (flags.json) {
    console.log(renderJson({ path: file, editor: editor ?? null }));
    return;
  }

  if (!editor) {
    console.log(file);
    return;
  }

  // Attach the editor to the current TTY and wait for it to close.
  const child = spawn(editor, [file], { stdio: 'inherit' });
  await new Promise((resolve) => child.on('close', resolve));
};

const cmdLog = async ({ positional, flags }) => {
  const sub = positional[0];
  if (sub === 'open') return logOpen(flags);
  if (sub === 'backups') return logBackups(flags);
  return logList(flags);
};

/**
 * Ask a yes/no question on the TTY. Resolves true only on an explicit
 * y/yes (case-insensitive). Default is No.
 * @param {string} question
 * @returns {Promise<boolean>}
 */
const promptYN = (question) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });

/**
 * Parse the N argument for `pomo undo [N]`. Returns a valid positive integer
 * or throws with a usage message via process.exit(1).
 * @param {string|undefined} raw
 * @returns {number}
 */
const parseUndoCount = (raw) => {
  if (raw === undefined) return 1;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || String(n) !== raw) {
    console.error('Usage: pomo undo [N] [--dry-run] [--yes]');
    process.exit(1);
  }
  return n;
};

export const cmdUndo = async (
  { positional, flags },
  deps = {
    findLastNCompleted,
    findAllForToday,
    undoRecords,
    prompt: promptYN,
    tty: isTTY,
  },
) => {
  const today = flags.today === true;
  const n = today ? 0 : parseUndoCount(positional[0]);
  const records = today ? deps.findAllForToday() : deps.findLastNCompleted(n);

  if (records.length === 0) {
    if (flags.json) {
      console.log(
        renderJson({
          removed: [],
          requested: today ? null : n,
          available: 0,
          backupId: null,
          today,
        }),
      );
    } else {
      console.log(
        today ? 'No records for today to remove.' : 'No completed focus records to undo.',
      );
    }
    return;
  }

  if (!today && records.length < n) {
    console.log(
      `Only ${records.length} of ${n} requested records are available. Proceeding with ${records.length}.`,
    );
  }

  if (flags['dry-run']) {
    if (flags.json) {
      console.log(
        renderJson({
          removed: records,
          requested: today ? null : n,
          available: records.length,
          backupId: null,
          dryRun: true,
          today,
        }),
      );
    } else {
      console.log(renderUndoPlan(records, n, { today }));
      console.log('Run with --yes to remove these records.');
    }
    return;
  }

  const yes = flags.yes === true;
  const confirmCmd = today ? 'pomo undo --today --yes' : `pomo undo ${n} --yes`;

  if (!yes) {
    // No TTY to prompt on (e.g. the /pomo slash command runs the CLI via Bash
    // command substitution). Degrade safely to a dry-run: show the plan, mutate
    // nothing, and tell the caller how to confirm. Exit 0 — refusing to delete
    // unattended is the correct, successful outcome, not a failure (D-007).
    if (!deps.tty()) {
      if (flags.json) {
        console.log(
          renderJson({
            removed: records,
            requested: today ? null : n,
            available: records.length,
            backupId: null,
            dryRun: true,
            today,
            needsConfirm: true,
          }),
        );
      } else {
        console.log(renderUndoPlan(records, n, { today }));
        console.log(`Nothing removed. Re-run with --yes to confirm: ${confirmCmd}`);
      }
      return;
    }
    console.log(renderUndoPlan(records, n, { today }));
    const ok = await deps.prompt(`Remove ${records.length} record(s)? [y/N]:`);
    if (!ok) {
      console.log('Cancelled. Nothing was removed.');
      return;
    }
  }

  const backupId = await deps.undoRecords(records);

  if (flags.json) {
    console.log(
      renderJson({
        removed: records,
        requested: today ? null : n,
        available: records.length,
        backupId,
        dryRun: false,
        today,
      }),
    );
  } else {
    console.log(renderUndoResult(records, backupId));
  }
};

const cmdRestore = async (
  { positional, flags },
  deps = { listBackups, restoreBackup, prompt: promptYN, tty: isTTY },
) => {
  const id = positional[0] ?? null;

  if (!id) {
    const backups = deps.listBackups();
    if (flags.json) {
      console.log(renderJson({ backups }));
    } else {
      console.log(renderBackupList(backups));
    }
    return;
  }

  const yes = flags.yes === true;

  if (!yes && deps.tty()) {
    const ok = await deps.prompt(
      `Restore from ${id}? Your current state will be backed up first. [y/N]:`,
    );
    if (!ok) {
      console.log('Cancelled. Nothing was restored.');
      return;
    }
  }

  try {
    await deps.restoreBackup(id);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    console.error('Run `pomo log backups` to list available backups.');
    process.exit(1);
  }

  // Arm the restored phase so a detached worker drives it (and any worker from
  // the pre-restore timer is superseded by the generation bump). restoreBackup
  // already kept alarm_seq monotonic, so this never collides with a live worker.
  await armAlarm();

  if (flags.json) {
    console.log(renderJson({ restored: id }));
  } else {
    console.log(renderRestoreResult(id));
  }
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
  toggle: cmdToggle,
  stop: cmdStop,
  'kill-all': cmdKillAll,
  skip: cmdSkip,
  reset: cmdReset,
  next: cmdNext,
  back: cmdBack,
  extend: cmdExtend,
  mode: cmdMode,
  view: cmdView,
  note: cmdNote,
  tag: cmdTag,
  label: cmdLabel, // overwrite (replace); `note` is the additive sibling
  mute: cmdMute,
  unmute: (ctx) => cmdMute({ ...ctx, positional: ['unmute'] }),
  status: cmdStatus,
  stats: cmdStats,
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
