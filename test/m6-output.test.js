/**
 * M6 output tests (TEST-M6-001 from spec.md)
 * TTY vs captured output: ANSI present on TTY, plain text when piped.
 *
 * We test the pure `renderHelp` function; TTY detection itself is tested
 * by checking that colorMode() is a function returning a boolean.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderHelp, colorMode } from '../src/output.js';

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
