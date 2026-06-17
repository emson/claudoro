/**
 * M4: Alarm scheduling and single-fire enforcement.
 *
 * Two firing sources per phase (D-009):
 *   1. Detached one-shot: spawned at phase start, fires even when all sessions are closed.
 *   2. Render-claim: if the one-shot dies or is missed, the next status-line tick claims it.
 *
 * Exactly one fire is guaranteed by an atomic claim on state.alarms_fired (under flock).
 * The lock serializes claim attempts; the first writer wins, all others no-op.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mutateState, applyTransition } from './store.js';
import { appendRecord } from './history.js';
import * as T from './timer.js';
import { fireCue, CUE } from './platform/notify.js';
import { cuesDue, nowEpoch } from './derive.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALARM_WORKER = join(__dirname, '_alarm-worker.js');

// ---------------------------------------------------------------------------
// Schedule alarms at phase start
// ---------------------------------------------------------------------------

/**
 * Spawn a detached one-shot that will fire warning + end cues at the right times.
 * Returns the PID (stored in state.alarm_pid for cleanup).
 */
export const scheduleAlarm = (state) => {
  const { end_epoch, config, label } = state;
  const warnAt = end_epoch - (config.notify ?? 1) * 60;
  const mute = config.mute ?? false;

  // TODO: spawn a real detached worker once _alarm-worker.js is implemented
  // For now: spawn a Node one-liner that sleeps and fires
  const args = [
    ALARM_WORKER,
    String(end_epoch),
    String(warnAt),
    String(mute ? '1' : '0'),
    label ?? '',
  ];

  const proc = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true, // don't flash a console window on Windows
  });
  proc.unref();
  return proc.pid;
};

/**
 * Kill the tracked alarm process on pause/stop/skip.
 * Best-effort: a dead or missing PID is harmless.
 */
export const cancelAlarm = (pid) => {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already dead — ignore
  }
};

// ---------------------------------------------------------------------------
// Single-fire claim — the ONE place a cue is atomically claimed (D-009).
// Used by BOTH the detached worker and the opportunistic render-claim, so
// exactly one of them ever fires a given cue regardless of session count.
// ---------------------------------------------------------------------------

/** Map a cue kind + phase to the right sound (warm chime vs gentle prompt). */
const cueSound = (cue, phase) =>
  cue === 'warning' ? CUE.warning : phase === 'focus' ? CUE.focusEnd : CUE.breakEnd;

/**
 * Atomically claim `cue` for the current phase. Returns true iff THIS caller
 * won the claim (and must therefore fire it). All other callers get false.
 */
export const claimCue = async (cue, env = process.env) => {
  let won = false;
  await mutateState((s) => {
    if (s.run_state === 'idle') return s;
    const fired = s.alarms_fired ?? [];
    if (fired.includes(cue)) return s; // someone already claimed it
    won = true;
    return { ...s, alarms_fired: [...fired, cue] };
  }, env);
  return won;
};

/** Claim then fire a cue. No-op (silent) if the claim was already taken. */
export const claimAndFire = async (cue, { phase, label, mute }, env = process.env) => {
  if (!(await claimCue(cue, env))) return false;
  await fireCue({ cue: cueSound(cue, phase), label, mute }).catch(() => {});
  return true;
};

/**
 * Apply a natural-boundary reconciliation under the lock and, if it advanced
 * into a new running phase, schedule that phase's alarm. The daemonless driver
 * shared by the detached one-shot (primary) and the render backup path (D-009).
 *
 * Idempotent across processes: the lock serializes the reconcile, and the
 * freshly-scheduled worker is bound to the new end_epoch, so a duplicate
 * reconcile that lost the race simply finds nothing to do.
 *
 * @returns {Promise<boolean>} whether a transition was applied
 */
export const reconcileAndReschedule = async (env = process.env) => {
  const now = nowEpoch();
  const { changed, state, record } = await applyTransition(
    (s) => T.reconcileStep(s, now),
    env,
  );
  if (!changed) return false;

  if (record) appendRecord(record, env);

  if (state.run_state === 'running') {
    const pid = scheduleAlarm(state);
    // Only claim the pid slot if state is still the phase we just scheduled for;
    // if another reconcile advanced again, leave it — the stale worker bails on
    // its end_epoch check.
    await mutateState(
      (s) =>
        s.run_state === 'running' && s.end_epoch === state.end_epoch
          ? { ...s, alarm_pid: pid }
          : s,
      env,
    );
  }
  return true;
};

/**
 * Opportunistic render-claim, called from the statusline renderer each tick.
 * Fires any due-and-unclaimed cue. Backup for a killed/missed one-shot.
 */
export const claimAlarmIfDue = async (state, env = process.env) => {
  const due = cuesDue(state);
  if (due.length === 0) return false;

  let fired = false;
  for (const cue of due) {
    const ok = await claimAndFire(
      cue,
      { phase: state.phase, label: state.label, mute: state.config?.mute ?? false },
      env,
    );
    fired = fired || ok;
  }
  return fired;
};
