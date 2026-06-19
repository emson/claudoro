/**
 * M4: Detached, self-validating alarm worker.
 * Spawned by alarm.armAlarm (detached, stdio ignored) so it fires even if every
 * terminal closes. Argv is just its identity: <endEpoch> <seq>.
 *
 * It owns the alarm only while state still describes the exact phase-instance it
 * was armed for (same deadline AND same generation — derive.isAlarmOwner). Any
 * verb or reconcile that re-arms bumps state.alarm_seq, so a superseded worker
 * notices on its next poll and exits. This is why nothing ever kills a worker by
 * PID and why a worker can never be orphaned: its lifetime is bound to the
 * generation, not to a fragile pid slot.
 *
 * Each wake it: (1) exits if no longer the owner, (2) claims+fires whatever cues
 * are due (shared cuesDue, same as the render path), (3) sleeps to the next cue,
 * capped at POLL_MS so supersession (and clock jumps / suspend-resume) are
 * noticed promptly. Firing stays single across all sources via the atomic claim.
 */
import { readState } from './store.js';
import { claimAndFire, reconcileAndReschedule } from './alarm.js';
import { cuesDue, isAlarmOwner, nowEpoch } from './derive.js';

const [, , endEpochArg, seqArg] = process.argv;
const endEpoch = parseInt(endEpochArg, 10);
const seq = parseInt(seqArg, 10);

// Cap each sleep so a superseded worker self-reaps within this bound rather than
// lingering until its (possibly distant) cue time. A handful of cheap lock-free
// reads over a phase is negligible for a detached background process.
const POLL_MS = 30_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

const fire = (cue, s) =>
  claimAndFire(cue, {
    phase: s.phase,
    label: s.label,
    mute: s.config?.mute ?? false,
  }).catch(() => {});

while (true) {
  const s = readState();
  if (!isAlarmOwner(s, endEpoch, seq)) process.exit(0); // superseded / stopped / moved on

  const now = nowEpoch();
  for (const cue of cuesDue(s, now)) await fire(cue, s);

  if (now >= endEpoch) break; // deadline reached — advance the phase below

  const warnAt = endEpoch - (s.config?.notify ?? 1) * 60;
  const nextCueAt = now < warnAt ? warnAt : endEpoch;
  await sleep(Math.min((nextCueAt - now) * 1000, POLL_MS));
}

// At/after the deadline and still the owner: drive the natural-boundary
// transition. In auto this finalizes the phase and arms the next one (a fresh
// worker) before we exit; at a waiting boundary or when stopped it disarms.
// Guarded by isAlarmOwner so a phase that already moved on is a no-op.
if (isAlarmOwner(readState(), endEpoch, seq)) {
  await reconcileAndReschedule().catch(() => {});
}
