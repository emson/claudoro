/**
 * M1: Pure aggregate derivation.
 * Aggregates are always folded from immutable records — never stored as counters.
 * This is the invariant that makes undo/restore correct by construction (D-007).
 *
 * All functions are pure: same inputs, same output, no side effects.
 */

// ---------------------------------------------------------------------------
// Time math
// ---------------------------------------------------------------------------

/** Seconds remaining in the current phase. Returns null when idle. */
export const remaining = (state, nowSec = nowEpoch()) => {
  if (state.run_state === 'idle') return null;
  if (state.run_state === 'paused') {
    return Math.max(0, state.end_epoch - state.paused_at);
  }
  return Math.max(0, state.end_epoch - nowSec);
};

/** True if the phase has run past its end_epoch while still 'running'. */
export const isOvertime = (state, nowSec = nowEpoch()) =>
  state.run_state === 'running' && nowSec > state.end_epoch;

/** Seconds over time (0 when not overtime). */
export const overtimeSec = (state, nowSec = nowEpoch()) =>
  isOvertime(state, nowSec) ? nowSec - state.end_epoch : 0;

/**
 * Which alarm cues are due-and-unclaimed right now. Pure and dependency-free,
 * so the status-line hot path can call it without importing the alarm module
 * (keeping the per-tick require graph minimal — D-005).
 *
 * @returns {Array<'warning'|'end'>}
 */
export const cuesDue = (state, nowSec = nowEpoch()) => {
  if (state.run_state !== 'running') return [];
  const fired = state.alarms_fired ?? [];
  const warnAt = state.end_epoch - (state.config?.notify ?? 1) * 60;
  /** @type {Array<'warning'|'end'>} */
  const due = [];
  if (nowSec >= warnAt && !fired.includes('warning')) due.push('warning');
  if (nowSec >= state.end_epoch && !fired.includes('end')) due.push('end');
  return due;
};

/** Zero-padded MM:SS string. Never reflowing (always 5 chars). */
export const formatMMSS = (totalSec) => {
  const s = Math.abs(Math.round(totalSec));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

/** Current time as integer epoch seconds. Centralised so tests can override. */
export const nowEpoch = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

/**
 * Given the current phase and how many focus blocks have run in the current set,
 * return the next phase.
 */
export const nextPhase = (currentPhase, setIndex, frequency) => {
  if (currentPhase !== 'focus') return 'focus';
  return setIndex % frequency === 0 ? 'long_break' : 'short_break';
};

/** True when `setIndex` focus blocks have completed and a long break is due. */
export const isLongBreakDue = (setIndex, frequency) =>
  setIndex > 0 && setIndex % frequency === 0;

/** Duration in minutes for the next phase transition. */
export const phaseDuration = (phase, config) => {
  if (phase === 'focus') return config.work;
  if (phase === 'long_break') return config.long;
  return config.short;
};

// ---------------------------------------------------------------------------
// Record folding
// ---------------------------------------------------------------------------

/**
 * Parse a JSONL string into an array of records.
 * Skips unparseable lines (crash-safe append resilience).
 */
export const parseJsonl = (raw) =>
  raw
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });

/**
 * Fold an array of PhaseRecords into derived aggregates.
 * Used by `pomo status`, `pomo log`, and after every undo/restore.
 *
 * @param {object[]} records - All records in chronological order
 * @param {string} today - ISO date string 'YYYY-MM-DD'
 * @returns {{ completedToday: number, focusMinToday: number, setIndex: number, setNumber: number }}
 */
export const foldRecords = (records, today = new Date().toISOString().slice(0, 10)) => {
  let completedToday = 0;
  let focusMinToday = 0;
  let setIndex = 0;
  let setNumber = 1;

  for (const r of records) {
    if (r.status !== 'completed' || r.phase !== 'focus') continue;

    const frequency = r.config_snapshot?.frequency ?? 4;
    setIndex += 1;
    if (setIndex > frequency) {
      setIndex = 1;
      setNumber += 1;
    }

    const day = epochToDate(r.started);
    if (day === today) {
      completedToday += 1;
      focusMinToday += r.actual_min ?? r.planned_min ?? 0;
    }
  }

  return { completedToday, focusMinToday, setIndex, setNumber };
};

/**
 * Replay the cadence over records to derive the cycle position cache
 * (`set_index`, `set_number`). This is the authoritative source for the dots:
 * `state.set_index`/`set_number` are only a cache of this, refreshed at every
 * mutation so the per-tick renderer never has to fold history (D-007).
 *
 * It mirrors `advanceTo` exactly, so the cache it produces matches the forward
 * path: every focus that advanced the cycle (completed or skipped) bumps the
 * index; a long break that ended (completed or skipped) closes the set; aborted
 * phases never advanced, so they are ignored. Robust to undo by construction:
 * remove records, re-fold, and the position is correct.
 *
 * @param {object[]} records - All records in chronological order
 * @returns {{ setIndex: number, setNumber: number }}
 */
export const deriveCadence = (records) => {
  let setIndex = 0;
  let setNumber = 1;

  for (const r of records) {
    if (r.status !== 'completed' && r.status !== 'skipped') continue;
    if (r.phase === 'focus') {
      setIndex += 1;
    } else if (r.phase === 'long_break') {
      setIndex = 0;
      setNumber += 1;
    }
    // short_break: a pause in the run, never moves the cycle position
  }

  return { setIndex, setNumber };
};

// ---------------------------------------------------------------------------
// Date-bucket helpers
// ---------------------------------------------------------------------------
// These derive the calendar day in UTC, matching how log files are named
// (todayLogFile). Range reads stay aligned with writes by sharing this. The
// known quirk is that "today" is UTC, not local; fixing it is a one-line change
// here plus the matching todayLogFile, tracked as a follow-up.

/** Today's date bucket 'YYYY-MM-DD' (UTC, matching log file names). */
export const today = () => new Date().toISOString().slice(0, 10);

/** The date bucket for an epoch-seconds timestamp. */
export const dateOf = (epochSec) => new Date(epochSec * 1000).toISOString().slice(0, 10);

/**
 * Shift an ISO date by `delta` calendar days (delta may be negative).
 * Pure date arithmetic via UTC so it never drifts across DST.
 * @param {string} isoDate 'YYYY-MM-DD'
 * @param {number} delta
 * @returns {string}
 */
export const shiftDate = (isoDate, delta) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

/**
 * Totals over an arbitrary record set, with no "today" coupling (unlike
 * foldRecords). Used for multi-day range summaries.
 * @param {object[]} records
 * @returns {{ completed: number, focusMin: number, total: number }}
 */
export const summarize = (records) => {
  let completed = 0;
  let focusMin = 0;
  for (const r of records) {
    if (r.phase === 'focus' && r.status === 'completed') {
      completed += 1;
      focusMin += r.actual_min ?? r.planned_min ?? 0;
    }
  }
  return { completed, focusMin, total: records.length };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const epochToDate = (epochSec) => new Date(epochSec * 1000).toISOString().slice(0, 10);

/**
 * Progress fraction 0..1 (elapsed / planned), clamped.
 * Derived from `remaining` so the bar and the clock are consistent by
 * construction — they can never disagree, even under clock skew.
 */
export const progressFraction = (state, nowSec = nowEpoch()) => {
  if (!state.planned_min || state.run_state === 'idle') return 0;
  const total = state.planned_min * 60;
  const rem = remaining(state, nowSec) ?? 0;
  return Math.min(1, Math.max(0, (total - rem) / total));
};
