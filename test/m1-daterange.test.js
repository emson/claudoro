/**
 * Date-bucket helpers (derive.js) + range reader (history.js).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { makeTempEnv } from './helpers.js';
import { ensureDirs } from '../src/store.js';
import { logFileForDate } from '../src/platform/paths.js';
import { readRangeByDay } from '../src/history.js';
import { shiftDate, summarize } from '../src/derive.js';

describe('derive: shiftDate', () => {
  it('shifts forward and backward across month boundaries', () => {
    assert.equal(shiftDate('2026-06-18', 0), '2026-06-18');
    assert.equal(shiftDate('2026-06-18', -1), '2026-06-17');
    assert.equal(shiftDate('2026-06-01', -1), '2026-05-31');
    assert.equal(shiftDate('2026-06-18', 5), '2026-06-23');
    assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  });

  it('--last N math: since = today shifted by -(N-1)', () => {
    assert.equal(shiftDate('2026-06-18', -(7 - 1)), '2026-06-12');
  });
});

describe('derive: summarize', () => {
  const rec = (phase, status, min) => ({ phase, status, actual_min: min });
  it('counts only completed focus blocks and sums their minutes', () => {
    const records = [
      rec('focus', 'completed', 25),
      rec('focus', 'completed', 50),
      rec('short_break', 'completed', 5), // not focus
      rec('focus', 'skipped', 25), // not completed
    ];
    const s = summarize(records);
    assert.equal(s.completed, 2);
    assert.equal(s.focusMin, 75);
    assert.equal(s.total, 4);
  });

  it('is total over the empty set', () => {
    assert.deepEqual(summarize([]), { completed: 0, focusMin: 0, total: 0 });
  });
});

describe('history: readRangeByDay', () => {
  let env, cleanup;
  const write = (date, n) => {
    const file = logFileForDate(date, env);
    for (let i = 0; i < n; i++) {
      appendFileSync(
        file,
        JSON.stringify({ id: `${date}-${i}`, phase: 'focus', status: 'completed' }) +
          '\n',
      );
    }
  };

  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
    write('2026-06-10', 2);
    write('2026-06-12', 1);
    write('2026-06-15', 3);
  });
  after(() => cleanup());

  it('returns only days within the inclusive range, ascending', () => {
    const groups = readRangeByDay('2026-06-11', '2026-06-15', env);
    assert.deepEqual(
      groups.map((g) => g.date),
      ['2026-06-12', '2026-06-15'],
    );
  });

  it('includes both endpoints', () => {
    const groups = readRangeByDay('2026-06-10', '2026-06-12', env);
    assert.deepEqual(
      groups.map((g) => g.date),
      ['2026-06-10', '2026-06-12'],
    );
  });

  it('omits empty days and reads only files that exist', () => {
    const groups = readRangeByDay('2026-06-01', '2026-06-30', env);
    assert.equal(groups.length, 3); // only the 3 days with records
    assert.equal(groups[0].records.length, 2);
  });

  it('returns [] when the range matches no day', () => {
    assert.deepEqual(readRangeByDay('2026-07-01', '2026-07-31', env), []);
  });
});
