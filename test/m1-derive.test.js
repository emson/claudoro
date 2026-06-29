/**
 * M1 derive tests — pure functions, no I/O required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  remaining,
  isOvertime,
  formatMMSS,
  formatFocusMin,
  dateOf,
  nextPhase,
  isLongBreakDue,
  foldRecords,
  deriveCadence,
  parseJsonl,
  progressFraction,
  cuesDue,
} from '../src/derive.js';
import { makeRunningState, makeIdleState } from './helpers.js';

describe('derive: remaining', () => {
  it('returns null when idle', () => {
    assert.equal(remaining(makeIdleState(), 1000), null);
  });

  it('returns 0 when past end_epoch', () => {
    const s = makeRunningState({ end_epoch: 500 });
    assert.equal(remaining(s, 600), 0);
  });

  it('returns frozen remaining when paused', () => {
    const s = makeRunningState({ run_state: 'paused', paused_at: 1100, end_epoch: 1600 });
    assert.equal(remaining(s, 9999), 500); // wall clock irrelevant while paused
  });

  it('decrements with time', () => {
    const s = makeRunningState({ end_epoch: 2000 });
    assert.equal(remaining(s, 1000), 1000);
    assert.equal(remaining(s, 1500), 500);
  });
});

describe('derive: isOvertime', () => {
  it('false when running and before end_epoch', () => {
    const s = makeRunningState({ end_epoch: 2000 });
    assert.equal(isOvertime(s, 1999), false);
  });

  it('true when running past end_epoch', () => {
    const s = makeRunningState({ end_epoch: 2000 });
    assert.equal(isOvertime(s, 2001), true);
  });

  it('false when paused (even past end_epoch)', () => {
    const s = makeRunningState({ run_state: 'paused', end_epoch: 1000 });
    assert.equal(isOvertime(s, 9999), false);
  });
});

describe('derive: formatMMSS', () => {
  it('zero-pads both parts', () => {
    assert.equal(formatMMSS(0), '00:00');
    assert.equal(formatMMSS(61), '01:01');
    assert.equal(formatMMSS(1499), '24:59');
  });

  it('never produces non-5-char output for reasonable values', () => {
    for (const s of [0, 1, 59, 60, 599, 3599]) {
      assert.equal(formatMMSS(s).length, 5);
    }
  });
});

describe('derive: nextPhase', () => {
  it('focus → short_break when not at frequency boundary', () => {
    assert.equal(nextPhase('focus', 1, 4), 'short_break');
    assert.equal(nextPhase('focus', 3, 4), 'short_break');
  });

  it('focus → long_break at frequency boundary', () => {
    assert.equal(nextPhase('focus', 4, 4), 'long_break');
    assert.equal(nextPhase('focus', 8, 4), 'long_break');
  });

  it('break → focus regardless of index', () => {
    assert.equal(nextPhase('short_break', 2, 4), 'focus');
    assert.equal(nextPhase('long_break', 4, 4), 'focus');
  });
});

describe('derive: isLongBreakDue', () => {
  it('true only at multiples of frequency', () => {
    assert.equal(isLongBreakDue(4, 4), true);
    assert.equal(isLongBreakDue(8, 4), true);
    assert.equal(isLongBreakDue(3, 4), false);
    assert.equal(isLongBreakDue(0, 4), false); // not at the very start
  });
});

describe('derive: dateOf is total (never throws on bad input)', () => {
  it('buckets a finite epoch normally', () => {
    assert.equal(dateOf(Date.parse('2026-06-17T09:00:00Z') / 1000), '2026-06-17');
  });

  it('returns the epoch sentinel for a non-finite started, instead of throwing', () => {
    assert.doesNotThrow(() => dateOf(undefined));
    assert.equal(dateOf(undefined), '1970-01-01');
    assert.equal(dateOf(NaN), '1970-01-01');
    assert.equal(dateOf('garbage'), '1970-01-01');
  });
});

describe('derive: formatFocusMin', () => {
  it('formats minutes as the shared "Xh YYm" / "Zm" form', () => {
    assert.equal(formatFocusMin(45), '45m');
    assert.equal(formatFocusMin(125), '2h 05m');
    assert.equal(formatFocusMin(0), '0m');
  });
});

describe('derive: foldRecords', () => {
  it('returns zeros for empty records', () => {
    const r = foldRecords([], '2026-06-17');
    assert.equal(r.completedToday, 0);
    assert.equal(r.focusMinToday, 0);
  });

  it('does not throw on a record with a missing/garbage started', () => {
    const bad = [
      { phase: 'focus', status: 'completed', planned_min: 25, actual_min: 25 },
    ];
    assert.doesNotThrow(() => foldRecords(bad, '2026-06-17'));
  });

  it('counts only completed focus records for today', () => {
    const today = '2026-06-17';
    const records = [
      {
        phase: 'focus',
        status: 'completed',
        started: Date.parse('2026-06-17T09:00:00Z') / 1000,
        planned_min: 25,
        actual_min: 25,
        config_snapshot: { frequency: 4 },
      },
      {
        phase: 'focus',
        status: 'skipped',
        started: Date.parse('2026-06-17T10:00:00Z') / 1000,
        planned_min: 25,
        actual_min: 10,
        config_snapshot: { frequency: 4 },
      },
      {
        phase: 'short_break',
        status: 'completed',
        started: Date.parse('2026-06-17T09:25:00Z') / 1000,
        planned_min: 5,
        actual_min: 5,
        config_snapshot: { frequency: 4 },
      },
    ];
    const r = foldRecords(records, today);
    assert.equal(r.completedToday, 1);
    assert.equal(r.focusMinToday, 25);
  });
});

describe('derive: deriveCadence', () => {
  const focus = (status = 'completed') => ({ phase: 'focus', status });
  const shortBreak = (status = 'completed') => ({ phase: 'short_break', status });
  const longBreak = (status = 'completed') => ({ phase: 'long_break', status });

  it('empty records → position 0, set 1 (fresh, shows ○○○○)', () => {
    assert.deepEqual(deriveCadence([]), { setIndex: 0, setNumber: 1 });
  });

  it('each completed focus advances the position', () => {
    const records = [focus(), shortBreak(), focus(), shortBreak()];
    assert.deepEqual(deriveCadence(records), { setIndex: 2, setNumber: 1 });
  });

  it('a skipped focus still advances (mirrors advanceTo)', () => {
    assert.deepEqual(deriveCadence([focus('skipped')]), { setIndex: 1, setNumber: 1 });
  });

  it('an aborted focus never advances (stop goes idle, no advance)', () => {
    assert.deepEqual(deriveCadence([focus('aborted')]), { setIndex: 0, setNumber: 1 });
  });

  it('short breaks never move the position', () => {
    assert.deepEqual(deriveCadence([shortBreak(), shortBreak()]), {
      setIndex: 0,
      setNumber: 1,
    });
  });

  it('a completed long break closes the set and resets the position', () => {
    const records = [
      focus(),
      shortBreak(),
      focus(),
      shortBreak(),
      focus(),
      shortBreak(),
      focus(),
      longBreak(),
    ];
    assert.deepEqual(deriveCadence(records), { setIndex: 0, setNumber: 2 });
  });

  it('is robust to undo: removing records re-derives a lower position', () => {
    const full = [focus(), shortBreak(), focus()];
    assert.deepEqual(deriveCadence(full), { setIndex: 2, setNumber: 1 });
    // simulate undoing the trailing focus
    assert.deepEqual(deriveCadence(full.slice(0, 2)), { setIndex: 1, setNumber: 1 });
    // simulate undoing everything (the reported bug: should reset to empty dots)
    assert.deepEqual(deriveCadence([]), { setIndex: 0, setNumber: 1 });
  });
});

describe('derive: progressFraction (consistent with remaining)', () => {
  it('is 0 at the start and approaches 1 at the end', () => {
    const s = makeRunningState({
      started: 1000,
      end_epoch: 1000 + 1500,
      planned_min: 25,
    });
    assert.equal(progressFraction(s, 1000), 0);
    assert.ok(Math.abs(progressFraction(s, 1750) - 0.5) < 0.001); // halfway
    assert.equal(progressFraction(s, 2500), 1);
  });

  it('progress + remaining/total always equals 1 (derived consistency)', () => {
    const total = 25 * 60;
    const s = makeRunningState({
      started: 1000,
      end_epoch: 1000 + total,
      planned_min: 25,
    });
    for (const now of [1000, 1300, 1900, 2400]) {
      const frac = progressFraction(s, now);
      const rem = remaining(s, now);
      assert.ok(Math.abs(frac + rem / total - 1) < 1e-9, `inconsistent at now=${now}`);
    }
  });
});

describe('derive: cuesDue', () => {
  it('returns [] when running and nothing due', () => {
    const s = makeRunningState({ end_epoch: 2000, config: { notify: 1 } });
    assert.deepEqual(cuesDue(s, 1000), []);
  });

  it('returns warning when within the notify window', () => {
    const s = makeRunningState({
      end_epoch: 2000,
      config: { notify: 1 },
      alarms_fired: [],
    });
    assert.deepEqual(cuesDue(s, 2000 - 30), ['warning']); // 30s before end, notify=1min
  });

  it('returns both when past end and nothing fired', () => {
    const s = makeRunningState({
      end_epoch: 2000,
      config: { notify: 1 },
      alarms_fired: [],
    });
    assert.deepEqual(cuesDue(s, 2001), ['warning', 'end']);
  });

  it('omits already-fired cues', () => {
    const s = makeRunningState({
      end_epoch: 2000,
      config: { notify: 1 },
      alarms_fired: ['warning'],
    });
    assert.deepEqual(cuesDue(s, 2001), ['end']);
  });

  it('returns [] when not running', () => {
    assert.deepEqual(cuesDue(makeIdleState(), 9999), []);
  });
});

describe('derive: parseJsonl', () => {
  it('parses valid lines', () => {
    const raw = '{"id":"a"}\n{"id":"b"}\n';
    assert.deepEqual(parseJsonl(raw), [{ id: 'a' }, { id: 'b' }]);
  });

  it('skips corrupt lines without throwing', () => {
    const raw = '{"id":"a"}\nNOT JSON\n{"id":"c"}\n';
    const result = parseJsonl(raw);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'a');
    assert.equal(result[1].id, 'c');
  });
});
