/**
 * Duration prefs commands: pomo work / short / long / frequency
 * Tests the get/set/validate behaviour of the four duration preference commands
 * without touching the timer or the real prefs file.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { makeTempEnv } from './helpers.js';
import { readPrefs, writePrefs, DEFAULT_PREFS } from '../src/store-read.js';
import { ensureDirs } from '../src/store.js';
import { claudoroPaths } from '../src/platform/paths.js';

// We test the prefs layer directly; verb dispatch is tested implicitly via
// the prefs contract (what cmdWork et al. read and write).

describe('M1: duration prefs defaults', () => {
  let env, cleanup;

  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
  });
  after(() => cleanup());

  it('DEFAULT_PREFS has the canonical Pomodoro values', () => {
    assert.equal(DEFAULT_PREFS.work, 25);
    assert.equal(DEFAULT_PREFS.short, 5);
    assert.equal(DEFAULT_PREFS.long, 15);
    assert.equal(DEFAULT_PREFS.frequency, 4);
  });

  it('readPrefs returns defaults when prefs file does not exist', () => {
    const prefs = readPrefs(env);
    assert.equal(prefs.work, 25);
    assert.equal(prefs.short, 5);
    assert.equal(prefs.long, 15);
    assert.equal(prefs.frequency, 4);
  });
});

describe('M1: duration prefs persistence', () => {
  let env, cleanup;

  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
  });
  after(() => cleanup());

  it('persists work duration and reads it back', () => {
    const prefs = readPrefs(env);
    writePrefs({ ...prefs, work: 50 }, env);
    assert.equal(readPrefs(env).work, 50);
  });

  it('persists short break and reads it back', () => {
    const prefs = readPrefs(env);
    writePrefs({ ...prefs, short: 10 }, env);
    assert.equal(readPrefs(env).short, 10);
  });

  it('persists long break and reads it back', () => {
    const prefs = readPrefs(env);
    writePrefs({ ...prefs, long: 30 }, env);
    assert.equal(readPrefs(env).long, 30);
  });

  it('persists frequency and reads it back', () => {
    const prefs = readPrefs(env);
    writePrefs({ ...prefs, frequency: 6 }, env);
    assert.equal(readPrefs(env).frequency, 6);
  });

  it('other prefs survive a duration write', () => {
    const prefs = readPrefs(env);
    writePrefs({ ...prefs, work: 45 }, env);
    const after = readPrefs(env);
    assert.equal(after.mode, prefs.mode);
    assert.equal(after.view, prefs.view);
    assert.equal(after.mute, prefs.mute);
  });

  it('unset duration falls back to DEFAULT_PREFS value', () => {
    // Write prefs without any duration keys (simulates old prefs file)
    const { prefsFile } = claudoroPaths(env);
    writeFileSync(prefsFile, JSON.stringify({ mode: 'manual' }), 'utf8');
    const prefs = readPrefs(env);
    assert.equal(prefs.work, 25);
    assert.equal(prefs.short, 5);
    assert.equal(prefs.long, 15);
    assert.equal(prefs.frequency, 4);
    assert.equal(prefs.mode, 'manual');
  });
});
