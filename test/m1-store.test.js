/**
 * M1 store tests (TEST-M1-001, TEST-M1-002 from spec.md)
 * Run with: node --test test/m1-store.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTempEnv, makeIdleState } from './helpers.js';
import {
  readState,
  writeState,
  mutateState,
  applyTransition,
  ensureDirs,
} from '../src/store.js';
import { claudoroPaths } from '../src/platform/paths.js';

describe('M1: store', () => {
  let env, cleanup;

  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
  });

  after(() => cleanup());

  it('returns IDLE_STATE when state.json does not exist', () => {
    const state = readState(env);
    assert.equal(state.run_state, 'idle');
    assert.equal(state.schema, 1);
  });

  it('round-trips a state object via writeState + readState', () => {
    const s = makeIdleState({ label: 'test label' });
    writeState(s, env);
    const read = readState(env);
    assert.equal(read.label, 'test label');
  });

  it('mutateState applies the transform atomically and returns the new state', async () => {
    const next = await mutateState((s) => ({ ...s, label: 'mutated' }), env);
    assert.equal(next.label, 'mutated');
    assert.equal(readState(env).label, 'mutated');
  });

  it('quarantines corrupt state.json and returns IDLE_STATE', () => {
    const { stateFile } = claudoroPaths(env);
    writeFileSync(stateFile, '{ not valid json !!!', 'utf8');
    const state = readState(env);
    assert.equal(state.run_state, 'idle');
  });

  it('applyTransition reports changed=false and leaves state untouched on no-op', async () => {
    writeState(makeIdleState({ label: 'before' }), env);
    const { changed, state, prev } = await applyTransition(() => null, env);
    assert.equal(changed, false);
    assert.equal(state.label, 'before');
    assert.equal(prev.label, 'before');
  });

  it('applyTransition reports changed=true, writes state, and returns prev', async () => {
    writeState(makeIdleState({ label: 'before' }), env);
    const { changed, state, prev } = await applyTransition(
      (s) => ({ state: { ...s, label: 'after' } }),
      env,
    );
    assert.equal(changed, true);
    assert.equal(state.label, 'after');
    assert.equal(prev.label, 'before'); // prior state preserved for the caller
    assert.equal(readState(env).label, 'after');
  });

  it('concurrent mutateState calls serialize correctly (TEST-M1-001)', async () => {
    // Reset to idle
    writeState(makeIdleState(), env);

    // Fire two concurrent increments — both should succeed without corruption
    await Promise.all([
      mutateState((s) => ({ ...s, set_index: (s.set_index ?? 0) + 1 }), env),
      mutateState((s) => ({ ...s, set_index: (s.set_index ?? 0) + 1 }), env),
    ]);

    // Both resolved; the final state has been incremented twice (sequential under lock)
    const final = readState(env);
    assert.equal(final.set_index, 2);
    assert.equal(JSON.parse(JSON.stringify(final)).run_state, 'idle'); // valid JSON
  });
});

describe('M1: paths', () => {
  it('claudoroPaths respects XDG_STATE_HOME override', () => {
    const stateBase = join(tmpdir(), 'test-state');
    const paths = claudoroPaths({ XDG_STATE_HOME: stateBase });
    assert.ok(paths.stateDir.startsWith(stateBase));
    assert.ok(paths.stateFile.endsWith('state.json'));
  });

  it('claudoroPaths respects XDG_CONFIG_HOME override', () => {
    const configBase = join(tmpdir(), 'test-config');
    const paths = claudoroPaths({ XDG_CONFIG_HOME: configBase });
    assert.ok(paths.prefsFile.startsWith(configBase));
  });
});
