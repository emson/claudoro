/**
 * M4 alarm tests — the single-fire claim (TEST-M4-002, no cacophony / AC-5).
 * We test claimCue directly: only the first caller wins, all others get false,
 * which is what dedupes the detached worker against the render-claim.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTempEnv, makeRunningState, makeIdleState } from './helpers.js';
import { ensureDirs, writeState, readState } from '../src/store.js';
import { claimCue, armAlarm } from '../src/alarm.js';
import { isAlarmOwner } from '../src/derive.js';

describe('M4: claimCue (single-fire across processes/sessions)', () => {
  let env, cleanup;
  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
  });
  after(() => cleanup());

  it('first claim wins, second claim of the same cue loses', async () => {
    writeState(makeRunningState({ alarms_fired: [] }), env);
    const first = await claimCue('end', env);
    const second = await claimCue('end', env);
    assert.equal(first, true);
    assert.equal(second, false);
  });

  it('concurrent claims of the same cue produce exactly one winner', async () => {
    writeState(makeRunningState({ alarms_fired: [] }), env);
    const results = await Promise.all([
      claimCue('end', env),
      claimCue('end', env),
      claimCue('end', env),
      claimCue('end', env),
    ]);
    const winners = results.filter(Boolean).length;
    assert.equal(winners, 1, 'exactly one caller should fire the cue');
  });

  it('different cues can each be claimed once', async () => {
    writeState(makeRunningState({ alarms_fired: [] }), env);
    assert.equal(await claimCue('warning', env), true);
    assert.equal(await claimCue('end', env), true);
    assert.equal(await claimCue('warning', env), false);
  });

  it('never claims when idle', async () => {
    writeState(makeRunningState({ run_state: 'idle', alarms_fired: [] }), env);
    assert.equal(await claimCue('end', env), false);
  });
});

describe('M4: isAlarmOwner (single-owner process / no orphans, D-009)', () => {
  const s = makeRunningState({ end_epoch: 5000, alarm_seq: 7 });

  it('owns only the exact (deadline, generation) it was armed for', () => {
    assert.equal(isAlarmOwner(s, 5000, 7), true);
    assert.equal(isAlarmOwner(s, 5000, 6), false, 'older generation is superseded');
    assert.equal(
      isAlarmOwner(s, 5000, 8),
      false,
      'newer generation is not yet committed',
    );
    assert.equal(
      isAlarmOwner(s, 4999, 7),
      false,
      'a different deadline is a different phase',
    );
  });

  it('never owns when not running (pause/stop retire the worker)', () => {
    assert.equal(isAlarmOwner({ ...s, run_state: 'paused' }, 5000, 7), false);
    assert.equal(isAlarmOwner({ ...s, run_state: 'idle' }, 5000, 7), false);
  });

  it('treats a missing generation as 0', () => {
    const old = makeRunningState({ end_epoch: 5000 });
    delete old.alarm_seq;
    assert.equal(isAlarmOwner(old, 5000, 0), true);
  });
});

describe('M4: armAlarm (generation chokepoint)', () => {
  let env, cleanup;
  // Inject the spawn so the test never forks a real detached worker.
  const fakePid = () => 4242;
  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
  });
  after(() => cleanup());

  it('bumps the generation and records the spawned pid when running', async () => {
    writeState(makeRunningState({ alarm_seq: 3, alarm_pid: null }), env);
    const { seq, pid } = await armAlarm(env, fakePid);
    assert.equal(seq, 4);
    assert.equal(pid, 4242);
    const s = readState(env);
    assert.equal(s.alarm_seq, 4);
    assert.equal(s.alarm_pid, 4242);
  });

  it('disarms (bumps generation, no spawn) when not running', async () => {
    writeState(makeIdleState({ alarm_seq: 9, alarm_pid: 4242 }), env);
    let spawned = false;
    const { seq, pid } = await armAlarm(env, () => {
      spawned = true;
      return 1;
    });
    assert.equal(spawned, false, 'must not spawn a worker when idle');
    assert.equal(seq, 10);
    assert.equal(pid, null);
    assert.equal(readState(env).alarm_pid, null);
  });

  it('is strictly monotonic across repeated arms (old workers can never re-match)', async () => {
    writeState(makeRunningState({ alarm_seq: 0 }), env);
    const seqs = [];
    for (let i = 0; i < 5; i++) seqs.push((await armAlarm(env, fakePid)).seq);
    assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
  });
});
