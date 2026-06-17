/**
 * M7 setup/uninstall integration tests (TEST-M7-002, TEST-M7-003 from spec.md).
 *
 * These exercise real filesystem wiring (command file, settings.json merge,
 * manifest) against a temp Claude config dir — makeTempEnv() sets
 * CLAUDE_CONFIG_DIR so nothing ever touches the developer's real ~/.claude.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { makeTempEnv } from './helpers.js';
import { setup, uninstall } from '../src/setup.js';
import { claudoroPaths } from '../src/platform/paths.js';

/** Run a (synchronous) setup/uninstall call without its console chatter. */
const quiet = (fn) => {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const backupFiles = (claudeDir) =>
  readdirSync(claudeDir).filter((f) => f.includes('settings.json.claudoro-backup.'));

describe('M7: setup wiring', () => {
  let env, cleanup, paths;
  beforeEach(() => {
    ({ env, cleanup } = makeTempEnv());
    paths = claudoroPaths(env);
  });
  afterEach(() => cleanup());

  it('writes the /pomo command file and merges the statusLine', () => {
    quiet(() => setup(env));

    assert.ok(existsSync(paths.pomoCmdFile), 'command file should exist');
    const cmd = readFileSync(paths.pomoCmdFile, 'utf8');
    // allowed-tools must match the actual (absolute-path) invocation, not a bare
    // `pomo` that the `!` injection never runs — see the help-not-displaying fix.
    assert.match(cmd, /allowed-tools: Bash\([^)]*pomo\.js:\*\)/);
    assert.match(cmd, /\$ARGUMENTS/);

    const settings = readJson(paths.claudeSettings);
    assert.equal(settings.statusLine.type, 'command');
    assert.match(settings.statusLine.command, /statusline$/);
    assert.equal(settings.statusLine.refreshInterval, 1, 'idle ticking (AC-2)');

    const manifest = readJson(paths.manifestFile);
    assert.equal(manifest.__claudoro_setup__, true);
    assert.ok(Array.isArray(manifest.actions) && manifest.actions.length >= 2);
  });

  it('is idempotent — a second setup does not re-wire or duplicate', () => {
    quiet(() => setup(env));
    const firstManifest = readFileSync(paths.manifestFile, 'utf8');

    quiet(() => setup(env)); // marker-guarded no-op
    const secondManifest = readFileSync(paths.manifestFile, 'utf8');

    assert.equal(secondManifest, firstManifest, 'manifest unchanged on re-run');
    assert.equal(backupFiles(paths.claudeDir).length, 0, 'no spurious backups');
  });
});

describe('M7: preserves an existing status line (TEST-M7-002)', () => {
  let env, cleanup, paths;
  const customStatusLine = { type: 'command', command: 'my-custom-statusline.sh' };

  beforeEach(() => {
    ({ env, cleanup } = makeTempEnv());
    paths = claudoroPaths(env);
    mkdirSync(paths.claudeDir, { recursive: true });
    writeFileSync(
      paths.claudeSettings,
      JSON.stringify({ statusLine: customStatusLine, theme: 'dark' }, null, 2),
      'utf8',
    );
  });
  afterEach(() => cleanup());

  it('backs up the prior statusLine, records it, and installs ours', () => {
    quiet(() => setup(env));

    // A timestamped backup of the original settings.json was written.
    assert.equal(backupFiles(paths.claudeDir).length, 1, 'one backup written');

    // The prior value is recorded in the manifest for exact reversal.
    const manifest = readJson(paths.manifestFile);
    const entry = manifest.actions.find((a) => a.action === 'set_statusline');
    assert.deepEqual(entry.previous, customStatusLine);

    // Ours is now installed; unrelated keys are preserved (not clobbered).
    const settings = readJson(paths.claudeSettings);
    assert.match(settings.statusLine.command, /statusline$/);
    assert.equal(settings.theme, 'dark', 'unrelated settings preserved');
  });
});

describe('M7: uninstall reverses wiring (TEST-M7-003)', () => {
  let env, cleanup, paths;
  beforeEach(() => {
    ({ env, cleanup } = makeTempEnv());
    paths = claudoroPaths(env);
  });
  afterEach(() => cleanup());

  it('restores a pre-existing statusLine and removes the command file', () => {
    const custom = { type: 'command', command: 'my-custom-statusline.sh' };
    mkdirSync(paths.claudeDir, { recursive: true });
    writeFileSync(
      paths.claudeSettings,
      JSON.stringify({ statusLine: custom }, null, 2),
      'utf8',
    );

    quiet(() => setup(env));
    assert.match(readJson(paths.claudeSettings).statusLine.command, /statusline$/);

    quiet(() => uninstall(env));

    assert.ok(!existsSync(paths.pomoCmdFile), 'command file removed');
    assert.deepEqual(
      readJson(paths.claudeSettings).statusLine,
      custom,
      'prior statusLine restored exactly',
    );
    const manifest = readJson(paths.manifestFile);
    assert.ok(!manifest.__claudoro_setup__, 'setup marker cleared');
  });

  it('removes our statusLine entirely when there was none before', () => {
    quiet(() => setup(env));
    assert.ok(readJson(paths.claudeSettings).statusLine, 'ours installed');

    quiet(() => uninstall(env));

    assert.ok(!existsSync(paths.pomoCmdFile), 'command file removed');
    assert.equal(
      readJson(paths.claudeSettings).statusLine,
      undefined,
      'no orphaned statusLine left behind',
    );
  });
});

describe('M7: never clobbers a corrupt settings.json', () => {
  let env, cleanup, paths;
  const corrupt = '{ this is not valid json';

  beforeEach(() => {
    ({ env, cleanup } = makeTempEnv());
    paths = claudoroPaths(env);
    mkdirSync(paths.claudeDir, { recursive: true });
    writeFileSync(paths.claudeSettings, corrupt, 'utf8');
  });
  afterEach(() => cleanup());

  it('leaves the corrupt file untouched through setup and uninstall', () => {
    quiet(() => setup(env));
    assert.equal(
      readFileSync(paths.claudeSettings, 'utf8'),
      corrupt,
      'corrupt settings not rewritten by setup',
    );
    // The command file still goes in (it does not depend on settings.json).
    assert.ok(existsSync(paths.pomoCmdFile));

    assert.doesNotThrow(() => quiet(() => uninstall(env)));
    assert.equal(
      readFileSync(paths.claudeSettings, 'utf8'),
      corrupt,
      'corrupt settings still untouched after uninstall',
    );
  });
});
