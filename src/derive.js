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

/**
 * True iff `state` still describes the exact phase-instance a detached alarm
 * worker was armed for: same deadline AND same alarm generation (D-009).
 *
 * Worker ownership is the dual of the firing claim: the `alarms_fired` claim
 * makes the *sound* single-fire; this makes the *process* single-owner. Every
 * (re)arm bumps `alarm_seq`, so any superseded worker (replaced by a verb, a
 * reconcile, a `back`, or a duplicate spawn) fails this check and exits on its
 * own — no signal, no kill-by-pid, and therefore no orphaned process and no
 * stale cue. Pure so the worker can use it without loading the alarm module.
 */
export const isAlarmOwner = (state, endEpoch, seq) =>
  state.run_state === 'running' &&
  state.end_epoch === endEpoch &&
  (state.alarm_seq ?? 0) === seq;

/** Zero-padded MM:SS string. Never reflowing (always 5 chars). */
export const formatMMSS = (totalSec) => {
  const s = Math.abs(Math.round(totalSec));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

/**
 * Format minutes as a human-readable focus duration: "2h 05m", "45m", "0m".
 * Single source for both the terminal stats panel and the HTML dashboard, so the
 * two surfaces fed by one payload can never drift on rounding or separators.
 * @param {number} min
 * @returns {string}
 */
export const formatFocusMin = (min) => {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
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
// Credited focus (D-012): a forgotten timer must never count its abandoned span.
// ---------------------------------------------------------------------------

/** Default cap on credited overtime before a phase is treated as abandoned. */
export const DEFAULT_MAX_OVERTIME_MIN = 30;

/**
 * Per-record ceiling on credited focus: planned + max_overtime. A record with no
 * `planned_min` has no meaningful cap (real records always set it), so it is
 * never clamped — the guard targets forgotten timers, not records lacking context.
 */
const overtimeCap = (record) =>
  record.planned_min == null
    ? Infinity
    : record.planned_min +
      (record.config_snapshot?.max_overtime ?? DEFAULT_MAX_OVERTIME_MIN);

/**
 * Focus minutes a record may contribute to aggregates: its real `actual_min`,
 * but never more than `planned + max_overtime`, so a forgotten timer (huge
 * elapsed) can never poison totals. The same bound is applied at write time in
 * the timer; this read-time clamp also neutralises legacy or hand-edited
 * records, with no migration (D-012).
 */
export const creditedMin = (record) =>
  Math.min(record.actual_min ?? record.planned_min ?? 0, overtimeCap(record));

/** True when a record ran past `planned + max_overtime` (a forgotten timer). */
export const wasAbandoned = (record) =>
  record.abandoned === true || (record.actual_min ?? 0) > overtimeCap(record);

/**
 * Cheap render-path gate (D-012): is a running phase overdue by more than
 * `max_overtime`? The status line uses this to decide whether to drive a
 * reconcile (auto-closing a forgotten held boundary) without importing the
 * timer/alarm modules. `reconcileStep` stays the authority on whether to close.
 */
export const overtimeExceeded = (state, nowSec = nowEpoch()) =>
  overtimeSec(state, nowSec) >
  (state.config?.max_overtime ?? DEFAULT_MAX_OVERTIME_MIN) * 60;

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
 * Cycle position (set_index/set_number) is NOT derived here: `deriveCadence` is
 * its single authoritative source, so this fold returns only today's totals and
 * cannot drift from the dots.
 *
 * @param {object[]} records - All records in chronological order
 * @param {string} onDay - ISO date string 'YYYY-MM-DD' to count as "today"
 * @returns {{ completedToday: number, focusMinToday: number }}
 */
export const foldRecords = (records, onDay = today()) => {
  let completedToday = 0;
  let focusMinToday = 0;

  for (const r of records) {
    if (r.status !== 'completed' || r.phase !== 'focus') continue;

    const day = dateOf(r.started);
    if (day === onDay) {
      completedToday += 1;
      focusMinToday += creditedMin(r);
    }
  }

  return { completedToday, focusMinToday };
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
 * `sinceEpoch` bounds the window: records that started before it are ignored, so
 * passing the start of today gives a fresh cycle each day (the dots reset at
 * local midnight) without storing anything. Records are bucketed by `started`
 * (consistent with the rest of the day-bucketing), so a block that straddles
 * midnight counts toward the day it began. Default 0 folds all of history.
 *
 * @param {object[]} records - All records in chronological order
 * @param {number} [sinceEpoch] - ignore records started before this (epoch secs)
 * @returns {{ setIndex: number, setNumber: number }}
 */
export const deriveCadence = (records, sinceEpoch = 0) => {
  let setIndex = 0;
  let setNumber = 1;

  for (const r of records) {
    if ((r.started ?? 0) < sinceEpoch) continue; // outside the window (e.g. earlier days)
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

/**
 * Epoch seconds of the most recent LOCAL midnight at or before `nowSec`. Used to
 * scope the cycle to today: the log stores UTC instants, but the dots reset at
 * the user's local midnight (the same store-UTC / present-local split as stats,
 * D-011). DST-safe: `setHours(0,0,0,0)` resolves local midnight correctly.
 * @param {number} nowSec
 * @returns {number}
 */
export const startOfLocalDay = (nowSec) => {
  const d = new Date(nowSec * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

// ---------------------------------------------------------------------------
// Date-bucket helpers
// ---------------------------------------------------------------------------
// `dateOf` is the SINGLE definition of "which calendar day does this epoch fall
// in" — every other module (history file naming, folding, undo, backups) routes
// through it, so reads and writes can never disagree about day boundaries.
// It buckets in UTC; the known quirk is that "today" is therefore UTC, not local
// (a session finishing late in a UTC-ahead zone may straddle the boundary).
// Because this is now the one chokepoint, switching to local time is a single
// edit here, tracked as a follow-up.

/**
 * The date bucket for an epoch-seconds timestamp, 'YYYY-MM-DD'. Total function:
 * a non-finite input (a hand-edited or partial record with a missing/garbage
 * `started`) buckets to the epoch rather than throwing on `new Date(NaN)`, so a
 * single bad record can never crash a fold (`pomo status`) or an undo.
 */
export const dateOf = (epochSec) =>
  Number.isFinite(epochSec)
    ? new Date(epochSec * 1000).toISOString().slice(0, 10)
    : '1970-01-01';

/** Today's date bucket 'YYYY-MM-DD'. */
export const today = () => dateOf(nowEpoch());

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
      focusMin += creditedMin(r);
    }
  }
  return { completed, focusMin, total: records.length };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
