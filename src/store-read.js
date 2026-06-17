/**
 * M1: Lock-free state/prefs I/O — the status-line hot path imports ONLY this.
 *
 * Kept separate from store.js so the per-second renderer never transitively
 * loads the lock module (node:timers/promises etc). Reads never lock; writes
 * here are atomic temp+rename but expect the caller to already hold the lock
 * when mutating shared state (see store.mutateState / store.applyTransition).
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { claudoroPaths } from './platform/paths.js';

export const SCHEMA_VERSION = 1;

export const IDLE_STATE = Object.freeze({
  schema: SCHEMA_VERSION,
  run_state: 'idle',
  phase: null,
  started: null,
  end_epoch: null,
  planned_min: null,
  paused_at: null,
  paused_total_sec: 0,
  mode: 'auto',
  label: null,
  set_number: 1,
  set_index: 0,
  current_record_id: null,
  owner_session: null,
  alarms_fired: [],
  alarm_pid: null,
  back_checkpoint: null,
  config: {
    work: 25,
    short: 5,
    long: 15,
    frequency: 4,
    notify: 1,
    mute: false,
    back_window: 120,
  },
});

export const DEFAULT_PREFS = Object.freeze({
  view: 'classic',
  mode: 'auto',
  passthrough: 'model,context,git',
  motion: 'full',
  mute: false,
});

/** Ensure all required directories exist (mode 0700). */
export const ensureDirs = (env = process.env) => {
  const paths = claudoroPaths(env);
  for (const dir of [paths.stateDir, paths.logsDir, paths.backupsDir, paths.configDir]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
};

/**
 * Read state.json without locking (safe for the render hot path).
 * Returns IDLE_STATE if missing; quarantines and reinitializes if corrupt.
 */
export const readState = (env = process.env) => {
  const { stateFile, stateDir } = claudoroPaths(env);
  let raw;
  try {
    raw = readFileSync(stateFile, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT')
      return { ...IDLE_STATE };
    throw err;
  }

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
    return parsed;
  } catch {
    // Quarantine corrupt file; never crash the status-line render
    const quarantine = join(stateDir, `.state.json.corrupt-${Date.now()}`);
    try {
      renameSync(stateFile, quarantine);
    } catch {
      // if we can't even move it aside, fall through and reinitialize anyway
    }
    console.warn(
      `[claudoro] state.json was corrupt and has been quarantined (${quarantine}). ` +
        `Reinitializing. Use \`pomo restore\` to recover if needed.`,
    );
    return { ...IDLE_STATE };
  }
};

/**
 * Write state atomically via temp file + rename.
 * Never call this directly inside a verb — use store.mutateState() to also hold the lock.
 */
export const writeState = (state, env = process.env) => {
  const { stateDir, stateFile } = claudoroPaths(env);
  const tmp = join(stateDir, `.state.json.tmp.${process.pid}`);
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  renameSync(tmp, stateFile);
};

export const readPrefs = (env = process.env) => {
  const { prefsFile } = claudoroPaths(env);
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(readFileSync(prefsFile, 'utf8')) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
};

export const writePrefs = (prefs, env = process.env) => {
  const { configDir, prefsFile } = claudoroPaths(env);
  mkdirSync(configDir, { recursive: true });
  const tmp = `${prefsFile}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(prefs, null, 2) + '\n', 'utf8');
  renameSync(tmp, prefsFile);
};
