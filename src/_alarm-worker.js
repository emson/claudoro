/**
 * M4: Detached one-shot alarm worker.
 * Spawned by alarm.js (detached, stdio ignored) so it fires even if every
 * terminal closes. Args: <endEpoch> <warnAt> <mute 0|1> [label...]
 *
 * It sleeps to each cue time, then fires through the SAME atomic claim used by
 * the render path (alarm.claimAndFire), so the two sources never double-fire.
 * Before each fire it re-reads state and bails if the phase has moved on
 * underneath it (extend/skip/stop), keying on the bound end_epoch.
 */
import { readState } from './store.js';
import { claimAndFire, reconcileAndReschedule } from './alarm.js';

const [, , endEpochArg, warnAtArg, muteArg, ...labelParts] = process.argv;
const endEpoch = parseInt(endEpochArg, 10);
const warnAt = parseInt(warnAtArg, 10);
const mute = muteArg === '1';
const label = labelParts.join(' ') || null;

const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// Fire `cue` only if state still describes the phase this worker was bound to.
const fireIfCurrent = async (cue) => {
  const state = readState();
  if (state.run_state !== 'running' || state.end_epoch !== endEpoch) return;
  await claimAndFire(cue, { phase: state.phase, label, mute }).catch(() => {});
};

await sleep((warnAt - nowSec()) * 1000);
await fireIfCurrent('warning');

await sleep((endEpoch - nowSec()) * 1000);
await fireIfCurrent('end');

// At the natural end, advance phase state too (auto-cycle, or hold in overtime
// for a waiting boundary). In auto this schedules the next phase's alarm before
// this one-shot exits; the new worker takes over. Guarded by the bound end_epoch
// inside reconcileStep, so a phase that already moved on is a no-op.
const s = readState();
if (s.run_state === 'running' && s.end_epoch === endEpoch) {
  await reconcileAndReschedule().catch(() => {});
}
