/**
 * M2 timer engine tests (TEST-M2-002, TEST-M2-003 from spec.md)
 * Pure unit tests — no I/O.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../src/timer.js';
import { makeIdleState, makeRunningState } from './helpers.js';

const NOW = 1_000_000;

describe('M2: start', () => {
  it('transitions idle → running focus', () => {
    const s = makeIdleState();
    const result = T.start(s, { config: s.config, nowSec: NOW });
    assert.ok(result, 'should return a result');
    assert.equal(result.state.run_state, 'running');
    assert.equal(result.state.phase, 'focus');
    assert.equal(result.state.end_epoch, NOW + 25 * 60);
  });

  it('returns null when already running (idempotent — never duplicate)', () => {
    const s = makeRunningState();
    const result = T.start(s, { nowSec: NOW });
    assert.equal(result, null);
  });

  it('respects custom work duration (TEST-M2-002)', () => {
    const s = makeIdleState();
    const config = { ...s.config, work: 50 };
    const result = T.start(s, { config, nowSec: NOW });
    assert.equal(result.state.planned_min, 50);
    assert.equal(result.state.end_epoch, NOW + 50 * 60);
  });

  it('sets label when provided', () => {
    const s = makeIdleState();
    const result = T.start(s, { config: s.config, label: 'write tests', nowSec: NOW });
    assert.equal(result.state.label, 'write tests');
  });
});

describe('M2: pause / resume', () => {
  it('running → paused', () => {
    const s = makeRunningState({ end_epoch: NOW + 100 });
    const result = T.pause(s, { nowSec: NOW });
    assert.equal(result.state.run_state, 'paused');
    assert.equal(result.state.paused_at, NOW);
  });

  it('resume shifts end_epoch by paused span', () => {
    const s = makeRunningState({
      run_state: 'paused',
      end_epoch: NOW + 100,
      paused_at: NOW,
    });
    const result = T.resume(s, { nowSec: NOW + 30 });
    assert.equal(result.state.run_state, 'running');
    assert.equal(result.state.paused_at, null);
    assert.equal(result.state.end_epoch, NOW + 130); // shifted by 30s
    assert.equal(result.state.paused_total_sec, 30);
  });

  it('pause returns null when idle', () => {
    assert.equal(T.pause(makeIdleState(), { nowSec: NOW }), null);
  });
});

describe('M2: toggle (TEST-M2-004, D-010)', () => {
  const MS = NOW * 1000;

  it('pauses a running timer', () => {
    const s = makeRunningState({ end_epoch: NOW + 100 });
    const result = T.toggle(s, { nowSec: NOW, nowMs: MS });
    assert.equal(result.state.run_state, 'paused');
    assert.equal(result.state.paused_at, NOW);
    assert.equal(result.state.last_toggle_ms, MS);
  });

  it('resumes a paused timer, shifting end_epoch by the paused span', () => {
    const s = makeRunningState({
      run_state: 'paused',
      end_epoch: NOW + 100,
      paused_at: NOW,
    });
    const result = T.toggle(s, { nowSec: NOW + 30, nowMs: MS + 30_000 });
    assert.equal(result.state.run_state, 'running');
    assert.equal(result.state.end_epoch, NOW + 130);
    assert.equal(result.state.paused_total_sec, 30);
  });

  it('returns null when idle (nothing to toggle)', () => {
    assert.equal(T.toggle(makeIdleState(), { nowSec: NOW, nowMs: MS }), null);
  });

  it('debounces a second toggle within the window (double-click is a no-op)', () => {
    const s = makeRunningState({ end_epoch: NOW + 100, last_toggle_ms: MS });
    const within = T.toggle(s, { nowSec: NOW, nowMs: MS + T.TOGGLE_DEBOUNCE_MS - 1 });
    assert.equal(within, null, 'a toggle inside the window is dropped');

    const after = T.toggle(s, { nowSec: NOW, nowMs: MS + T.TOGGLE_DEBOUNCE_MS });
    assert.ok(after, 'a toggle at/after the window takes effect');
    assert.equal(after.state.run_state, 'paused');
  });
});

describe('M2: stop', () => {
  it('returns idle state and a record with status=aborted', () => {
    const s = makeRunningState();
    const result = T.stop(s, { nowSec: NOW + 60 });
    assert.equal(result.state.run_state, 'idle');
    assert.equal(result.record.status, 'aborted');
    assert.equal(result.record.phase, 'focus');
  });

  it('returns null when already idle', () => {
    assert.equal(T.stop(makeIdleState(), { nowSec: NOW }), null);
  });
});

describe('M2: extend', () => {
  it('adds minutes to end_epoch', () => {
    const s = makeRunningState({ end_epoch: NOW + 100 });
    const result = T.extend(s, { minutes: 5 });
    assert.equal(result.state.end_epoch, NOW + 100 + 5 * 60);
  });

  it('returns null when idle', () => {
    assert.equal(T.extend(makeIdleState(), { minutes: 5 }), null);
  });
});

describe('M2: reset', () => {
  it('restarts the current phase without advancing set_index', () => {
    const s = makeRunningState({ set_index: 2, planned_min: 25 });
    const result = T.reset(s, { nowSec: NOW });
    assert.equal(result.state.run_state, 'running');
    assert.equal(result.state.set_index, 2); // unchanged
    assert.equal(result.state.end_epoch, NOW + 25 * 60);
  });
});

describe('M2: skip always advances to a running phase (mode-independent)', () => {
  // skip/next are explicit user actions: they always advance and run. Only the
  // AUTOMATIC boundary (reconcileStep) respects the mode's wait behaviour.
  it('skip from focus enters the break, running, with a fresh record id', () => {
    const s = makeRunningState({ mode: 'manual', phase: 'focus', set_index: 0 });
    const { state, record } = T.skip(s, { nowSec: NOW });
    assert.equal(state.phase, 'short_break');
    assert.equal(state.run_state, 'running');
    assert.equal(record.status, 'skipped');
    assert.notEqual(state.current_record_id, s.current_record_id);
  });

  it('long break arrives at the frequency boundary and resets the set', () => {
    const s = makeRunningState({
      mode: 'auto',
      phase: 'focus',
      set_index: 3,
      config: { work: 25, short: 5, long: 15, frequency: 4, notify: 1, mute: false },
    });
    const { state } = T.skip(s, { nowSec: NOW });
    assert.equal(state.phase, 'long_break');
    assert.equal(state.planned_min, 15);
  });

  it('long break → focus increments set_number and resets set_index', () => {
    const s = makeRunningState({ phase: 'long_break', set_index: 4, set_number: 1 });
    const { state } = T.skip(s, { nowSec: NOW });
    assert.equal(state.phase, 'focus');
    assert.equal(state.set_number, 2);
    assert.equal(state.set_index, 0);
  });
});

describe('M2: reconcileStep — the daemonless natural-boundary driver (D-006a)', () => {
  const END = NOW + 25 * 60;

  it('does nothing before the phase ends', () => {
    const s = makeRunningState({ mode: 'auto', end_epoch: END });
    assert.equal(T.reconcileStep(s, END - 1), null);
  });

  it('auto advances into the break and finalizes a completed record', () => {
    const s = makeRunningState({ mode: 'auto', phase: 'focus', end_epoch: END });
    const result = T.reconcileStep(s, END + 5);
    assert.ok(result, 'should advance');
    assert.equal(result.state.phase, 'short_break');
    assert.equal(result.state.run_state, 'running');
    assert.equal(result.record.status, 'completed');
    // Finalized at the planned end, not the detection time — no phantom overtime.
    assert.equal(result.record.ended, END);
    assert.equal(result.record.overtime_min, 0);
  });

  it('manual holds the focus in overtime (no auto-advance)', () => {
    const s = makeRunningState({ mode: 'manual', phase: 'focus', end_epoch: END });
    assert.equal(T.reconcileStep(s, END + 60), null);
  });

  it('balanced auto-advances into a break but holds at break→focus', () => {
    const intoBreak = T.reconcileStep(
      makeRunningState({ mode: 'balanced', phase: 'focus', end_epoch: END }),
      END + 1,
    );
    assert.equal(intoBreak.state.phase, 'short_break');
    assert.equal(intoBreak.state.run_state, 'running');

    const atBreakEnd = makeRunningState({
      mode: 'balanced',
      phase: 'short_break',
      end_epoch: END,
    });
    assert.equal(T.reconcileStep(atBreakEnd, END + 1), null); // waits to start focus
  });
});

describe('M2: next resolves a waiting boundary', () => {
  const END = NOW + 25 * 60;

  it('is a no-op before the phase is overdue', () => {
    const s = makeRunningState({ mode: 'manual', phase: 'focus', end_epoch: END });
    assert.equal(T.next(s, { nowSec: END - 1 }), null);
  });

  it('finalizes the overtime-held phase and starts the next, running', () => {
    const s = makeRunningState({ mode: 'manual', phase: 'focus', end_epoch: END });
    const result = T.next(s, { nowSec: END + 90 });
    assert.ok(result);
    assert.equal(result.state.phase, 'short_break');
    assert.equal(result.state.run_state, 'running');
    assert.equal(result.record.status, 'completed');
    // next captures the overtime as real elapsed work (ended = now, not end_epoch).
    assert.equal(result.record.ended, END + 90);
  });
});

describe('M2: back_checkpoint — written by transitions', () => {
  const END = NOW + 25 * 60;

  it('skip writes a back_checkpoint on the new state', () => {
    const s = makeRunningState({ phase: 'focus', set_index: 0, end_epoch: END });
    const { state } = T.skip(s, { nowSec: NOW });
    assert.ok(state.back_checkpoint, 'checkpoint should be set');
    assert.equal(state.back_checkpoint.transition_epoch, NOW);
    assert.equal(typeof state.back_checkpoint.record_id, 'string');
    // Nested checkpoint must be null (no nesting)
    assert.equal(state.back_checkpoint.state.back_checkpoint, null);
  });

  it('next writes a back_checkpoint on the new state', () => {
    const s = makeRunningState({ mode: 'manual', phase: 'focus', end_epoch: END });
    const { state } = T.next(s, { nowSec: END + 10 });
    assert.ok(state.back_checkpoint);
    assert.equal(state.back_checkpoint.transition_epoch, END + 10);
    assert.equal(state.back_checkpoint.state.back_checkpoint, null);
  });

  it('reconcileStep writes a back_checkpoint using detection time as transition_epoch', () => {
    const s = makeRunningState({ mode: 'auto', phase: 'focus', end_epoch: END });
    const detectionTime = END + 5;
    const { state } = T.reconcileStep(s, detectionTime);
    assert.ok(state.back_checkpoint);
    assert.equal(state.back_checkpoint.transition_epoch, detectionTime);
    assert.equal(state.back_checkpoint.state.phase, 'focus');
  });

  it('start clears back_checkpoint', () => {
    const s = makeIdleState({
      back_checkpoint: { state: {}, transition_epoch: 0, record_id: null },
    });
    const { state } = T.start(s, { config: s.config, nowSec: NOW });
    assert.equal(state.back_checkpoint, null);
  });

  it('stop clears back_checkpoint', () => {
    const s = makeRunningState({
      back_checkpoint: { state: {}, transition_epoch: 0, record_id: null },
    });
    const { state } = T.stop(s, { nowSec: NOW });
    assert.equal(state.back_checkpoint, null);
  });

  it('reset clears back_checkpoint', () => {
    const s = makeRunningState({
      back_checkpoint: { state: {}, transition_epoch: 0, record_id: null },
    });
    const { state } = T.reset(s, { nowSec: NOW });
    assert.equal(state.back_checkpoint, null);
  });

  it('pause preserves back_checkpoint (pausing then back still works within window)', () => {
    const cp = { state: makeRunningState(), transition_epoch: NOW, record_id: 'abc' };
    const s = makeRunningState({ back_checkpoint: cp });
    const { state } = T.pause(s, { nowSec: NOW + 10 });
    assert.deepStrictEqual(state.back_checkpoint, cp);
  });
});

describe('M2: back — restore pre-transition state', () => {
  const END = NOW + 25 * 60;

  it('returns {ok:false, reason:"none"} when no checkpoint exists', () => {
    const s = makeRunningState({ back_checkpoint: null });
    const result = T.back(s, { nowSec: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'none');
  });

  it('returns {ok:false, reason:"expired"} when outside the window', () => {
    const prevState = makeRunningState({ phase: 'focus', end_epoch: END });
    const s = makeRunningState({
      phase: 'short_break',
      back_checkpoint: {
        state: prevState,
        transition_epoch: NOW - 200, // 200s ago
        record_id: 'rec-1',
      },
    });
    const result = T.back(s, { nowSec: NOW, windowSec: 120 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'expired');
    assert.ok(result.sinceSec > 120);
    assert.equal(result.windowSec, 120);
  });

  it('restores phase, end_epoch, set_index, alarms_fired within the window', () => {
    const prevState = makeRunningState({
      phase: 'focus',
      end_epoch: END,
      set_index: 1,
      alarms_fired: ['warning', 'end'],
      back_checkpoint: null,
    });
    const s = makeRunningState({
      phase: 'short_break',
      set_index: 2,
      back_checkpoint: {
        state: prevState,
        transition_epoch: NOW - 30,
        record_id: 'rec-1',
      },
    });
    const result = T.back(s, { nowSec: NOW, windowSec: 120 });
    assert.equal(result.ok, true);
    assert.equal(result.state.phase, 'focus');
    assert.equal(result.state.end_epoch, END);
    assert.equal(result.state.set_index, 1);
    assert.deepStrictEqual(result.state.alarms_fired, ['warning', 'end']);
    assert.equal(result.removeRecordId, 'rec-1');
  });

  it('restored state has back_checkpoint: null (non-recursive)', () => {
    const prevState = makeRunningState({ phase: 'focus', back_checkpoint: null });
    const s = makeRunningState({
      phase: 'short_break',
      back_checkpoint: {
        state: prevState,
        transition_epoch: NOW - 10,
        record_id: 'rec-1',
      },
    });
    const result = T.back(s, { nowSec: NOW, windowSec: 120 });
    assert.equal(result.ok, true);
    assert.equal(result.state.back_checkpoint, null);
  });

  it('second back returns {ok:false, reason:"none"} (non-recursive)', () => {
    const prevState = makeRunningState({ phase: 'focus', back_checkpoint: null });
    const s = makeRunningState({
      phase: 'short_break',
      back_checkpoint: {
        state: prevState,
        transition_epoch: NOW - 10,
        record_id: 'rec-1',
      },
    });
    const first = T.back(s, { nowSec: NOW, windowSec: 120 });
    assert.equal(first.ok, true);
    const second = T.back(first.state, { nowSec: NOW, windowSec: 120 });
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'none');
  });

  it('uses config.back_window when windowSec is not passed explicitly', () => {
    const prevState = makeRunningState({ phase: 'focus', back_checkpoint: null });
    const s = makeRunningState({
      phase: 'short_break',
      config: {
        work: 25,
        short: 5,
        long: 15,
        frequency: 4,
        notify: 1,
        mute: false,
        back_window: 60,
      },
      back_checkpoint: {
        state: prevState,
        transition_epoch: NOW - 90, // 90s ago — expired for 60s window
        record_id: 'rec-1',
      },
    });
    const result = T.back(s, { nowSec: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'expired');
    assert.equal(result.windowSec, 60);
  });

  it('removeRecordId is null when checkpoint record_id is null', () => {
    const prevState = makeRunningState({ phase: 'focus', back_checkpoint: null });
    const s = makeRunningState({
      phase: 'short_break',
      back_checkpoint: {
        state: prevState,
        transition_epoch: NOW - 10,
        record_id: null,
      },
    });
    const result = T.back(s, { nowSec: NOW, windowSec: 120 });
    assert.equal(result.ok, true);
    assert.equal(result.removeRecordId, null);
  });
});

describe('M2: CLI arg parsing', () => {
  it('parseArgs handles short flags with values', async () => {
    const { parseArgs } = await import('../src/cli.js');
    const { flags, positional } = parseArgs([
      '-w',
      '50',
      '-s',
      '10',
      'start',
      'my label',
    ]);
    assert.equal(flags.work, '50');
    assert.equal(flags.short, '10');
    assert.equal(positional[0], 'start');
    assert.equal(positional[1], 'my label');
  });

  it('parseArgs handles --flag=value form', async () => {
    const { parseArgs } = await import('../src/cli.js');
    const { flags } = parseArgs(['--work=50', '--dry-run']);
    assert.equal(flags.work, '50');
    assert.equal(flags['dry-run'], true);
  });
});
