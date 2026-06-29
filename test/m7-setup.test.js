/**
 * M7 setup/uninstall integration tests (TEST-M7-002, TEST-M7-003 from spec.md).
 *
 * These exercise real filesystem wiring (command file, settings.json merge,
 * manifest) against a temp Claude config dir — makeTempEnv() sets
 * CLAUDE_CONFIG_DIR so nothing ever touches the developer's real ~/.claude.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { makeTempEnv, makeRunningState } from './helpers.js';
import { setup, uninstall } from '../src/setup.js';
import { readState, writeState } from '../src/store-read.js';
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

/** Run a call and return everything it printed, for asserting on warnings. */
const capture = (fn) => {
  const { log, warn } = console;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  console.warn = (...a) => lines.push(a.join(' '));
  try {
    fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
  return lines.join('\n');
};

/** Write a Claude Code plugin registry that lists Claudoro as installed. */
const installPluginRegistry = (paths, key = 'claudoro@test-marketplace') => {
  mkdirSync(dirname(paths.installedPluginsFile), { recursive: true });
  writeFileSync(
    paths.installedPluginsFile,
    JSON.stringify({ version: 2, plugins: { [key]: [{ scope: 'user' }] } }),
    'utf8',
  );
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

describe('M7: uninstall is plugin-aware', () => {
  let env, cleanup, paths;
  beforeEach(() => {
    ({ env, cleanup } = makeTempEnv());
    paths = claudoroPaths(env);
  });
  afterEach(() => cleanup());

  it('warns that a plugin install will re-wire on the next session', () => {
    quiet(() => setup(env));
    installPluginRegistry(paths);

    const out = capture(() => uninstall(env));
    assert.match(out, /installed as a Claude Code plugin/);
    assert.match(out, /claudoro@test-marketplace/);
    assert.match(out, /\/plugin/);
  });

  it('stays silent about plugins when none is installed', () => {
    quiet(() => setup(env));
    const out = capture(() => uninstall(env));
    assert.doesNotMatch(out, /plugin/i);
  });
});

describe('M7: uninstall disarms a running timer', () => {
  let env, cleanup;
  beforeEach(() => {
    ({ env, cleanup } = makeTempEnv());
  });
  afterEach(() => cleanup());

  it('stops the timer and supersedes the worker (alarm_seq bumped)', () => {
    quiet(() => setup(env));
    writeState(makeRunningState({ alarm_seq: 3 }), env);

    quiet(() => uninstall(env));

    const s = readState(env);
    assert.equal(s.run_state, 'idle', 'timer stopped on uninstall');
    assert.equal(s.phase, null);
    assert.ok(s.alarm_seq > 3, 'alarm_seq bumped so the detached worker self-exits');
  });

  it('leaves an idle state untouched (no spurious seq bump)', () => {
    quiet(() => setup(env));
    quiet(() => uninstall(env));
    // No state.json was ever written (idle), so readState returns the default.
    assert.equal(readState(env).run_state, 'idle');
  });
});

describe('M7: setup does not capture its own statusLine on re-run after manifest loss', () => {
  let env, cleanup, paths;
  beforeEach(() => {
    ({ env, cleanup } = makeTempEnv());
    paths = claudoroPaths(env);
  });
  afterEach(() => cleanup());

  it('keeps previous=null so uninstall removes our line (not "restores" it)', () => {
    quiet(() => setup(env)); // wires our statusLine
    unlinkSync(paths.manifestFile); // simulate a lost/corrupt manifest
    quiet(() => setup(env)); // re-run must not capture our own line as previous

    const manifest = readJson(paths.manifestFile);
    const entry = manifest.actions.find((a) => a.action === 'set_statusline');
    assert.equal(entry.previous, null, 'did not capture our own statusLine as previous');
    assert.equal(backupFiles(paths.claudeDir).length, 0, 'no backup of our own line');

    quiet(() => uninstall(env));
    assert.equal(
      readJson(paths.claudeSettings).statusLine,
      undefined,
      'our line is cleanly removed, not restored to itself',
    );
  });
});

describe('M7: uninstall --purge', () => {
  let env, cleanup, paths;
  beforeEach(() => {
    ({ env, cleanup } = makeTempEnv());
    paths = claudoroPaths(env);
  });
  afterEach(() => cleanup());

  it('without --yes is a dry run: keeps the data dir and prints the confirm hint', () => {
    quiet(() => setup(env));
    assert.ok(existsSync(paths.stateDir), 'data dir exists after setup');

    const out = capture(() => uninstall(env, { purge: true }));
    assert.ok(existsSync(paths.stateDir), 'data dir preserved without --yes');
    assert.match(out, /--purge --yes/);
  });

  it('with --yes permanently removes the data dir', () => {
    quiet(() => setup(env));
    assert.ok(existsSync(paths.stateDir), 'data dir exists after setup');

    quiet(() => uninstall(env, { purge: true, confirmed: true }));
    assert.ok(!existsSync(paths.stateDir), 'data dir removed');
  });
});
