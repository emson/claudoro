/**
 * M7: Claude Code wiring — setup and uninstall.
 *
 * `pomo setup` (idempotent, marker-guarded):
 *   1. Write the /pomo command file to ~/.claude/commands/pomo.md
 *   2. Back up settings.json, then merge the statusLine entry (with refreshInterval)
 *   3. Record every change in manifest.json for clean reversal
 *
 * `pomo uninstall`: reads manifest, reverses exactly. Warns if a plugin install
 *   is present (its SessionStart hook would re-wire next session). `--purge`
 *   additionally removes the data dir (gated behind `--yes`, irreversible).
 * `npm uninstall -g claudoro` removes the binary; this handles the CC wiring.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { claudoroPaths } from './platform/paths.js';
import { readState, writeState } from './store-read.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The absolute path to the pomo binary (PATH-independent — critical for the statusLine setting)
const POMO_BIN = join(__dirname, '..', 'bin', 'pomo.js');
const SETUP_MARKER = '__claudoro_setup__';

// ---------------------------------------------------------------------------
// Command file
// ---------------------------------------------------------------------------

const POMO_COMMAND_MD = (pomoBin) => `---
description: Pomodoro timer for Claude Code
allowed-tools: Bash(${pomoBin}:*)
---

!\`${pomoBin} $ARGUMENTS\`

Display the command output above to the user verbatim, exactly as printed. Do not
summarize it, reformat it, or add commentary. If the output is empty, say so.
`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Wire Claudoro into Claude Code.
 * Idempotent: safe to run on every session start (the plugin SessionStart hook
 * does exactly this). `quiet` suppresses the already-installed notice so the
 * hook stays silent after the first run.
 */
export const setup = (env = process.env, { quiet = false } = {}) => {
  const paths = claudoroPaths(env);
  const manifest = loadManifest(paths.manifestFile);

  if (manifest[SETUP_MARKER]) {
    if (!quiet) {
      console.log(
        '[claudoro] Already set up. Run `pomo uninstall` first to re-run setup.',
      );
    }
    return;
  }

  const log = [];

  // 1. Write the /pomo command file
  mkdirSync(paths.commandsDir, { recursive: true });
  writeFileSync(paths.pomoCmdFile, POMO_COMMAND_MD(POMO_BIN), 'utf8');
  log.push({ action: 'wrote', path: paths.pomoCmdFile });
  console.log(`  [+] Command file: ${paths.pomoCmdFile}`);

  // 2. Merge statusLine into settings.json. Record the action (with the prior
  //    value, possibly null) so uninstall can reverse it even when there was
  //    nothing to back up (AC-6). If settings.json was unparseable we skipped it,
  //    so do NOT record a reversal or claim success for a wiring that did not run.
  const { backed_up, previous, skipped } = mergeStatusLine(paths, POMO_BIN);
  if (skipped) {
    console.log(`  [!] statusLine NOT set (settings.json unparseable, see above).`);
  } else {
    log.push({
      action: 'set_statusline',
      backup: backed_up ?? null,
      previous: previous ?? null,
    });
    console.log(`  [+] statusLine set in: ${paths.claudeSettings}`);
  }

  // 3. Write manifest
  manifest[SETUP_MARKER] = true;
  manifest.actions = log;
  writeManifest(paths.manifestFile, manifest);
  console.log(`  [+] Manifest: ${paths.manifestFile}`);

  console.log(
    '\nClaudoro is ready. Start a pomodoro with `/pomo start` or `!pomo start`.',
  );
};

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

/**
 * Reverse the Claude Code wiring. Then, because a plugin install would re-wire
 * on the next session, warn if one is present; and optionally purge the data dir
 * when `--purge` is given (gated behind `--yes` like `undo`, since it is
 * irreversible).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ purge?: boolean, confirmed?: boolean }} [opts]
 */
export const uninstall = (
  env = process.env,
  { purge = false, confirmed = false } = {},
) => {
  const paths = claudoroPaths(env);

  // Disarm any running timer FIRST so the detached alarm worker self-exits (the
  // alarm_seq bump supersedes it on its next poll) and the headless timer cannot
  // survive teardown or a --purge. This upholds the "no orphaned processes after
  // uninstall" invariant. A lock-free write is sufficient here: this is teardown,
  // not a contended hot mutation, and a superseded worker only ever self-exits.
  const state = readState(env);
  if (state.run_state !== 'idle') {
    writeState(
      {
        ...state,
        run_state: 'idle',
        phase: null,
        alarm_pid: null,
        alarms_fired: [],
        back_checkpoint: null,
        alarm_seq: (state.alarm_seq ?? 0) + 1,
      },
      env,
    );
    console.log('  [-] Stopped the running timer.');
  }

  const manifest = loadManifest(paths.manifestFile);

  if (manifest[SETUP_MARKER]) {
    for (const entry of manifest.actions ?? []) {
      if (entry.action === 'wrote' && existsSync(entry.path)) {
        unlinkSync(entry.path);
        console.log(`  [-] Removed: ${entry.path}`);
      }
      if (entry.action === 'set_statusline') {
        restoreSettings(paths.claudeSettings, entry.backup, entry.previous);
        console.log(`  [~] Restored prior statusLine in settings.json`);
      }
    }

    // Clear the marker
    delete manifest[SETUP_MARKER];
    delete manifest.actions;
    writeManifest(paths.manifestFile, manifest);

    console.log('\nClaudoro uninstalled. Your previous status line has been restored.');
  } else {
    console.log('[claudoro] Not set up (no manifest marker). Nothing to unwire.');
  }

  // The plugin re-wires on next session, so unwiring alone is not enough.
  const plugin = detectPlugin(paths);
  if (plugin) {
    console.log(
      `\n[!] Claudoro is also installed as a Claude Code plugin (${plugin}).\n` +
        `    Its SessionStart hook re-runs \`pomo setup\`, so this wiring will return\n` +
        `    on your next session. Remove the plugin to finish: run \`/plugin\` and\n` +
        `    uninstall Claudoro there.`,
    );
  }

  // Optional, irreversible data purge.
  if (purge) purgeState(paths, confirmed);
};

/**
 * Detect a Claude Code plugin install of Claudoro by reading the plugin
 * registry. Returns the plugin key (e.g. "claudoro@marketplace") or null when
 * not installed as a plugin (or the registry is absent/unparseable).
 */
const detectPlugin = (paths) => {
  try {
    const data = JSON.parse(readFileSync(paths.installedPluginsFile, 'utf8'));
    const keys = Object.keys(data.plugins ?? {});
    return keys.find((k) => k === 'claudoro' || k.split('@')[0] === 'claudoro') ?? null;
  } catch {
    return null;
  }
};

/**
 * Remove the Claudoro data directory (history, stats, backups, timer state).
 * Without `confirmed` this only prints the plan, mirroring `undo`'s dry-run.
 */
const purgeState = (paths, confirmed) => {
  if (!existsSync(paths.stateDir)) {
    console.log(`\n[purge] No data directory to remove (${paths.stateDir}).`);
    return;
  }
  if (!confirmed) {
    console.log(
      `\n[purge] This will permanently delete your Claudoro data:\n` +
        `    ${paths.stateDir}\n` +
        `    (history, stats, backups, and timer state; this is irreversible).\n` +
        `    Re-run to confirm: pomo uninstall --purge --yes`,
    );
    return;
  }
  rmSync(paths.stateDir, { recursive: true, force: true });
  console.log(`\n[purge] Deleted ${paths.stateDir}. All history and state removed.`);
};

// ---------------------------------------------------------------------------
// settings.json helpers
// ---------------------------------------------------------------------------

// The statusLine object Claudoro installs. `refreshInterval` lives INSIDE the
// statusLine object (seconds, min 1) and is what makes the countdown tick while
// the session is idle (AC-2). Older Claude Code versions ignore it and the
// segment simply falls back to event-driven refresh — graceful degradation.
const claudoroStatusLine = (pomoBin) => ({
  type: 'command',
  command: `${pomoBin} statusline`,
  refreshInterval: 1,
});

const manualSnippet = (pomoBin) =>
  `  "statusLine": ${JSON.stringify(claudoroStatusLine(pomoBin))}`;

const mergeStatusLine = (paths, pomoBin) => {
  let settings = {};
  let previous = null;
  let backed_up = null;

  if (existsSync(paths.claudeSettings)) {
    try {
      settings = JSON.parse(readFileSync(paths.claudeSettings, 'utf8'));
    } catch {
      // Corrupt settings.json: never clobber. Print the exact snippet to add and
      // signal `skipped` so setup does not claim success or record a reversal.
      console.warn(
        `[claudoro] settings.json could not be parsed, not touching it.\n` +
          `Add this manually under the top-level object:\n${manualSnippet(pomoBin)}`,
      );
      return { backed_up: null, previous: null, skipped: true };
    }
    if (settings.statusLine !== undefined) {
      // Only capture a genuinely foreign line as `previous`. If it is already
      // OUR line (e.g. setup re-ran after the manifest was lost), leave
      // previous = null so uninstall removes it rather than "restoring" it.
      const isOurs =
        JSON.stringify(settings.statusLine) ===
        JSON.stringify(claudoroStatusLine(pomoBin));
      if (!isOurs) {
        previous = settings.statusLine; // may be a string (legacy) or an object
        const backup = `${paths.claudeSettings}.claudoro-backup.${Date.now()}`;
        copyFileSync(paths.claudeSettings, backup);
        backed_up = backup;
      }
    }
  }

  settings.statusLine = claudoroStatusLine(pomoBin);

  const tmp = `${paths.claudeSettings}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  renameSync(tmp, paths.claudeSettings);

  return { backed_up, previous, skipped: false };
};

const restoreSettings = (settingsPath, backupPath, previousStatusLine) => {
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    // `null` previous means "no statusLine existed before" → remove ours.
    // `undefined` (not recorded) is treated the same.
    if (previousStatusLine === undefined || previousStatusLine === null) {
      delete settings.statusLine;
    } else {
      settings.statusLine = previousStatusLine; // restore exactly what was there
    }
    const tmp = `${settingsPath}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    renameSync(tmp, settingsPath);
  } catch {
    // Fall back to a full restore from the timestamped backup (if one exists;
    // `backupPath` is null when there was nothing to back up — guard so we
    // never pass null to existsSync, which is deprecated on Node 24+).
    if (backupPath && existsSync(backupPath)) copyFileSync(backupPath, settingsPath);
  }
};

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

const loadManifest = (manifestFile) => {
  try {
    return JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch {
    return {};
  }
};

const writeManifest = (manifestFile, manifest) => {
  mkdirSync(dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
};
