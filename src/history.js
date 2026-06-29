/**
 * M5: History, undo, restore, and backups.
 *
 * Immutable records are stored as JSONL (one line per finished phase).
 * Aggregates are always re-derived from records — never stored (D-007).
 * Destructive ops always write a timestamped backup first (mandatory, unconditional).
 */
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { claudoroPaths, logFileForDate, todayLogFile } from './platform/paths.js';
import { withLock } from './platform/lock.js';
import { parseJsonl, deriveCadence, today, dateOf } from './derive.js';
import { readState, writeState } from './store-read.js';

/** Write `content` to `file` atomically (temp + rename), like the state store. */
const atomicWrite = (file, content) => {
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
};

// ---------------------------------------------------------------------------
// Append a record (called by timer verbs when a phase finalizes)
// ---------------------------------------------------------------------------

/**
 * Ensure today's log file exists (creates an empty file if absent).
 * Returns the resolved path. Safe to call repeatedly (idempotent).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export const ensureLogFile = (env = process.env) => {
  const file = todayLogFile(env);
  const { logsDir } = claudoroPaths(env);
  mkdirSync(logsDir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, '', 'utf8');
  return file;
};

/** Append one PhaseRecord to today's JSONL log. */
export const appendRecord = (record, env = process.env) => {
  const logFile = todayLogFile(env);
  const { logsDir } = claudoroPaths(env);
  mkdirSync(logsDir, { recursive: true });
  appendFileSync(logFile, JSON.stringify(record) + '\n', 'utf8');
};

// ---------------------------------------------------------------------------
// Read records
// ---------------------------------------------------------------------------

/** Read all records for a given date. Returns [] if file missing or unparseable. */
export const readRecordsForDate = (date, env = process.env) => {
  const logFile = logFileForDate(date, env);
  try {
    return parseJsonl(readFileSync(logFile, 'utf8'));
  } catch {
    return [];
  }
};

/** Read today's records. */
export const readTodayRecords = (env = process.env) => readRecordsForDate(today(), env);

/**
 * Read every record across all day files in chronological order.
 * Cold path only (used to re-derive the cadence cache after a record mutation);
 * never called on the per-tick render path.
 */
export const readAllRecords = (env = process.env) =>
  listLogDates(env).flatMap((date) => readRecordsForDate(date, env));

/**
 * Re-derive the cadence cache (`set_index`/`set_number`) from records and
 * persist it into state.json. Keeps the cheap renderer correct-by-construction
 * after any operation that changes records (D-007).
 *
 * Must be called by a caller that ALREADY holds the lock (withLock is not
 * reentrant): it reads + writes state directly without acquiring it again.
 * @param {NodeJS.ProcessEnv} [env]
 */
const refreshCadenceLocked = (env = process.env) => {
  const { setIndex, setNumber } = deriveCadence(readAllRecords(env));
  const state = readState(env);
  writeState({ ...state, set_index: setIndex, set_number: setNumber }, env);
};

/**
 * Read records grouped by day across an inclusive [since, until] ISO date range.
 * Reads only files that actually exist (intersects the range with listLogDates),
 * so an enormous range never iterates empty calendar days. Ascending by date;
 * days with no records are omitted. ISO date strings sort chronologically, so
 * lexical comparison is the range test.
 * @param {string} since 'YYYY-MM-DD'
 * @param {string} until 'YYYY-MM-DD'
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ date: string, records: object[] }[]}
 */
export const readRangeByDay = (since, until, env = process.env) =>
  listLogDates(env)
    .filter((date) => date >= since && date <= until)
    .map((date) => ({ date, records: readRecordsForDate(date, env) }))
    .filter((group) => group.records.length > 0);

/** List all available log dates (sorted ascending). */
export const listLogDates = (env = process.env) => {
  const { logsDir } = claudoroPaths(env);
  try {
    return readdirSync(logsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.replace('.jsonl', ''))
      .sort();
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

const KEEP_BACKUPS = 20;

/** Write a timestamped backup of today's log + state.json. Returns the backup id. */
export const writeBackup = (env = process.env) => {
  const paths = claudoroPaths(env);
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(paths.backupsDir, id);
  mkdirSync(backupDir, { recursive: true });

  // Back up state.json
  if (existsSync(paths.stateFile)) {
    copyFileSync(paths.stateFile, join(backupDir, 'state.json'));
  }

  // Back up today's log
  const todayLog = todayLogFile(env);
  if (existsSync(todayLog)) {
    copyFileSync(todayLog, join(backupDir, `${today()}.jsonl`));
  }

  pruneBackups(paths.backupsDir);
  return id;
};

const pruneBackups = (backupsDir) => {
  try {
    const entries = readdirSync(backupsDir).sort(); // ids sort chronologically
    for (const old of entries.slice(0, Math.max(0, entries.length - KEEP_BACKUPS))) {
      rmSync(join(backupsDir, old), { recursive: true, force: true });
    }
  } catch {
    // best-effort; never fail a backup because pruning hiccuped
  }
};

/** List available backup ids (sorted descending — most recent first). */
export const listBackups = (env = process.env) => {
  const { backupsDir } = claudoroPaths(env);
  try {
    return readdirSync(backupsDir).sort().reverse();
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * Identify the last N completed focus records (cross-day, most recent first).
 * Used by undo --dry-run and undo --yes.
 */
export const findLastNCompleted = (n = 1, env = process.env) => {
  const dates = listLogDates(env).reverse(); // newest first
  const found = [];

  for (const date of dates) {
    if (found.length >= n) break;
    const records = readRecordsForDate(date, env);
    const completed = records
      .filter((r) => r.status === 'completed' && r.phase === 'focus')
      .reverse(); // most recent first within the day
    found.push(...completed.slice(0, n - found.length));
  }

  return found;
};

/**
 * Identify every record for today (any phase, any status), most recent first.
 * Used by `undo --today` to wipe a single day's history in one operation.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {object[]}
 */
export const findAllForToday = (env = process.env) =>
  readRecordsForDate(today(), env).slice().reverse();

/**
 * Remove the given records (cross-day).
 * Writes a backup unconditionally before mutating, then rewrites each affected
 * day file atomically. Runs under the shared lock, so it is serialized against
 * state mutations and other undo/restore calls. Note: `appendRecord` is a
 * lock-free atomic O_APPEND (records are well under PIPE_BUF), so a finalize that
 * lands between this read and rewrite could be dropped; that race is accepted
 * because finalize-appends are sparse and undo is interactive (the unconditional
 * backup also bounds the blast radius).
 * Returns the backup id.
 */
export const undoRecords = (records, env = process.env) => {
  const { lockFile } = claudoroPaths(env);
  return withLock(lockFile, () => {
    const backupId = writeBackup(env);
    const idsToRemove = new Set(records.map((r) => r.id));

    const dates = [...new Set(records.map((r) => dateOf(r.started)))];

    for (const date of dates) {
      const logFile = logFileForDate(date, env);
      const all = readRecordsForDate(date, env);
      const kept = all.filter((r) => !idsToRemove.has(r.id));
      atomicWrite(
        logFile,
        kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''),
      );
    }

    // Records changed: re-derive the cycle position so the dots can never show a
    // stale count (the undo-then-start bug). Same lock, so no extra round-trip.
    refreshCadenceLocked(env);

    return backupId;
  });
};

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/** Restore state + day logs from a backup (locked; safety-backs-up current first). */
export const restoreBackup = (backupId, env = process.env) => {
  const paths = claudoroPaths(env);
  const backupDir = join(paths.backupsDir, backupId);

  if (!existsSync(backupDir)) {
    throw new Error(
      `Backup '${backupId}' not found. Run \`pomo log backups\` to list available.`,
    );
  }

  return withLock(paths.lockFile, () => {
    // Write a safety backup of the current state before restoring
    writeBackup(env);

    // The alarm generation must never go backward: a backup carries an old
    // alarm_seq (and a long-dead alarm_pid), but a worker from the CURRENT timer
    // may still be alive. Capture the live generation, restore the file, then
    // re-base alarm_seq above both so the next armAlarm reliably supersedes any
    // live worker (D-009). alarm_pid is cleared (it is diagnostic only).
    const liveSeq = readState(env).alarm_seq ?? 0;

    const backupState = join(backupDir, 'state.json');
    if (existsSync(backupState)) copyFileSync(backupState, paths.stateFile);

    const restored = readState(env);
    writeState(
      {
        ...restored,
        alarm_seq: Math.max(liveSeq, restored.alarm_seq ?? 0),
        alarm_pid: null,
      },
      env,
    );

    // Restore any JSONL files found in the backup
    const files = readdirSync(backupDir).filter((f) => f.endsWith('.jsonl'));
    for (const f of files) {
      copyFileSync(join(backupDir, f), join(paths.logsDir, f));
    }

    // The restored state.json and logs were consistent at backup time; re-derive
    // anyway so the cache is correct even if other day files moved on meanwhile.
    refreshCadenceLocked(env);
  });
};
