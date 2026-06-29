/**
 * M10: Pomodoro guide — content model, terminal panel, HTML page, and the
 * `pomo guide` verb. Mirrors the stats tests: one content source, three surfaces.
 */
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { makeTempEnv } from './helpers.js';
import { ensureDirs } from '../src/store.js';
import { claudoroPaths } from '../src/platform/paths.js';
import { GUIDE, renderGuide } from '../src/guide.js';
import { renderGuideHtml } from '../src/render/guide-html.js';
import { cmdGuide } from '../src/cli.js';

describe('M10 guide: content model', () => {
  it('has a schema, intro, sections, and references', () => {
    assert.equal(GUIDE.schema, 1);
    assert.ok(GUIDE.intro.length > 0);
    assert.ok(Array.isArray(GUIDE.sections) && GUIDE.sections.length > 0);
    assert.ok(Array.isArray(GUIDE.references) && GUIDE.references.length > 0);
  });

  it('every section has a heading', () => {
    for (const s of GUIDE.sections) assert.ok(s.heading && s.heading.length > 0);
  });

  it('every reference has text and an https url', () => {
    for (const r of GUIDE.references) {
      assert.ok(r.text && r.text.length > 0);
      assert.match(r.url, /^https:\/\//);
    }
  });

  it('contains no em-dash anywhere in the content (house rule)', () => {
    assert.doesNotMatch(JSON.stringify(GUIDE), /—/);
  });
});

describe('M10 guide: renderGuide terminal panel', () => {
  it('renders the title, a known heading, an example, and references', () => {
    const out = renderGuide(GUIDE, { columns: 80 });
    assert.match(out, /Claudoro/);
    assert.match(out, /Pomodoro guide/);
    assert.match(out, /What it is/);
    assert.match(out, /\/pomo start/);
    assert.match(out, /References/);
    assert.match(out, /en\.wikipedia\.org/);
  });

  it('is plain text (no ANSI) when color is off', () => {
    const saved = process.env.CLAUDORO_COLOR;
    process.env.CLAUDORO_COLOR = 'never';
    try {
      const out = renderGuide(GUIDE, { columns: 80 });
      assert.ok(!out.includes('\x1b['), 'no ANSI escape codes in plain output');
    } finally {
      if (saved === undefined) delete process.env.CLAUDORO_COLOR;
      else process.env.CLAUDORO_COLOR = saved;
    }
  });

  it('wraps prose to the requested width', () => {
    const saved = process.env.CLAUDORO_COLOR;
    process.env.CLAUDORO_COLOR = 'never';
    try {
      const out = renderGuide(GUIDE, { columns: 80 });
      for (const line of out.split('\n')) {
        // Wrappable lines (containing a space) must fit; a single unbreakable
        // token such as a reference URL is legitimately allowed to overflow.
        if (line.trim().includes(' ')) {
          assert.ok(line.length <= 88, `line too long (${line.length}): ${line}`);
        }
      }
    } finally {
      if (saved === undefined) delete process.env.CLAUDORO_COLOR;
      else process.env.CLAUDORO_COLOR = saved;
    }
  });

  it('has no em-dash in its output', () => {
    assert.doesNotMatch(renderGuide(GUIDE, { columns: 80 }), /—/);
  });
});

describe('M10 guide: renderGuideHtml is self-contained and safe', () => {
  it('escapes content, embeds no live markup', () => {
    const evil = {
      ...GUIDE,
      sections: [{ heading: '<script>alert(1)</script>', body: ['hi'] }],
    };
    const html = renderGuideHtml(evil);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'raw payload not injected');
    assert.match(html, /&lt;script&gt;/, 'content is HTML-escaped');
  });

  it('loads no external resources (offline, self-contained)', () => {
    const html = renderGuideHtml(GUIDE);
    assert.doesNotMatch(html, /<script/i, 'no client-side script');
    assert.doesNotMatch(html, /\ssrc=/, 'no external resources');
    assert.doesNotMatch(html, /<link/i, 'no external stylesheet');
  });

  it('renders references as inert anchors', () => {
    const html = renderGuideHtml(GUIDE);
    assert.match(html, /<a href="https:\/\/en\.wikipedia\.org[^"]*">/);
  });

  it('is a complete HTML document with no em-dash', () => {
    const html = renderGuideHtml(GUIDE);
    assert.match(html, /^<!doctype html>/);
    assert.doesNotMatch(html, /—/);
  });
});

describe('M10 guide: cmdGuide verb', () => {
  let env, cleanup, savedEnv;
  let logs;
  const log = (...a) => logs.push(a.join(' '));

  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
    savedEnv = {
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    };
    process.env.XDG_STATE_HOME = env.XDG_STATE_HOME;
    process.env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME;
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
    const orig = console.log;
    console.log = log;
    try {
      await fn();
    } finally {
      console.log = orig;
    }
    return logs.join('\n');
  };

  it('--json emits the parseable schema-versioned content', async () => {
    const out = await capture(() => cmdGuide({ flags: { json: true } }));
    const obj = JSON.parse(out);
    assert.equal(obj.schema, 1);
    assert.ok(Array.isArray(obj.sections) && obj.sections.length > 0);
  });

  it('--web writes the guide and reports the path when no browser opens', async () => {
    const opened = mock.fn(() => false); // simulate a headless/SSH host
    const out = await capture(() => cmdGuide({ flags: { web: true } }, { open: opened }));
    const { guideFile } = claudoroPaths(env);
    assert.equal(opened.mock.callCount(), 1);
    assert.ok(existsSync(guideFile), 'guide.html written');
    assert.match(out, /Open it in a browser/);
    assert.match(readFileSync(guideFile, 'utf8'), /^<!doctype html>/);
  });

  it('default prints the terminal panel', async () => {
    const out = await capture(() => cmdGuide({ flags: {} }));
    assert.match(out, /Pomodoro guide/);
  });
});
