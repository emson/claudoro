/**
 * M6 output tests (TEST-M6-001 from spec.md)
 * TTY vs captured output: ANSI present on TTY, plain text when piped.
 *
 * We test the pure `renderHelp` function; TTY detection itself is tested
 * by checking that colorMode() is a function returning a boolean.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderHelp,
  colorMode,
  renderStatus,
  renderLog,
  renderBackups,
  COMMAND_HELP,
} from '../src/output.js';
import { makeRunningState, makeIdleState } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers for color-off tests
// ---------------------------------------------------------------------------

/** Run fn with CLAUDORO_COLOR=never so all ANSI wrappers no-op. */
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

describe('M6: renderHelp', () => {
  it('returns a non-empty string', () => {
    const out = renderHelp(null, { mode: 'auto', view: 'classic' });
    assert.ok(out.length > 100);
  });

  it('includes all major verb sections', () => {
    const out = renderHelp();
    assert.ok(out.includes('start'));
    assert.ok(out.includes('pause'));
    assert.ok(out.includes('status'));
    assert.ok(out.includes('undo'));
    assert.ok(out.includes('setup'));
  });

  it('shows current mode in prefs hint', () => {
    const out = renderHelp(null, { mode: 'manual', view: 'classic' });
    assert.ok(out.includes('manual'));
  });
});

// ---------------------------------------------------------------------------
// renderStatus tests (TEST-M6-002)
// ---------------------------------------------------------------------------

describe('M6: renderStatus — idle', () => {
  it('returns idle block with Today and Config lines', () => {
    const out = withNoColor(() =>
      renderStatus(
        makeIdleState(),
        { completedToday: 0, focusMinToday: 0 },
        { mode: 'auto', view: 'classic' },
      ),
    );
    assert.ok(out.includes('Idle'));
    assert.ok(out.includes('Mode:'));
    assert.ok(out.includes('Today:'));
    assert.ok(!out.includes('—'), 'no em-dashes allowed');
  });

  it('handles null state gracefully', () => {
    const out = withNoColor(() => renderStatus(null, null, {}));
    assert.ok(out.includes('Idle'));
    assert.ok(!out.includes('—'));
  });
});

describe('M6: renderStatus — running focus', () => {
  it('includes phase name, time remaining, and percent', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({ end_epoch: now + 18 * 60 + 32, planned_min: 25 });
    const aggregates = {
      completedToday: 2,
      focusMinToday: 50,
      setIndex: 2,
      setNumber: 1,
      frequency: 4,
    };
    const out = withNoColor(() =>
      renderStatus(state, aggregates, { mode: 'auto', view: 'classic' }),
    );
    assert.ok(out.includes('Focus'));
    assert.ok(out.includes('remaining'));
    assert.ok(out.includes('%'));
    assert.ok(!out.includes('—'), 'no em-dashes');
  });

  it('shows Today line with correct pomodoro count', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({ end_epoch: now + 1000 });
    const aggregates = {
      completedToday: 3,
      focusMinToday: 75,
      setIndex: 3,
      setNumber: 1,
      frequency: 4,
    };
    const out = withNoColor(() => renderStatus(state, aggregates, {}));
    assert.ok(out.includes('3 pomodoros'));
    assert.ok(out.includes('75 min focus'));
    assert.ok(!out.includes('—'));
  });

  it('shows singular pomodoro when count is 1', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({ end_epoch: now + 1000 });
    const aggregates = {
      completedToday: 1,
      focusMinToday: 25,
      setIndex: 1,
      setNumber: 1,
      frequency: 4,
    };
    const out = withNoColor(() => renderStatus(state, aggregates, {}));
    assert.ok(out.includes('1 pomodoro'));
    assert.ok(!out.includes('1 pomodoros'), 'should not pluralize 1');
    assert.ok(!out.includes('—'));
  });

  it('includes label line when label is set', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({ end_epoch: now + 1000, label: 'deep work' });
    const aggregates = {
      completedToday: 0,
      focusMinToday: 0,
      setIndex: 1,
      setNumber: 1,
      frequency: 4,
    };
    const out = withNoColor(() => renderStatus(state, aggregates, {}));
    assert.ok(out.includes('Label:'));
    assert.ok(out.includes('"deep work"'));
    assert.ok(!out.includes('—'));
  });

  it('omits label line when no label', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({ end_epoch: now + 1000, label: null });
    const aggregates = {
      completedToday: 0,
      focusMinToday: 0,
      setIndex: 1,
      setNumber: 1,
      frequency: 4,
    };
    const out = withNoColor(() => renderStatus(state, aggregates, {}));
    assert.ok(!out.includes('Label:'));
    assert.ok(!out.includes('—'));
  });
});

describe('M6: renderStatus — paused', () => {
  it('shows Paused with phase and time left', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({
      run_state: 'paused',
      paused_at: now - 10,
      end_epoch: now + 1000,
    });
    const aggregates = {
      completedToday: 0,
      focusMinToday: 0,
      setIndex: 1,
      setNumber: 1,
      frequency: 4,
    };
    const out = withNoColor(() => renderStatus(state, aggregates, {}));
    assert.ok(out.includes('Paused'));
    assert.ok(out.includes('Focus'));
    assert.ok(out.includes('left'));
    assert.ok(!out.includes('—'));
  });
});

describe('M6: renderStatus — overtime', () => {
  it('shows overtime headline and nudge line', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({ end_epoch: now - 130 });
    const aggregates = {
      completedToday: 0,
      focusMinToday: 0,
      setIndex: 1,
      setNumber: 1,
      frequency: 4,
    };
    const out = withNoColor(() => renderStatus(state, aggregates, {}));
    assert.ok(out.includes('+'), 'overtime should show + prefix');
    assert.ok(out.includes('over'));
    assert.ok(out.includes('pomo next'));
    assert.ok(!out.includes('—'));
  });
});

describe('M6: renderStatus — next long break wording', () => {
  it('says "after this focus" when untilLong is 1', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({ end_epoch: now + 1000, set_index: 3 });
    // setIndex=3, frequency=4: pos=3, untilLong=4-3=1
    const aggregates = {
      completedToday: 3,
      focusMinToday: 75,
      setIndex: 3,
      setNumber: 1,
      frequency: 4,
    };
    const out = withNoColor(() => renderStatus(state, aggregates, {}));
    assert.ok(out.includes('after this focus'));
    assert.ok(!out.includes('—'));
  });

  it('says "after N more focuses" when untilLong > 1', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({ end_epoch: now + 1000, set_index: 1 });
    // setIndex=1, frequency=4: pos=1, untilLong=4-1=3
    const aggregates = {
      completedToday: 1,
      focusMinToday: 25,
      setIndex: 1,
      setNumber: 1,
      frequency: 4,
    };
    const out = withNoColor(() => renderStatus(state, aggregates, {}));
    assert.ok(out.includes('3 more focuses'));
    assert.ok(!out.includes('—'));
  });

  it('resets to freq when setIndex is at boundary (fresh set)', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({ end_epoch: now + 1000, set_index: 0 });
    // setIndex=0, frequency=4: pos=0, untilLong=freq=4
    const aggregates = {
      completedToday: 0,
      focusMinToday: 0,
      setIndex: 0,
      setNumber: 1,
      frequency: 4,
    };
    const out = withNoColor(() => renderStatus(state, aggregates, {}));
    assert.ok(out.includes('4 more focuses'));
    assert.ok(!out.includes('—'));
  });
});

describe('M6: renderStatus — no ANSI in plain output', () => {
  it('contains no ANSI escape sequences when CLAUDORO_COLOR=never', () => {
    const now = Math.floor(Date.now() / 1000);
    const state = makeRunningState({ end_epoch: now + 1000 });
    const aggregates = {
      completedToday: 2,
      focusMinToday: 50,
      setIndex: 2,
      setNumber: 1,
      frequency: 4,
    };
    const out = withNoColor(() =>
      renderStatus(state, aggregates, { mode: 'auto', view: 'classic' }),
    );
    // ANSI sequences start with \x1b[
    assert.ok(!out.includes('\x1b['), 'no ANSI escape codes in plain output');
    assert.ok(!out.includes('—'), 'no em-dashes');
  });
});

describe('M6: colorMode', () => {
  it('returns a boolean', () => {
    assert.equal(typeof colorMode(), 'boolean');
  });

  it('returns false when NO_COLOR is set', () => {
    const orig = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    assert.equal(colorMode(), false);
    if (orig === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = orig;
  });

  it('returns false when CLAUDORO_COLOR=never', () => {
    const orig = process.env.CLAUDORO_COLOR;
    process.env.CLAUDORO_COLOR = 'never';
    assert.equal(colorMode(), false);
    if (orig === undefined) delete process.env.CLAUDORO_COLOR;
    else process.env.CLAUDORO_COLOR = orig;
  });

  it('returns true when CLAUDORO_COLOR=always', () => {
    const orig = process.env.CLAUDORO_COLOR;
    process.env.CLAUDORO_COLOR = 'always';
    assert.equal(colorMode(), true);
    if (orig === undefined) delete process.env.CLAUDORO_COLOR;
    else process.env.CLAUDORO_COLOR = orig;
  });
});

// ---------------------------------------------------------------------------
// renderLog tests (TEST-M6-003)
// ---------------------------------------------------------------------------

/** Build a minimal PhaseRecord for testing. */
const makeRecord = (overrides = {}) => ({
  id: 'test-001',
  schema: 1,
  phase: 'focus',
  status: 'completed',
  started: 1750000000,
  ended: 1750001500,
  planned_min: 25,
  actual_min: 25,
  overtime_min: 0,
  label: null,
  config_snapshot: { frequency: 4 },
  ...overrides,
});

describe('M6: renderLog — empty', () => {
  it('returns exact empty-state string when no records', () => {
    const out = withNoColor(() =>
      renderLog('2026-06-17', [], { completedToday: 0, focusMinToday: 0 }),
    );
    assert.equal(out, 'No records for 2026-06-17.');
  });

  it('handles null records gracefully', () => {
    const out = withNoColor(() =>
      renderLog('2026-06-17', null, { completedToday: 0, focusMinToday: 0 }),
    );
    assert.equal(out, 'No records for 2026-06-17.');
  });

  it('contains no em-dash in empty output', () => {
    const out = renderLog('2026-06-17', [], { completedToday: 0, focusMinToday: 0 });
    assert.ok(!out.includes('—'), 'no em-dashes');
  });
});

describe('M6: renderLog — with records', () => {
  it('includes date in header', () => {
    const records = [makeRecord()];
    const out = withNoColor(() =>
      renderLog('2026-06-17', records, { completedToday: 1, focusMinToday: 25 }),
    );
    assert.ok(out.includes('2026-06-17'), 'header contains the date');
  });

  it('shows completed count and focus total in header', () => {
    const records = [makeRecord(), makeRecord({ id: 'test-002' })];
    const out = withNoColor(() =>
      renderLog('2026-06-17', records, { completedToday: 2, focusMinToday: 50 }),
    );
    assert.ok(out.includes('2 completed'));
    assert.ok(out.includes('50m focus'));
  });

  it('renders one row per record', () => {
    const records = [
      makeRecord({ id: 'a' }),
      makeRecord({ id: 'b' }),
      makeRecord({ id: 'c' }),
    ];
    const out = withNoColor(() =>
      renderLog('2026-06-17', records, { completedToday: 3, focusMinToday: 75 }),
    );
    const lines = out.split('\n');
    // rows appear between blank separator lines; at least 3 non-empty row lines
    const dataLines = lines.filter((l) => l.trim().length > 0);
    assert.ok(dataLines.length >= 5, 'header + 3 rows + footer at minimum');
  });

  it('shows status words: done for completed', () => {
    const records = [makeRecord({ status: 'completed' })];
    const out = withNoColor(() =>
      renderLog('2026-06-17', records, { completedToday: 1, focusMinToday: 25 }),
    );
    assert.ok(out.includes('done'));
  });

  it('shows status words: skip/stop/part for other statuses', () => {
    const records = [
      makeRecord({ id: 'a', status: 'skipped' }),
      makeRecord({ id: 'b', status: 'aborted' }),
      makeRecord({ id: 'c', status: 'partial' }),
    ];
    const out = withNoColor(() =>
      renderLog('2026-06-17', records, { completedToday: 0, focusMinToday: 0 }),
    );
    assert.ok(out.includes('skip'));
    assert.ok(out.includes('stop'));
    assert.ok(out.includes('part'));
  });

  it('shows label when set', () => {
    const records = [makeRecord({ label: 'deep work' })];
    const out = withNoColor(() =>
      renderLog('2026-06-17', records, { completedToday: 1, focusMinToday: 25 }),
    );
    assert.ok(out.includes('deep work'));
  });

  it('shows footer with total focus', () => {
    const records = [makeRecord({ actual_min: 90 })];
    const out = withNoColor(() =>
      renderLog('2026-06-17', records, { completedToday: 1, focusMinToday: 90 }),
    );
    assert.ok(out.includes('total focus'));
    assert.ok(out.includes('1h 30m'));
  });

  it('contains no ANSI when CLAUDORO_COLOR=never', () => {
    const records = [makeRecord()];
    const out = withNoColor(() =>
      renderLog('2026-06-17', records, { completedToday: 1, focusMinToday: 25 }),
    );
    assert.ok(!out.includes('\x1b['), 'no ANSI in plain output');
  });

  it('contains no em-dash in any output', () => {
    const records = [makeRecord({ label: 'test task' })];
    const out = renderLog('2026-06-17', records, {
      completedToday: 1,
      focusMinToday: 25,
    });
    assert.ok(!out.includes('—'), 'no em-dashes');
  });
});

// ---------------------------------------------------------------------------
// renderBackups tests (TEST-M6-004)
// ---------------------------------------------------------------------------

describe('M6: renderBackups — empty', () => {
  it('returns exact empty-state string', () => {
    const out = withNoColor(() => renderBackups([]));
    assert.equal(out, 'No backups yet.');
  });

  it('handles null gracefully', () => {
    const out = withNoColor(() => renderBackups(null));
    assert.equal(out, 'No backups yet.');
  });

  it('contains no em-dash', () => {
    const out = renderBackups([]);
    assert.ok(!out.includes('—'), 'no em-dashes');
  });
});

describe('M6: renderBackups — populated', () => {
  it('shows Backups header', () => {
    const out = withNoColor(() => renderBackups(['2026-06-17T14-30-05-000Z']));
    assert.ok(out.includes('Backups'));
  });

  it('includes each backup id', () => {
    const ids = ['2026-06-17T14-30-05-000Z', '2026-06-16T09-00-00-000Z'];
    const out = withNoColor(() => renderBackups(ids));
    for (const id of ids) {
      assert.ok(out.includes(id), `output should include ${id}`);
    }
  });

  it('parses backup id into readable time', () => {
    const out = withNoColor(() => renderBackups(['2026-06-17T14-30-05-000Z']));
    assert.ok(out.includes('2026-06-17 14:30:05'), 'formatted time shown');
  });

  it('degrades gracefully for malformed ids', () => {
    const out = withNoColor(() => renderBackups(['not-a-valid-id']));
    assert.ok(out.includes('not-a-valid-id'), 'raw id shown on parse failure');
  });

  it('contains no ANSI when CLAUDORO_COLOR=never', () => {
    const out = withNoColor(() => renderBackups(['2026-06-17T14-30-05-000Z']));
    assert.ok(!out.includes('\x1b['), 'no ANSI in plain output');
  });

  it('contains no em-dash', () => {
    const out = renderBackups(['2026-06-17T14-30-05-000Z']);
    assert.ok(!out.includes('—'), 'no em-dashes');
  });
});

// ---------------------------------------------------------------------------
// renderCommandHelp tests (TEST-M6-005)
// ---------------------------------------------------------------------------

describe('M6: renderCommandHelp — start', () => {
  it('contains USAGE section', () => {
    const out = withNoColor(() => renderHelp('start'));
    assert.ok(out.includes('USAGE'), 'should include USAGE header');
  });

  it('contains EXAMPLES section', () => {
    const out = withNoColor(() => renderHelp('start'));
    assert.ok(out.includes('EXAMPLES'), 'should include EXAMPLES header');
  });

  it('contains the verb in the page', () => {
    const out = withNoColor(() => renderHelp('start'));
    assert.ok(out.includes('pomo start'), 'should include pomo start');
  });

  it('contains the label note', () => {
    const out = withNoColor(() => renderHelp('start'));
    assert.ok(out.includes('label'), 'should include label note');
  });

  it('contains FLAGS section', () => {
    const out = withNoColor(() => renderHelp('start'));
    assert.ok(out.includes('FLAGS'), 'should include FLAGS header');
  });

  it('contains NOTES section', () => {
    const out = withNoColor(() => renderHelp('start'));
    assert.ok(out.includes('NOTES'), 'should include NOTES header');
  });

  it('contains no em-dashes', () => {
    const out = renderHelp('start');
    assert.ok(!out.includes('—'), 'no em-dashes in start help');
  });
});

describe('M6: renderCommandHelp — unknown topic fallback', () => {
  it('returns fallback message for unknown topic', () => {
    const out = withNoColor(() => renderHelp('frobnicate'));
    assert.ok(
      out.includes("Unknown command 'frobnicate'"),
      'should identify the unknown command',
    );
  });

  it('lists known commands in fallback', () => {
    const out = withNoColor(() => renderHelp('frobnicate'));
    assert.ok(out.includes('start'), 'fallback should list start among known commands');
    assert.ok(out.includes('pause'), 'fallback should list pause among known commands');
  });

  it('does not throw on unknown topic', () => {
    assert.doesNotThrow(() => renderHelp('not-a-real-command'));
  });

  it('suggests pomo help in fallback', () => {
    const out = withNoColor(() => renderHelp('bogus'));
    assert.ok(out.includes('pomo help'), 'fallback should point to pomo help');
  });
});

describe('M6: renderCommandHelp — dash normalisation', () => {
  it('--start resolves to same output as start', () => {
    const withDash = withNoColor(() => renderHelp('--start'));
    const withoutDash = withNoColor(() => renderHelp('start'));
    assert.equal(withDash, withoutDash, '--start should equal start output');
  });
});

describe('M6: COMMAND_HELP coverage — all CLI verbs present', () => {
  const SPEC_VERBS = [
    'start',
    'pause',
    'resume',
    'stop',
    'skip',
    'reset',
    'next',
    'back',
    'extend',
    'mode',
    'view',
    'note',
    'tag',
    'label',
    'mute',
    'unmute',
    'status',
    'stats',
    'guide',
    'log',
    'undo',
    'restore',
    'setup',
    'uninstall',
    'help',
  ];

  for (const verb of SPEC_VERBS) {
    it(`COMMAND_HELP has entry for '${verb}'`, () => {
      assert.ok(
        COMMAND_HELP[verb] !== undefined,
        `COMMAND_HELP missing entry for verb: ${verb}`,
      );
    });
  }
});

describe('M6: COMMAND_HELP em-dash guard', () => {
  it('no entry contains an em-dash character', () => {
    const serialised = JSON.stringify(COMMAND_HELP);
    assert.ok(!serialised.includes('—'), 'COMMAND_HELP must not contain em-dashes');
  });
});

describe('M6: renderCommandHelp — no ANSI in plain output', () => {
  it('contains no ANSI escape sequences when CLAUDORO_COLOR=never', () => {
    const out = withNoColor(() => renderHelp('undo'));
    assert.ok(!out.includes('\x1b['), 'no ANSI escape codes in plain output');
  });

  it('undo page contains no em-dashes', () => {
    const out = renderHelp('undo');
    assert.ok(!out.includes('—'), 'no em-dashes in undo help');
  });
});
