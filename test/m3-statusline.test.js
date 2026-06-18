/**
 * M3 status-line renderer tests (TEST-M3-001, TEST-M3-002 from spec.md)
 * Pure unit tests — segment and passthrough are pure functions of their inputs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderSegment, renderBar, renderDots, barColor } from '../src/render/segment.js';
import { renderPassthrough } from '../src/render/passthrough.js';
import { seg } from '../src/output.js';
import { makeRunningState, makeIdleState } from './helpers.js';

// Force segment color off so structural assertions (widths, substrings) are
// deterministic regardless of the test host's TERM. Individual tests that check
// color flip CLAUDORO_COLOR locally (segmentColorMode reads it live).
process.env.CLAUDORO_COLOR = 'never';

const NOW = 1_000_000;
const PREFS = { view: 'classic', motion: 'off' }; // motion off for stable test output

describe('M3: renderSegment', () => {
  it('returns empty string when idle', () => {
    const seg = renderSegment(makeIdleState(), PREFS, NOW, 80);
    assert.equal(seg, '');
  });

  it('includes MM:SS time string', () => {
    const s = makeRunningState({ end_epoch: NOW + 25 * 60 });
    const seg = renderSegment(s, PREFS, NOW, 80);
    assert.ok(seg.includes('25:00'), `expected '25:00' in: ${seg}`);
  });

  it('drops bar on narrow terminal but keeps icon + time', () => {
    const s = makeRunningState({ end_epoch: NOW + 60 });
    const narrow = renderSegment(s, PREFS, NOW, 15);
    // Bar (▕...▏) should be absent on narrow
    assert.ok(!narrow.includes('▕'), 'bar should be dropped on narrow');
    // Time should still be present
    assert.ok(narrow.includes(':'));
  });
});

describe('M3: renderBar', () => {
  it('returns a 12-char string (frame + 10 cells)', () => {
    assert.equal(renderBar(0).length, 12);
    assert.equal(renderBar(0.5).length, 12);
    assert.equal(renderBar(1).length, 12);
  });

  it('full bar at fraction=1', () => {
    const bar = renderBar(1);
    assert.ok(bar.includes('█'));
    assert.ok(!bar.includes('░'));
  });

  it('empty bar at fraction=0', () => {
    const bar = renderBar(0);
    assert.ok(!bar.includes('█'));
    assert.ok(bar.includes('░'));
  });

  it('applies the fill color to the filled portion only', () => {
    const tag = (s) => `<${s}>`;
    const bar = renderBar(0.5, tag);
    // The 5 filled cells are wrapped; the dim track outside the tag is not.
    assert.ok(bar.includes('<' + '█'.repeat(5) + '>'), `expected tagged fill in: ${bar}`);
    assert.ok(bar.includes('░'), 'track still present');
  });
});

describe('M3: barColor (focus red / paused yellow / resting green)', () => {
  it('red while focusing', () => {
    assert.equal(barColor(makeRunningState({ phase: 'focus' })), seg.tomato);
  });

  it('yellow while paused, regardless of phase', () => {
    assert.equal(
      barColor(makeRunningState({ run_state: 'paused', phase: 'focus' })),
      seg.amber,
    );
    assert.equal(
      barColor(makeRunningState({ run_state: 'paused', phase: 'short_break' })),
      seg.amber,
    );
  });

  it('green while resting in either break', () => {
    assert.equal(barColor(makeRunningState({ phase: 'short_break' })), seg.grass);
    assert.equal(barColor(makeRunningState({ phase: 'long_break' })), seg.grass);
  });
});

describe('M3: segment color renders without a TTY (the bug fix)', () => {
  it('emits ANSI when CLAUDORO_COLOR=always even though stdout is not a TTY', () => {
    const prev = process.env.CLAUDORO_COLOR;
    process.env.CLAUDORO_COLOR = 'always';
    try {
      // focus → tomato fill (38;5;203); short_break → grass fill (38;5;71)
      const focus = renderSegment(makeRunningState({ phase: 'focus' }), PREFS, NOW, 80);
      assert.ok(focus.includes('\x1b[38;5;203m'), `expected tomato in: ${focus}`);
      const rest = renderSegment(
        makeRunningState({ phase: 'short_break', planned_min: 5 }),
        PREFS,
        NOW,
        80,
      );
      assert.ok(rest.includes('\x1b[38;5;71m'), `expected grass in: ${rest}`);
    } finally {
      process.env.CLAUDORO_COLOR = prev;
    }
  });

  it('stays plain when CLAUDORO_COLOR=never', () => {
    const seg2 = renderSegment(makeRunningState({ phase: 'focus' }), PREFS, NOW, 80);
    assert.ok(!seg2.includes('\x1b['), `expected no ANSI in: ${seg2}`);
  });
});

describe('M3: renderDots', () => {
  it('correct dot counts', () => {
    assert.equal(renderDots(0, 4), '○○○○');
    assert.equal(renderDots(2, 4), '●●○○');
    assert.equal(renderDots(4, 4), '●●●●');
  });

  it('always renders frequency total dots', () => {
    for (const i of [0, 1, 2, 3, 4]) {
      assert.equal(renderDots(i, 4).length, 4);
    }
  });
});

describe('M3: renderPassthrough', () => {
  it('renders model display name', () => {
    const cc = { model: { display_name: 'Claude Opus 4' } };
    const out = renderPassthrough(cc, 'model');
    assert.ok(out.includes('Claude Opus 4'));
  });

  it('renders context percentage from the context_window contract', () => {
    const cc = { context_window: { used_percentage: 42.7 } };
    const out = renderPassthrough(cc, 'context');
    assert.ok(out.includes('43%'), `expected 43% in: ${out}`);
  });

  it('falls back to legacy context_percentage shape', () => {
    const out = renderPassthrough({ context_percentage: 10 }, 'context');
    assert.ok(out.includes('10%'));
  });

  it('omits field when data missing', () => {
    const out = renderPassthrough({}, 'model,context,git');
    assert.equal(out.trim(), '');
  });

  it('respects passthrough field ordering', () => {
    const cc = { model: { display_name: 'M' }, context_percentage: 10 };
    const out = renderPassthrough(cc, 'model,context');
    const modelIdx = out.indexOf('M');
    const ctxIdx = out.indexOf('10%');
    assert.ok(modelIdx < ctxIdx, 'model should appear before context');
  });
});
