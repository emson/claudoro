/**
 * M3 status-line renderer tests (TEST-M3-001, TEST-M3-002 from spec.md)
 * Pure unit tests — segment and passthrough are pure functions of their inputs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderSegment, renderBar, renderDots } from '../src/render/segment.js';
import { renderPassthrough } from '../src/render/passthrough.js';
import { makeRunningState, makeIdleState } from './helpers.js';

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
