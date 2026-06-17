/**
 * M1: Atomic file locking via O_EXCL creation with retry/timeout.
 * Cross-platform (no flock binary required), pure Node stdlib.
 *
 * Stale-lock detection: if the lock file is older than STALE_AFTER_MS,
 * it is assumed to be orphaned and is cleared before retrying.
 */
import { openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const TIMEOUT_MS = 5_000;
const RETRY_MS = 50;
const STALE_AFTER_MS = 10_000;

const isStale = (lockFile) => {
  try {
    return Date.now() - statSync(lockFile).mtimeMs > STALE_AFTER_MS;
  } catch {
    return false;
  }
};

const clearStale = (lockFile) => {
  try {
    unlinkSync(lockFile);
  } catch {
    // best-effort
  }
};

/**
 * Acquire the lock at `lockFile`. Returns a release function.
 * Throws if the lock cannot be acquired within TIMEOUT_MS.
 */
export const acquireLock = async (lockFile) => {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const fd = openSync(lockFile, 'wx'); // atomic: fails with EEXIST if present
      closeSync(fd);
      return () => {
        try {
          unlinkSync(lockFile);
        } catch {
          // best-effort on release
        }
      };
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err;
      if (isStale(lockFile)) {
        clearStale(lockFile);
        continue;
      }
      await sleep(RETRY_MS);
    }
  }

  throw new Error(
    `[claudoro] Could not acquire lock at ${lockFile} after ${TIMEOUT_MS}ms. ` +
      `If a pomo command is stuck, delete the lock file and try again.`,
  );
};

/**
 * Run `fn` under the lock, then release.
 * Guarantees release even if `fn` throws.
 */
export const withLock = async (lockFile, fn) => {
  const release = await acquireLock(lockFile);
  try {
    return await fn();
  } finally {
    release();
  }
};
