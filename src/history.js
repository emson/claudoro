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
import { parseJsonl } from './derive.js';

/** Write `content` to `file` atomically (temp + rename), like the state store. */
const atomicWrite = (file, content) => {
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
};

// ---------------------------------------------------------------------------
// Append a record (called by timer verbs when a phase finalizes)
// ---------------------------------------------------------------------------

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
export const readTodayRecords = (env = process.env) =>
  readRecordsForDate(new Date().toISOString().slice(0, 10), env);

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
    const date = new Date().toISOString().slice(0, 10);
    copyFileSync(todayLog, join(backupDir, `${date}.jsonl`));
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
 * Remove the given records (cross-day).
 * Writes a backup unconditionally before mutating, then rewrites each affected
 * day file atomically. The whole operation runs under the same lock as state
 * mutations so a concurrent finalize-append can never be lost (D-007).
 * Returns the backup id.
 */
export const undoRecords = (records, env = process.env) => {
  const { lockFile } = claudoroPaths(env);
  return withLock(lockFile, () => {
    const backupId = writeBackup(env);
    const idsToRemove = new Set(records.map((r) => r.id));

    const dates = [
      ...new Set(
        records.map((r) => new Date(r.started * 1000).toISOString().slice(0, 10)),
      ),
    ];

    for (const date of dates) {
      const logFile = logFileForDate(date, env);
      const all = readRecordsForDate(date, env);
      const kept = all.filter((r) => !idsToRemove.has(r.id));
      atomicWrite(
        logFile,
        kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''),
      );
    }

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

    const backupState = join(backupDir, 'state.json');
    if (existsSync(backupState)) copyFileSync(backupState, paths.stateFile);

    // Restore any JSONL files found in the backup
    const files = readdirSync(backupDir).filter((f) => f.endsWith('.jsonl'));
    for (const f of files) {
      copyFileSync(join(backupDir, f), join(paths.logsDir, f));
    }
  });
};
