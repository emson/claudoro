/**
 * Duration prefs commands: pomo work / short / long / frequency
 * Tests the get/set/validate behaviour of the four duration preference commands
 * without touching the timer or the real prefs file.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { makeTempEnv, makeRunningState, makeIdleState } from './helpers.js';
import {
  readPrefs,
  writePrefs,
  DEFAULT_PREFS,
  DURATION_SPECS,
} from '../src/store-read.js';
import { ensureDirs } from '../src/store.js';
import { claudoroPaths } from '../src/platform/paths.js';
import {
  cmdWork,
  cmdShortBreak,
  cmdLongBreak,
  cmdFrequency,
  resolveStartDurations,
} from '../src/cli.js';
import { renderStatus } from '../src/output.js';

/** Run fn with CLAUDORO_COLOR=never so status-line ANSI wrappers no-op. */
const withNoColor = (fn) => {
  const orig = process.env.CLAUDORO_COLOR;
  process.env.CLAUDORO_COLOR = 'never';
  try {
    return fn();
  } finally {
    if (orig === undefined) delete process.env.CLAUDORO_COLOR;
    else process.env.CLAUDORO_COLOR = orig;
  }
};

/**
 * Run a verb handler (or any duration-resolving call), capturing console.log
 * output and any process.exit code. `process.exit` is stubbed to throw rather
 * than actually terminate the test process; a non-sentinel throw still
 * propagates. Returns { code, out }; `code` is undefined when the call never
 * exited.
 */
const runCmd = async (fn) => {
  const origExit = process.exit;
  const origLog = console.log;
  const lines = [];
  let code;
  console.log = (...a) => lines.push(a.join(' '));
  process.exit = (c) => {
    code = c;
    throw new Error('__process_exit__');
  };
  try {
    await fn();
  } catch (err) {
    if (err.message !== '__process_exit__') throw err;
  } finally {
    process.exit = origExit;
    console.log = origLog;
  }
  return { code, out: lines.join('\n') };
};

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

describe('M1: duration prefs healing (D-013)', () => {
  let env, cleanup;

  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
  });
  after(() => cleanup());

  it('a non-numeric persisted value heals to the spec default, not NaN', () => {
    const { prefsFile } = claudoroPaths(env);
    writeFileSync(prefsFile, JSON.stringify({ work: 'abc' }), 'utf8');
    const prefs = readPrefs(env);
    assert.equal(prefs.work, DURATION_SPECS.work.default);
    assert.ok(Number.isInteger(prefs.work), 'must be a finite integer, never NaN');
  });

  it('an out-of-range persisted value heals to the spec default', () => {
    const { prefsFile } = claudoroPaths(env);
    writeFileSync(prefsFile, JSON.stringify({ frequency: 0, long: 9999 }), 'utf8');
    const prefs = readPrefs(env);
    assert.equal(prefs.frequency, DURATION_SPECS.frequency.default);
    assert.equal(prefs.long, DURATION_SPECS.long.default);
  });

  it('a valid in-range persisted value is preserved as-is', () => {
    const { prefsFile } = claudoroPaths(env);
    writeFileSync(prefsFile, JSON.stringify({ short: 20 }), 'utf8');
    assert.equal(readPrefs(env).short, 20);
  });
});

describe('M1: cmdWork / cmdShortBreak / cmdLongBreak / cmdFrequency verb handlers', () => {
  let env, cleanup;

  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
  });
  after(() => cleanup());

  it('no-arg call prints the current value and writes nothing', async () => {
    const before = readPrefs(env).work;
    const { out } = await runCmd(() => cmdWork({ positional: [], flags: {} }, env));
    assert.ok(out.includes('work:'));
    assert.ok(out.includes(`${before}min`));
    assert.equal(readPrefs(env).work, before);
  });

  it('a valid set persists the new value', async () => {
    await runCmd(() => cmdWork({ positional: ['50'], flags: {} }, env));
    assert.equal(readPrefs(env).work, 50);
  });

  it('frequency messages never carry a spurious "min" unit (it is a count, not a duration)', async () => {
    const { out } = await runCmd(() =>
      cmdFrequency({ positional: ['6'], flags: {} }, env),
    );
    assert.ok(out.includes('Cycle frequency set to 6.'));
    assert.ok(!out.includes('6min'));
  });

  it('--json emits a parseable single-key payload', async () => {
    const { out } = await runCmd(() =>
      cmdShortBreak({ positional: ['10'], flags: { json: true } }, env),
    );
    assert.deepEqual(JSON.parse(out), { short: 10 });
  });

  it('out-of-range input exits 1 and leaves the persisted value untouched', async () => {
    const before = readPrefs(env).long;
    const { code } = await runCmd(() =>
      cmdLongBreak({ positional: ['9999'], flags: {} }, env),
    );
    assert.equal(code, 1);
    assert.equal(readPrefs(env).long, before);
  });

  it('non-numeric input exits 1', async () => {
    const { code } = await runCmd(() =>
      cmdFrequency({ positional: ['banana'], flags: {} }, env),
    );
    assert.equal(code, 1);
  });

  it('frequency 0 is rejected (would silently break long-break cadence forever)', async () => {
    const { code } = await runCmd(() =>
      cmdFrequency({ positional: ['0'], flags: {} }, env),
    );
    assert.equal(code, 1);
  });
});

describe('M1: resolveStartDurations — pomo start precedence (D-013)', () => {
  const prefs = { work: 25, short: 5, long: 15, frequency: 4 };

  it('falls back to prefs when nothing is supplied', () => {
    assert.deepEqual(resolveStartDurations(null, {}, prefs), {
      work: 25,
      short: 5,
      long: 15,
      frequency: 4,
    });
  });

  it('the positional shorthand overrides prefs for work only', () => {
    const cfg = resolveStartDurations(50, {}, prefs);
    assert.equal(cfg.work, 50);
    assert.equal(cfg.short, 5);
  });

  it('flags override prefs when no positional is given', () => {
    const cfg = resolveStartDurations(
      null,
      { work: '90', short: '10', long: '20', frequency: '6' },
      prefs,
    );
    assert.deepEqual(cfg, { work: 90, short: 10, long: 20, frequency: 6 });
  });

  it('the positional beats a --work flag, same precedence as the rest of start', () => {
    const cfg = resolveStartDurations(50, { work: '90' }, prefs);
    assert.equal(cfg.work, 50);
  });

  it('an out-of-range flag is rejected loud, the same bound `pomo work` enforces', async () => {
    const { code } = await runCmd(() =>
      resolveStartDurations(null, { work: '9999' }, prefs),
    );
    assert.equal(code, 1);
  });

  it('--frequency 0 is rejected before it can reach the timer', async () => {
    const { code } = await runCmd(() =>
      resolveStartDurations(null, { frequency: '0' }, prefs),
    );
    assert.equal(code, 1);
  });
});

describe('M1: persisted defaults reach pomo start (the PR #11 headline claim)', () => {
  let env, cleanup;

  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
  });
  after(() => cleanup());

  it('a value set via `pomo work`/`pomo frequency` flows through readPrefs into resolveStartDurations exactly as cmdStart would use it', async () => {
    await runCmd(() => cmdWork({ positional: ['50'], flags: {} }, env));
    await runCmd(() => cmdFrequency({ positional: ['6'], flags: {} }, env));

    const config = resolveStartDurations(null, {}, readPrefs(env));
    assert.equal(config.work, 50);
    assert.equal(config.frequency, 6);
  });
});

describe('M1: pomo status Durations line', () => {
  it('idle status previews the persisted prefs', () => {
    const out = withNoColor(() =>
      renderStatus(
        makeIdleState(),
        { completedToday: 0, focusMinToday: 0 },
        { work: 50, short: 10, long: 20, frequency: 6 },
      ),
    );
    assert.ok(out.includes('Durations: 50/10/20'));
    assert.ok(out.includes('every 6'));
  });

  it('running status shows the live session config, even if prefs changed mid-session', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({
      end_epoch: now + 1000,
      config: { work: 25, short: 5, long: 15, frequency: 4 },
    });
    const aggregates = {
      completedToday: 0,
      focusMinToday: 0,
      setIndex: 0,
      setNumber: 1,
      frequency: 4,
    };
    // Prefs say 90/10/20/6 now, but this session started under the classic defaults.
    const out = withNoColor(() =>
      renderStatus(state, aggregates, { work: 90, short: 10, long: 20, frequency: 6 }),
    );
    assert.ok(out.includes('Durations: 25/5/15'));
    assert.ok(out.includes('every 4'));
  });

  it('degrades to the built-in defaults when passed a prefs object missing duration keys', () => {
    const out = withNoColor(() =>
      renderStatus(makeIdleState(), null, { mode: 'auto', view: 'classic' }),
    );
    assert.ok(out.includes('Durations: 25/5/15'));
    assert.ok(out.includes('every 4'));
    assert.ok(!out.includes('undefined'));
  });
});
