/**
 * M2: Timer engine — phase state machine and cadence.
 *
 * All verbs are pure functions: (state, args) => { state: nextState, record?: PhaseRecord }.
 * Side effects (writing state, scheduling alarms) are applied by the caller (cli.js).
 *
 * Cadence: focus → short_break → focus → ... → long_break every `frequency` focuses (D-003).
 * Transition modes: auto / balanced / manual (D-006a).
 */
import { nowEpoch, phaseDuration, isLongBreakDue } from './derive.js';

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

/**
 * Begin a focus phase.
 * If a block is already running, returns null (caller reports it — never silent overwrite).
 *
 * @param {object} state - Current state
 * @param {object} opts - { config, mode, label, sessionId, nowSec }
 * @returns {{ state: object } | null}
 */
export const start = (state, opts = {}) => {
  if (state.run_state !== 'idle') return null; // already running; caller reports

  const now = opts.nowSec ?? nowEpoch();
  const config = opts.config ?? state.config;
  const planned = config.work;
  const id = makeRecordId(now, (state.set_index ?? 0) + 1);

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
      alarms_fired: [],
      alarm_pid: null,
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
// stop
// ---------------------------------------------------------------------------

export const stop = (state, opts = {}) => {
  if (state.run_state === 'idle') return null;
  const now = opts.nowSec ?? nowEpoch();
  const record = finalizeRecord(state, 'aborted', now);
  return {
    state: {
      ...state,
      run_state: 'idle',
      phase: null,
      alarm_pid: null,
      alarms_fired: [],
    },
    record,
  };
};

// ---------------------------------------------------------------------------
// skip
// ---------------------------------------------------------------------------

export const skip = (state, opts = {}) => {
  if (state.run_state === 'idle') return null;
  const now = opts.nowSec ?? nowEpoch();
  const record = finalizeRecord(state, 'skipped', now);
  return { state: advanceTo(state, now), record };
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
  const record = finalizeRecord(state, 'completed', now);
  return { state: advanceTo(state, now), record };
};

/** Undo the last transition within the back-window. */
export const back = (_state, _opts = {}) => {
  // TODO: M2 — check back-window; undo if within it
  return null;
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
 *   - at a WAITING boundary (per mode) → null: the phase is left running into
 *     overtime; the renderer shows `+M:SS` and the user resolves it with `next`.
 *   - otherwise (auto into the next phase) → finalize the completed phase
 *     (ended at its planned end, so the detection delay is never counted as
 *     work) and enter the next phase, running.
 *
 * @returns {{ state: object, record: object } | null}
 */
export const reconcileStep = (state, now) => {
  if (state.run_state !== 'running') return null;
  if (now < state.end_epoch) return null;
  if (boundaryWaits(state.mode, state.phase)) return null;
  const record = finalizeRecord(state, 'completed', state.end_epoch);
  return { state: advanceTo(state, now), record };
};

// ---------------------------------------------------------------------------
// Phase advancement helpers (internal)
// ---------------------------------------------------------------------------

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

const finalizeRecord = (state, status, now) => ({
  id: state.current_record_id ?? makeRecordId(state.started, state.set_index),
  schema: 1,
  phase: state.phase,
  mode: state.mode,
  planned_min: state.planned_min,
  started: state.started,
  ended: now,
  // Clamp ≥ 0 so a backward clock jump can never record negative work.
  actual_min: Math.max(
    0,
    Math.round(((now - state.started - (state.paused_total_sec ?? 0)) / 60) * 10) / 10,
  ),
  overtime_min: Math.max(0, Math.round(((now - state.end_epoch) / 60) * 10) / 10),
  status,
  pauses: {
    count: 0, // TODO: track pause intervals
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
});

const makeRecordId = (startedEpoch, index) =>
  `${new Date(startedEpoch * 1000).toISOString().replace(/\.\d+Z$/, 'Z')}-${index}`;
