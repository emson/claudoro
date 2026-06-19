/**
 * M4: Alarm scheduling and single-fire enforcement.
 *
 * Two firing sources per phase (D-009):
 *   1. Detached worker: spawned at phase start, fires even when all sessions are closed.
 *   2. Render-claim: if the worker dies or is missed, the next status-line tick claims it.
 *
 * TWO invariants, kept by two orthogonal claims:
 *   - Single SOUND: an atomic claim on state.alarms_fired (under flock). The first
 *     writer of a cue wins; all others no-op. Dedupes worker vs render-claim.
 *   - Single OWNER PROCESS: a monotonic state.alarm_seq (the "generation"). Every
 *     (re)arm bumps it; a worker owns the alarm only while state.alarm_seq still
 *     equals the generation it was spawned with (see derive.isAlarmOwner). Any
 *     superseded worker self-exits, so we never kill by PID (PIDs get recycled)
 *     and a worker can never be orphaned: the lifetime of the process is bound to
 *     the generation, not to a fragile pid slot.
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
// Arming — the SINGLE chokepoint that schedules the phase alarm (D-009).
// Every verb and every reconcile routes through armAlarm, so no spawn can ever
// escape generation tracking.
// ---------------------------------------------------------------------------

/**
 * Spawn a detached worker bound to (state.end_epoch, seq). The worker re-reads
 * everything else (label, mute, what's due) from state at fire time, so its only
 * argv is its identity. Returns the PID (recorded for diagnostics only).
 */
const spawnWorker = (state, seq) => {
  const proc = spawn(
    process.execPath,
    [ALARM_WORKER, String(state.end_epoch), String(seq)],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  proc.unref();
  return proc.pid;
};

/**
 * Arm (or disarm) the phase alarm. The one place a worker is ever spawned.
 *
 * Atomic and race-safe:
 *   1. Bump the generation BEFORE any worker exists. Committing the bump first
 *      means the worker we spawn next can only read a state at or after its own
 *      generation, so it can never mistake itself for superseded at startup.
 *   2. If running, spawn a worker bound to the new generation; otherwise disarm
 *      (the bump alone retires the previous worker, which self-exits on its next
 *      poll — pause/stop need nothing more).
 *   3. Record the pid for observability, only if still current.
 *
 * Because the generation always changes, calling armAlarm is sufficient to
 * supersede every previously-spawned worker. Callers never track or kill a pid.
 *
 * @param {object} [env]
 * @param {(state: object, seq: number) => (number|undefined)} [spawnFn] - injectable for tests
 * @returns {Promise<{ seq: number, pid: number|null }>}
 */
export const armAlarm = async (env = process.env, spawnFn = spawnWorker) => {
  // The returned state is the post-bump phase: same deadline, new generation.
  const armed = await mutateState(
    (s) => ({ ...s, alarm_seq: (s.alarm_seq ?? 0) + 1, alarm_pid: null }),
    env,
  );
  const seq = armed.alarm_seq;

  if (armed.run_state !== 'running') return { seq, pid: null };

  const pid = spawnFn(armed, seq) ?? null;
  await mutateState((s) => (s.alarm_seq === seq ? { ...s, alarm_pid: pid } : s), env);
  return { seq, pid };
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
 * into a new running phase, arm that phase's alarm. The daemonless driver shared
 * by the detached worker (primary) and the render backup path (D-009).
 *
 * Idempotent across processes: the lock serializes the reconcile, and armAlarm
 * reads fresh state and bumps the generation, so a duplicate reconcile that lost
 * the race simply finds nothing to advance, and any worker it may have spawned
 * for a since-superseded phase self-exits.
 *
 * @returns {Promise<boolean>} whether a transition was applied
 */
export const reconcileAndReschedule = async (env = process.env) => {
  const now = nowEpoch();
  const { changed, record } = await applyTransition((s) => T.reconcileStep(s, now), env);
  if (!changed) return false;

  if (record) appendRecord(record, env);
  await armAlarm(env); // arms the new phase if running; disarms (bumps gen) if not
  return true;
};

/**
 * Opportunistic render-claim, called from the statusline renderer each tick.
 * Fires any due-and-unclaimed cue. Backup for a killed/missed worker.
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
