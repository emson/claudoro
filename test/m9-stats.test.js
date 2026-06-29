/**
 * M9: Stats fold, terminal panel, HTML dashboard, and the `pomo stats` verb (D-011).
 */
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { makeTempEnv } from './helpers.js';
import { ensureDirs } from '../src/store.js';
import { claudoroPaths, todayLogFile } from '../src/platform/paths.js';
import { foldStats } from '../src/stats.js';
import { renderStats } from '../src/output.js';
import { renderStatsHtml } from '../src/render/dashboard.js';
import { cmdStats } from '../src/cli.js';

const DAY = 86_400;

/** A completed-focus record `dayOffset` days before `now`, same time of day. */
const rec = (now, dayOffset, over = {}) => {
  const started = now - dayOffset * DAY;
  return {
    id: `r-${dayOffset}-${over.label ?? ''}`,
    schema: 1,
    phase: 'focus',
    status: 'completed',
    started,
    ended: started + 1500,
    actual_min: 25,
    planned_min: 25,
    overtime_min: 0,
    label: null,
    config_snapshot: { frequency: 4 },
    ...over,
  };
};

describe('stats: foldStats (TEST-M9-001)', () => {
  const now = 1_750_000_000; // fixed, mid-2025, away from DST edges

  it('folds an empty set to zeroes without throwing', () => {
    const p = foldStats([], now);
    assert.equal(p.totals.pomodoros, 0);
    assert.equal(p.totals.focusMin, 0);
    assert.equal(p.totals.daysActive, 0);
    assert.equal(p.streak.current, 0);
    assert.equal(p.streak.best, 0);
    assert.deepEqual(p.tags, []);
    assert.equal(p.byHour.length, 24);
    assert.equal(p.recent.length, 0);
  });

  it('sums all-time focus and counts distinct active days', () => {
    const p = foldStats([rec(now, 0), rec(now, 0), rec(now, 1)], now);
    assert.equal(p.totals.pomodoros, 3);
    assert.equal(p.totals.focusMin, 75);
    assert.equal(p.totals.daysActive, 2);
    assert.equal(p.today.pomodoros, 2); // two today
    assert.equal(p.week.pomodoros, 3); // all within 7 days
  });

  it('counts a consecutive streak and breaks it on a gap', () => {
    // days 0,1,2 active, day 3 missing, day 4 active
    const records = [rec(now, 0), rec(now, 1), rec(now, 2), rec(now, 4)];
    const p = foldStats(records, now);
    assert.equal(p.streak.current, 3, 'today + two prior days');
    assert.equal(p.streak.best, 3, 'longest run is the recent three');
  });

  it('keeps a one-day grace: yesterday-only still counts as current', () => {
    const p = foldStats([rec(now, 1), rec(now, 2)], now);
    assert.equal(p.streak.current, 2);
  });

  it('aggregates tags from labels and ignores untagged', () => {
    const records = [
      rec(now, 0, { label: 'auth #project-x' }),
      rec(now, 1, { label: 'review #project-x #review' }),
      rec(now, 2, { label: 'no tags here' }),
    ];
    const p = foldStats(records, now);
    const px = p.tags.find((t) => t.tag === '#project-x');
    assert.ok(px, '#project-x present');
    assert.equal(px.focusMin, 50);
    assert.equal(px.pomodoros, 2);
  });

  it('counts outcomes by focus status', () => {
    const records = [
      rec(now, 0),
      rec(now, 1, { status: 'skipped' }),
      rec(now, 2, { status: 'aborted' }),
    ];
    const p = foldStats(records, now);
    assert.equal(p.outcomes.completed, 1);
    assert.equal(p.outcomes.skipped, 1);
    assert.equal(p.outcomes.aborted, 1);
  });

  it('byHour sums to total completed focus minutes', () => {
    const records = [rec(now, 0), rec(now, 1), rec(now, 2)];
    const p = foldStats(records, now);
    const sum = p.byHour.reduce((a, b) => a + b, 0);
    assert.equal(sum, p.totals.focusMin);
  });

  it('emits a Monday-aligned 12-week heatmap grid', () => {
    const p = foldStats([rec(now, 0)], now);
    assert.equal(p.heatmap.weeks.length, 12);
    assert.ok(p.heatmap.weeks.every((w) => w.length === 7));
  });
});

describe('stats: renderStats terminal panel', () => {
  const now = 1_750_000_000;

  it('shows an empty state without throwing', () => {
    const out = renderStats(foldStats([], now));
    assert.match(out, /No focus blocks recorded yet/);
  });

  it('renders totals, streak, and a heatmap', () => {
    const out = renderStats(foldStats([rec(now, 0), rec(now, 1)], now));
    assert.match(out, /pomodoros/);
    assert.match(out, /Streak/);
    assert.match(out, /Focus . last 12 weeks/);
    assert.match(out, /Mon/);
  });

  it('is plain text (no ANSI) when color is off', () => {
    const prev = process.env.CLAUDORO_COLOR;
    process.env.CLAUDORO_COLOR = 'never';
    try {
      const out = renderStats(foldStats([rec(now, 0)], now));
      // eslint-disable-next-line no-control-regex
      assert.doesNotMatch(out, /\x1b\[/, 'no escape codes');
    } finally {
      if (prev === undefined) delete process.env.CLAUDORO_COLOR;
      else process.env.CLAUDORO_COLOR = prev;
    }
  });

  it('has no em-dash in its output', () => {
    const out = renderStats(foldStats([rec(now, 0)], now));
    assert.doesNotMatch(out, /—/);
  });
});

describe('stats: renderStatsHtml is self-contained and safe (TEST-M9-002)', () => {
  const now = 1_750_000_000;

  it('escapes a malicious label, embeds no live markup', () => {
    const html = renderStatsHtml(
      foldStats([rec(now, 0, { label: '<script>alert(1)</script>' })], now),
      { generatedAt: '2026-06-19T00:00:00Z' },
    );
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'raw payload not injected');
    assert.match(html, /&lt;script&gt;/, 'label is HTML-escaped');
  });

  it('loads no external resources (offline, self-contained)', () => {
    // D-011 is about not fetching on load: no scripts, no external src/link.
    // Inert anchors (e.g. the footer author links) are fine; they fetch nothing.
    const html = renderStatsHtml(foldStats([rec(now, 0)], now));
    assert.doesNotMatch(html, /<script/i, 'no client-side script at all');
    assert.doesNotMatch(html, /\ssrc=/, 'no external resources');
    assert.doesNotMatch(html, /<link/i, 'no external stylesheet');
  });

  it('includes the shared author/project footer', () => {
    const html = renderStatsHtml(foldStats([rec(now, 0)], now));
    assert.match(html, /<footer class="site">/);
    assert.match(html, /benemson\.com/);
    assert.match(html, /github\.com\/emson\/claudoro/);
  });

  it('is a complete HTML document with no em-dash', () => {
    const html = renderStatsHtml(foldStats([rec(now, 0)], now));
    assert.match(html, /^<!doctype html>/);
    assert.doesNotMatch(html, /—/);
  });
});

describe('stats: cmdStats verb', () => {
  let env, cleanup, savedEnv;
  let logs;
  const log = (...a) => logs.push(a.join(' '));
  let origLog;

  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
    // cmdStats reads process.env (claudoroPaths/readAllRecords default), so point
    // the real env at the temp dir for the duration of these tests.
    savedEnv = {
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    };
    process.env.XDG_STATE_HOME = env.XDG_STATE_HOME;
    process.env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME;

    const now = Math.floor(Date.now() / 1000);
    const r = rec(now, 0, { label: 'seed #x' });
    appendFileSync(todayLogFile(env), JSON.stringify(r) + '\n', 'utf8');
  });
  after(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    cleanup();
  });

  const capture = async (fn) => {
    logs = [];
    origLog = console.log;
    console.log = log;
    try {
      await fn();
    } finally {
      console.log = origLog;
    }
    return logs.join('\n');
  };

  it('--json emits a parseable schema-versioned payload with generatedAt', async () => {
    const out = await capture(() => cmdStats({ flags: { json: true } }));
    const obj = JSON.parse(out);
    assert.equal(obj.schema, 1);
    assert.equal(obj.totals.pomodoros, 1);
    assert.ok(obj.generatedAt, 'stamped generatedAt');
  });

  it('--web writes the dashboard and reports the path when no browser opens', async () => {
    const opened = mock.fn(() => false); // simulate a headless/SSH host
    const out = await capture(() => cmdStats({ flags: { web: true } }, { open: opened }));
    const { dashboardFile } = claudoroPaths(env);
    assert.equal(opened.mock.callCount(), 1);
    assert.ok(existsSync(dashboardFile), 'dashboard.html written');
    assert.match(out, /Open it in a browser/);
    assert.match(readFileSync(dashboardFile, 'utf8'), /^<!doctype html>/);
  });

  it('default prints the terminal panel', async () => {
    const out = await capture(() => cmdStats({ flags: {} }));
    assert.match(out, /focus stats/);
  });
});
