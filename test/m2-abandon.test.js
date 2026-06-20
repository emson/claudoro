/**
 * M2/D-012: abandoned time is credited, not counted (forgotten timer).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeRunningState } from './helpers.js';
import * as T from '../src/timer.js';
import { creditedMin, wasAbandoned, overtimeExceeded } from '../src/derive.js';
import { foldStats } from '../src/stats.js';

// makeRunningState: started 1000, end_epoch 2500 (25 min), planned_min 25,
// config without max_overtime so the default (30) applies → cap = 55 min.
const WAY_LATER = 1000 + 12 * 3600; // ~12h after start, forgotten timer

describe('timer: stop on a forgotten block (TEST-M2-004)', () => {
  it('credits focus up to planned + max_overtime and flags abandoned', () => {
    const { record } = T.stop(makeRunningState(), { nowSec: WAY_LATER });
    assert.equal(record.actual_min, 55, 'capped at planned(25) + max_overtime(30)');
    assert.equal(record.overtime_min, 30, 'overtime capped at max_overtime');
    assert.equal(record.abandoned, true);
    assert.equal(record.started, 1000, 'true span preserved');
    assert.equal(record.ended, WAY_LATER, 'true span preserved');
  });

  it('--full records the true elapsed and is not flagged abandoned', () => {
    const { record } = T.stop(makeRunningState(), { nowSec: WAY_LATER, full: true });
    assert.equal(record.actual_min, 720, 'full 12h elapsed');
    assert.equal(record.abandoned, false);
  });

  it('leaves a normal block (modest overtime) untouched', () => {
    // 5 minutes past the 25-min end → 30 min elapsed, well under the cap.
    const { record } = T.stop(makeRunningState(), { nowSec: 2500 + 5 * 60 });
    assert.equal(record.actual_min, 30);
    assert.equal(record.overtime_min, 5);
    assert.equal(record.abandoned, false);
  });
});

describe('timer: next / auto-reconcile and the cap', () => {
  it('next at a long-overdue boundary also caps and flags', () => {
    const { record } = T.next(makeRunningState(), { nowSec: WAY_LATER });
    assert.equal(record.actual_min, 55);
    assert.equal(record.abandoned, true);
  });

  it('auto-reconcile finalizes at end_epoch, so it is never abandoned', () => {
    // reconcileStep finalizes the completed phase at end_epoch regardless of how
    // late detection is, so the abandoned cap never trips on the auto path.
    const result = T.reconcileStep(makeRunningState(), WAY_LATER);
    assert.equal(result.record.actual_min, 25, 'credited the planned duration');
    assert.equal(result.record.abandoned, false);
  });
});

describe('timer: a held boundary auto-closes once forgotten (D-012)', () => {
  const HELD_LONG = 2500 + 40 * 60; // 40 min past end, beyond the 30-min hold window
  const HELD_BRIEF = 2500 + 10 * 60; // 10 min past end, still inside the window

  it('auto-closes a manual focus boundary held past max_overtime, with full credit', () => {
    const result = T.reconcileStep(makeRunningState({ mode: 'manual' }), HELD_LONG);
    assert.equal(
      result.state.run_state,
      'idle',
      'returns to idle, not +overtime forever',
    );
    assert.equal(result.state.phase, null);
    assert.equal(result.record.actual_min, 25, 'planned duration credited');
    assert.equal(
      result.record.abandoned,
      false,
      'the focus itself was real, not abandoned',
    );
  });

  it('still holds a boundary that is only briefly overdue', () => {
    assert.equal(T.reconcileStep(makeRunningState({ mode: 'manual' }), HELD_BRIEF), null);
  });

  it('does not change the auto path (advances, never auto-closes)', () => {
    const result = T.reconcileStep(makeRunningState(), HELD_LONG); // mode auto
    assert.equal(result.state.run_state, 'running');
    assert.equal(result.state.phase, 'short_break');
  });

  it('overtimeExceeded gates the render-path reconcile cheaply', () => {
    assert.equal(overtimeExceeded(makeRunningState({ mode: 'manual' }), HELD_LONG), true);
    assert.equal(
      overtimeExceeded(makeRunningState({ mode: 'manual' }), HELD_BRIEF),
      false,
    );
    assert.equal(
      overtimeExceeded(makeRunningState({ run_state: 'idle' }), HELD_LONG),
      false,
    );
  });
});

describe('derive: creditedMin / wasAbandoned (read-time defense)', () => {
  const legacyBad = {
    phase: 'focus',
    status: 'completed',
    planned_min: 25,
    actual_min: 692,
  };
  const normal = { phase: 'focus', status: 'completed', planned_min: 25, actual_min: 25 };

  it('clamps an unflagged legacy record to planned + default cap', () => {
    assert.equal(creditedMin(legacyBad), 55);
    assert.equal(creditedMin(normal), 25);
  });

  it('detects abandonment by magnitude even without the flag', () => {
    assert.equal(wasAbandoned(legacyBad), true);
    assert.equal(wasAbandoned(normal), false);
  });

  it('stats never count a legacy abandoned record beyond the cap', () => {
    const now = 1_750_000_000;
    const rec = {
      ...legacyBad,
      started: now,
      ended: now + 692 * 60,
      config_snapshot: {},
    };
    const p = foldStats([rec], now);
    assert.equal(
      p.totals.focusMin,
      55,
      'poison record contributes only its credited cap',
    );
  });
});
