/**
 * M1: pure label + tag transforms (src/label.js).
 * No I/O; just string-in, string-out behaviour and edge cases.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendText, normalizeTag, parseTags, addTags } from '../src/label.js';

describe('M1 label: appendText', () => {
  it('returns the addition when the base is empty', () => {
    assert.equal(appendText('', 'auth'), 'auth');
    assert.equal(appendText(null, 'auth'), 'auth');
    assert.equal(appendText(undefined, 'auth'), 'auth');
  });

  it('joins base and addition with a single space', () => {
    assert.equal(appendText('auth', 'review'), 'auth review');
  });

  it('trims so repeated appends never accumulate gaps', () => {
    assert.equal(appendText('  auth  ', '  review  '), 'auth review');
  });

  it('returns the trimmed base when the addition is empty', () => {
    assert.equal(appendText('auth', ''), 'auth');
    assert.equal(appendText('auth', '   '), 'auth');
    assert.equal(appendText(null, ''), '');
  });
});

describe('M1 label: normalizeTag', () => {
  it('adds a leading # to a bare name', () => {
    assert.equal(normalizeTag('review'), '#review');
  });

  it('strips an existing leading # (and collapses repeats)', () => {
    assert.equal(normalizeTag('#review'), '#review');
    assert.equal(normalizeTag('##review'), '#review');
  });

  it('lowercases and kebab-cases', () => {
    assert.equal(normalizeTag('Code Review'), '#code-review');
    assert.equal(normalizeTag('project_X'), '#project-x');
  });

  it('trims stray dashes from punctuation runs', () => {
    assert.equal(normalizeTag('  spaced  out  '), '#spaced-out');
    assert.equal(normalizeTag('a!!!b'), '#a-b');
  });

  it('returns null when nothing survives normalisation', () => {
    assert.equal(normalizeTag(''), null);
    assert.equal(normalizeTag('#'), null);
    assert.equal(normalizeTag('!!!'), null);
    assert.equal(normalizeTag(null), null);
  });
});

describe('M1 label: parseTags', () => {
  it('extracts #tags in order, lowercased', () => {
    assert.deepEqual(parseTags('auth #Review and #project-x'), ['#review', '#project-x']);
  });

  it('returns [] for no tags or empty input', () => {
    assert.deepEqual(parseTags('just prose'), []);
    assert.deepEqual(parseTags(''), []);
    assert.deepEqual(parseTags(null), []);
  });
});

describe('M1 label: addTags', () => {
  it('appends a normalised tag to existing prose', () => {
    const { label, added } = addTags('auth work', ['review']);
    assert.equal(label, 'auth work #review');
    assert.deepEqual(added, ['#review']);
  });

  it('adds multiple tags at once', () => {
    const { label, added } = addTags('auth', ['review', 'project-x']);
    assert.equal(label, 'auth #review #project-x');
    assert.deepEqual(added, ['#review', '#project-x']);
  });

  it('dedupes against tags already present (case-insensitive)', () => {
    const { label, added } = addTags('auth #review', ['Review']);
    assert.equal(label, 'auth #review');
    assert.deepEqual(added, []);
  });

  it('dedupes within the same call', () => {
    const { label, added } = addTags('', ['review', 'review']);
    assert.equal(label, '#review');
    assert.deepEqual(added, ['#review']);
  });

  it('starts cleanly from an empty/missing label', () => {
    assert.equal(addTags('', ['review']).label, '#review');
    assert.equal(addTags(null, ['review']).label, '#review');
  });

  it('skips names that normalise to nothing', () => {
    const { label, added } = addTags('auth', ['!!!', 'review']);
    assert.equal(label, 'auth #review');
    assert.deepEqual(added, ['#review']);
  });
});
