/**
 * M4 alarm tests — the single-fire claim (TEST-M4-002, no cacophony / AC-5).
 * We test claimCue directly: only the first caller wins, all others get false,
 * which is what dedupes the detached worker against the render-claim.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTempEnv, makeRunningState } from './helpers.js';
import { ensureDirs, writeState } from '../src/store.js';
import { claimCue } from '../src/alarm.js';

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
