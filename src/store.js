/**
 * M1: Locked, atomic state mutation.
 *
 * The lock-free reads/writes live in store-read.js (which the status-line hot
 * path imports directly, to avoid loading the lock module per tick). This file
 * adds the serialized read-modify-write paths and re-exports the read layer so
 * existing `import … from './store.js'` call sites keep working.
 *
 * All mutating ops go through withLock to serialize concurrent pomo invocations.
 */
import { claudoroPaths } from './platform/paths.js';
import { withLock } from './platform/lock.js';
import { readState, writeState } from './store-read.js';

export {
  SCHEMA_VERSION,
  IDLE_STATE,
  DEFAULT_PREFS,
  ensureDirs,
  readState,
  writeState,
  readPrefs,
  writePrefs,
} from './store-read.js';

/**
 * Read-modify-write under the lock.
 * `fn` receives the current state and must return the next state.
 */
export const mutateState = (fn, env = process.env) => {
  const { lockFile } = claudoroPaths(env);
  return withLock(lockFile, () => {
    const current = readState(env);
    const next = fn(current);
    writeState(next, env);
    return next;
  });
};

/**
 * Apply a pure timer transition under the lock.
 *
 * `transition` is a function (state) => ({ state, record? }) | null, where null
 * means "no-op" (e.g. pause when idle). Returning an explicit result frees the
 * caller from re-inspecting state to guess what happened — side effects
 * (schedule alarm, append record, print message) key off `changed` instead.
 *
 * @returns {Promise<{ changed: boolean, state: object, prev: object, record?: object }>}
 */
export const applyTransition = (transition, env = process.env) => {
  const { lockFile } = claudoroPaths(env);
  return withLock(lockFile, () => {
    const current = readState(env);
    const result = transition(current);
    if (result == null) return { changed: false, state: current, prev: current };
    writeState(result.state, env);
    return { changed: true, state: result.state, prev: current, record: result.record };
  });
};
