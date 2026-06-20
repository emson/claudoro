/**
 * M2: Timer engine — phase state machine and cadence.
 *
 * All verbs are pure functions: (state, args) => { state: nextState, record?: PhaseRecord }.
 * Side effects (writing state, scheduling alarms) are applied by the caller (cli.js).
 *
 * Cadence: focus → short_break → focus → ... → long_break every `frequency` focuses (D-003).
 * Transition modes: auto / balanced / manual (D-006a).
 */
import {
  nowEpoch,
  phaseDuration,
  isLongBreakDue,
  DEFAULT_MAX_OVERTIME_MIN,
} from './derive.js';

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

/**
 * Begin a focus phase.
 * If a block is already running, returns null (caller reports it — never silent overwrite).
 *
 * The cycle position is taken from `opts.cadence` (derived from records by the
 * caller) so a fresh start always reflects the true history, never a stale
 * stored counter left behind by an undo or a hand-edited log (D-007). Falls back
 * to the state's cached value when no cadence is supplied (keeps pure unit tests
 * and any caller that does not need re-derivation working).
 *
 * @param {object} state - Current state
 * @param {object} opts - { config, mode, label, sessionId, nowSec, cadence }
 * @returns {{ state: object } | null}
 */
export const start = (state, opts = {}) => {
  if (state.run_state !== 'idle') return null; // already running; caller reports

  const now = opts.nowSec ?? nowEpoch();
  const config = opts.config ?? state.config;
  const planned = config.work;
  const setIndex = opts.cadence?.setIndex ?? state.set_index ?? 0;
  const setNumber = opts.cadence?.setNumber ?? state.set_number ?? 1;
  const id = makeRecordId(now, setIndex + 1);

  return {
    state: {
      ...state,
      run_state: 'running',
      phase: 'focus',
      started: now,
      end_epoch: now + planned * 60,
      planned_min: planned,
      paused_at: null,
      paused_total_sec: 0,
      mode: opts.mode ?? state.mode ?? 'auto',
      label: opts.label ?? state.label ?? null,
      owner_session: opts.sessionId ?? state.owner_session,
      set_index: setIndex,
      set_number: setNumber,
      alarms_fired: [],
      alarm_pid: null,
      back_checkpoint: null, // starting fresh clears any prior checkpoint
      current_record_id: id,
      config,
    },
  };
};

// ---------------------------------------------------------------------------
// pause / resume
// ---------------------------------------------------------------------------

export const pause = (state, opts = {}) => {
  if (state.run_state !== 'running') return null;
  const now = opts.nowSec ?? nowEpoch();
  return { state: { ...state, run_state: 'paused', paused_at: now } };
};

export const resume = (state, opts = {}) => {
  if (state.run_state !== 'paused') return null;
  const now = opts.nowSec ?? nowEpoch();
  const pausedSpan = now - state.paused_at;
  return {
    state: {
      ...state,
      run_state: 'running',
      paused_at: null,
      paused_total_sec: (state.paused_total_sec ?? 0) + pausedSpan,
      end_epoch: state.end_epoch + pausedSpan,
      alarms_fired: [], // reschedule alarms from new end_epoch
    },
  };
};

// ---------------------------------------------------------------------------
// toggle (D-010): the click verb
// ---------------------------------------------------------------------------

// Drop a second toggle within this window so an accidental double-click is a
// no-op rather than a pause→resume flip back to where you started (D-010).
export const TOGGLE_DEBOUNCE_MS = 300;

/**
 * Pause if running, resume if paused. Pause↔resume only: never advances, starts,
 * or stops, so a click is a predictable single button (D-010). A toggle within
 * TOGGLE_DEBOUNCE_MS of the previous one is dropped; the prior timestamp is kept,
 * so the window is always measured from the last toggle that actually took effect.
 *
 * Needs millisecond resolution for sub-second double-clicks, so it takes `nowMs`
 * (the CLI reads the clock once at the boundary and passes it down). Returns null
 * for idle (nothing to toggle) and for a debounced click; both are no-ops.
 *
 * @param {object} state
 * @param {object} opts - { nowSec, nowMs }
 * @returns {{ state: object } | null}
 */
export const toggle = (state, opts = {}) => {
  const nowMs = opts.nowMs ?? Date.now();
  const last = state.last_toggle_ms ?? null;
  if (last != null && nowMs - last < TOGGLE_DEBOUNCE_MS) return null;

  const inner =
    state.run_state === 'running'
      ? pause(state, opts)
      : state.run_state === 'paused'
        ? resume(state, opts)
        : null;
  if (!inner) return null; // idle: nothing to toggle

  return { state: { ...inner.state, last_toggle_ms: nowMs } };
};

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

export const stop = (state, opts = {}) => {
  if (state.run_state === 'idle') return null;
  const now = opts.nowSec ?? nowEpoch();
  const record = finalizeRecord(state, 'aborted', now, { full: opts.full });
  return { state: toIdle(state), record };
};

// ---------------------------------------------------------------------------
// skip
// ---------------------------------------------------------------------------

export const skip = (state, opts = {}) => {
  if (state.run_state === 'idle') return null;
  const now = opts.nowSec ?? nowEpoch();
  const record = finalizeRecord(state, 'skipped', now);
  const advanced = advanceTo(state, now);
  return { state: withCheckpoint(state, advanced, now, record.id), record };
};

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

/** Restart the current phase without advancing the cycle count (charter: keep set_index). */
export const reset = (state, opts = {}) => {
  if (state.run_state === 'idle') return null;
  const now = opts.nowSec ?? nowEpoch();
  const planned = state.planned_min;
  return {
    state: {
      ...state,
      run_state: 'running',
      started: now,
      end_epoch: now + planned * 60,
      paused_at: null,
      paused_total_sec: 0,
      alarms_fired: [],
      alarm_pid: null,
      back_checkpoint: null, // resetting the phase invalidates the prior checkpoint
    },
  };
};

// ---------------------------------------------------------------------------
// next / back / extend
// ---------------------------------------------------------------------------

/**
 * Resolve a waiting boundary: the user acknowledging an overtime-held phase.
 * Finalizes the held phase (capturing the overtime as real elapsed time) and
 * advances to the next phase, running. No-op unless the phase is overdue.
 */
export const next = (state, opts = {}) => {
  if (state.run_state !== 'running') return null;
  const now = opts.nowSec ?? nowEpoch();
  if (now < state.end_epoch) return null; // not at a boundary yet
  const record = finalizeRecord(state, 'completed', now, { full: opts.full });
  const advanced = advanceTo(state, now);
  return { state: withCheckpoint(state, advanced, now, record.id), record };
};

/**
 * Undo the last auto/explicit phase transition, if it is still inside the
 * back-window. Restores the pre-transition snapshot verbatim (phase, end_epoch,
 * set_index/number, label, alarms_fired) so remaining time is what it was at the
 * boundary. Reports the record id to remove from the log so aggregates re-derive.
 * Non-recursive: the restored state carries no checkpoint.
 *
 * @param {object} state
 * @param {object} opts - { nowSec, windowSec }
 * @returns {{ ok: true, state: object, removeRecordId: string|null }
 *         | { ok: false, reason: 'none' | 'expired', sinceSec?: number, windowSec?: number }}
 */
export const back = (state, opts = {}) => {
  const cp = state.back_checkpoint;
  if (!cp) return { ok: false, reason: 'none' };

  const now = opts.nowSec ?? nowEpoch();
  const windowSec = opts.windowSec ?? state.config?.back_window ?? 120;
  const sinceSec = now - cp.transition_epoch;

  if (sinceSec > windowSec) {
    return { ok: false, reason: 'expired', sinceSec, windowSec };
  }

  // Restore the snapshot verbatim. It already has back_checkpoint: null, so a
  // second `back` is a no-op (non-recursive). alarms_fired is restored to its
  // pre-transition value so re-fire is suppressed (the end cue is already there).
  return {
    ok: true,
    state: { ...cp.state, back_checkpoint: null },
    removeRecordId: cp.record_id ?? null,
  };
};

/** Add minutes to the current phase. */
export const extend = (state, opts = {}) => {
  if (state.run_state === 'idle') return null;
  const minutes = Math.min(opts.minutes ?? 5, 120); // cap absurd values
  return {
    state: { ...state, end_epoch: state.end_epoch + minutes * 60 },
  };
};

// ---------------------------------------------------------------------------
// Natural-boundary reconciliation (D-006a)
// ---------------------------------------------------------------------------

// Transition mode lives in state.mode, never in config. `boundaryWaits` decides
// whether the AUTOMATIC transition out of `fromPhase` should pause for the user
// (a waiting boundary) rather than auto-advance. It governs only natural ends;
// explicit `skip`/`next` always advance regardless of mode.
//   - leaving focus → break: only `manual` waits.
//   - leaving a break → focus: `manual` and `balanced` both wait (never burn
//     focus clock while the user may be away — D-006a S3).
const boundaryWaits = (mode, fromPhase) =>
  fromPhase === 'focus' ? mode === 'manual' : mode === 'manual' || mode === 'balanced';

/**
 * Reconcile an overdue running phase at a natural boundary. The daemonless
 * driver: invoked by the detached alarm one-shot at end-time (primary) and
 * opportunistically by the status-line render (backup, D-009), so phase state
 * advances even with no user action and no daemon.
 *
 *   - not running, or not yet at end_epoch → null (nothing to do).
 *   - at a WAITING boundary (per mode) still inside the hold window → null: the
 *     phase is left running into overtime; the renderer shows `+M:SS` and the
 *     user resolves it with `next`.
 *   - at a WAITING boundary held past `max_overtime` → the user has clearly gone:
 *     finalize the completed phase at its planned end (full credit, never the
 *     abandoned overflow) and return to idle, rather than wait forever (D-012).
 *   - otherwise (auto into the next phase) → finalize the completed phase
 *     (ended at its planned end, so the detection delay is never counted as
 *     work) and enter the next phase, running.
 *
 * @returns {{ state: object, record: object } | null}
 */
export const reconcileStep = (state, now) => {
  if (state.run_state !== 'running') return null;
  if (now < state.end_epoch) return null;

  if (boundaryWaits(state.mode, state.phase)) {
    const maxOverSec = (state.config?.max_overtime ?? DEFAULT_MAX_OVERTIME_MIN) * 60;
    if (now - state.end_epoch <= maxOverSec) return null; // still within the hold window
    // Held past the threshold: auto-close to idle. The held phase keeps full
    // credit for its planned duration (finalized at end_epoch, not abandoned).
    return {
      state: toIdle(state),
      record: finalizeRecord(state, 'completed', state.end_epoch),
    };
  }

  const record = finalizeRecord(state, 'completed', state.end_epoch);
  const advanced = advanceTo(state, now);
  // The back-window starts from `now` (the detection time), not from end_epoch:
  // if no session was open at the natural end, the user's chance to say "go back"
  // only begins when this reconcile actually fires.
  return { state: withCheckpoint(state, advanced, now, record.id), record };
};

// ---------------------------------------------------------------------------
// Phase advancement helpers (internal)
// ---------------------------------------------------------------------------

/**
 * Return to idle, keeping the cadence counters (re-derived from records at the
 * next `start`). Shared by `stop` and the held-boundary auto-close so they
 * produce the identical idle shape. Never touches `alarm_seq` (only armAlarm does).
 */
const toIdle = (state) => ({
  ...state,
  run_state: 'idle',
  phase: null,
  alarm_pid: null,
  alarms_fired: [],
  back_checkpoint: null,
});

/**
 * Attach a back-checkpoint to `nextState` so `back` can restore `prevState`.
 * The captured snapshot's own back_checkpoint is nulled to prevent nesting
 * (checkpoints never chain, so `back` is non-recursive by construction).
 *
 * @param {object} prevState - State BEFORE the transition
 * @param {object} nextState - State AFTER advancing (from advanceTo)
 * @param {number} transitionEpoch - Wall-clock epoch when the transition fired
 * @param {string|null} recordId - id of the record written by the transition
 */
const withCheckpoint = (prevState, nextState, transitionEpoch, recordId) => ({
  ...nextState,
  back_checkpoint: {
    state: { ...prevState, back_checkpoint: null },
    transition_epoch: transitionEpoch,
    record_id: recordId,
  },
});

/** Enter `phase`, running, with a fresh end_epoch and a fresh record id. */
const enterPhase = (state, phase, now) => {
  const planned = phaseDuration(phase, state.config);
  return {
    ...state,
    run_state: 'running',
    phase,
    started: now,
    end_epoch: now + planned * 60,
    planned_min: planned,
    paused_at: null,
    paused_total_sec: 0,
    alarms_fired: [],
    alarm_pid: null,
    current_record_id: makeRecordId(now, state.set_index ?? 0),
  };
};

/**
 * Advance to the next phase per cadence (focus → break → … → long break every
 * `frequency`). The next phase always starts at `now` and runs; whether the
 * caller pauses for the user is decided upstream (reconcileStep), not here.
 */
const advanceTo = (state, now) => {
  const { set_index, set_number, phase, config } = state;

  if (phase === 'focus') {
    const newSetIndex = (set_index ?? 0) + 1;
    const nextPh = isLongBreakDue(newSetIndex, config.frequency)
      ? 'long_break'
      : 'short_break';
    return enterPhase({ ...state, set_index: newSetIndex }, nextPh, now);
  }

  // break → focus
  const newSetNumber = phase === 'long_break' ? (set_number ?? 1) + 1 : (set_number ?? 1);
  const newSetIndex = phase === 'long_break' ? 0 : (set_index ?? 0);
  return enterPhase(
    { ...state, set_number: newSetNumber, set_index: newSetIndex },
    'focus',
    now,
  );
};

const round1 = (sec) => Math.max(0, Math.round((sec / 60) * 10) / 10);

/**
 * Build the immutable record for a finalized phase.
 *
 * Abandoned-time handling (D-012): a forgotten timer finalized far past its end
 * must not record its whole span as focus. Real elapsed is credited only up to
 * `planned + max_overtime`; beyond that the record is flagged `abandoned` and
 * the overflow is dropped. The true span is preserved in `started`/`ended`, so
 * nothing is lost. `opts.full` opts out (records the true elapsed) for a genuine
 * marathon. The auto-reconcile path passes `now = end_epoch`, so it never trips
 * the cap.
 */
const finalizeRecord = (state, status, now, opts = {}) => {
  // Clamp ≥ 0 so a backward clock jump can never record negative work.
  const rawElapsedSec = Math.max(0, now - state.started - (state.paused_total_sec ?? 0));
  const rawOvertimeSec = Math.max(0, now - state.end_epoch);
  const capSec =
    ((state.config?.max_overtime ?? DEFAULT_MAX_OVERTIME_MIN) + state.planned_min) * 60;
  const abandoned = rawElapsedSec > capSec;

  const elapsedSec = opts.full || !abandoned ? rawElapsedSec : capSec;
  const overtimeSec =
    opts.full || !abandoned
      ? rawOvertimeSec
      : Math.min(
          rawOvertimeSec,
          (state.config?.max_overtime ?? DEFAULT_MAX_OVERTIME_MIN) * 60,
        );

  return {
    id: state.current_record_id ?? makeRecordId(state.started, state.set_index),
    schema: 1,
    phase: state.phase,
    mode: state.mode,
    planned_min: state.planned_min,
    started: state.started,
    ended: now,
    actual_min: round1(elapsedSec),
    overtime_min: round1(overtimeSec),
    abandoned: abandoned && !opts.full,
    status,
    pauses: {
      count: 0, // pause-interval detail is tracked under the D-010 design
      total_sec: state.paused_total_sec ?? 0,
      intervals: [],
    },
    config_snapshot: state.config,
    mute: state.config?.mute ?? false,
    label: state.label ?? null,
    set_number: state.set_number,
    set_index: state.set_index,
    context: {},
    provenance: {},
    pending: [],
  };
};

const makeRecordId = (startedEpoch, index) =>
  `${new Date(startedEpoch * 1000).toISOString().replace(/\.\d+Z$/, 'Z')}-${index}`;
