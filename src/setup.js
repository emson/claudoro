/**
 * M7: Claude Code wiring — setup and uninstall.
 *
 * `pomo setup` (idempotent, marker-guarded):
 *   1. Write the /pomo command file to ~/.claude/commands/pomo.md
 *   2. Back up settings.json, then merge the statusLine entry (with refreshInterval)
 *   3. Record every change in manifest.json for clean reversal
 *
 * `pomo uninstall`: reads manifest, reverses exactly.
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
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { claudoroPaths } from './platform/paths.js';

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

  // 2. Merge statusLine into settings.json. Always record the action (with the
  //    prior value, possibly null) so uninstall can reverse it even when there
  //    was nothing to back up (AC-6).
  const { backed_up, previous } = mergeStatusLine(paths, POMO_BIN);
  log.push({
    action: 'set_statusline',
    backup: backed_up ?? null,
    previous: previous ?? null,
  });
  console.log(`  [+] statusLine set in: ${paths.claudeSettings}`);

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

export const uninstall = (env = process.env) => {
  const paths = claudoroPaths(env);
  const manifest = loadManifest(paths.manifestFile);

  if (!manifest[SETUP_MARKER]) {
    console.log('[claudoro] Not set up (no manifest marker). Nothing to uninstall.');
    return;
  }

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
      // Corrupt settings.json: never clobber. Print the exact snippet to add.
      console.warn(
        `[claudoro] settings.json could not be parsed, not touching it.\n` +
          `Add this manually under the top-level object:\n${manualSnippet(pomoBin)}`,
      );
      return { backed_up: null, previous: null };
    }
    if (settings.statusLine !== undefined) {
      previous = settings.statusLine; // may be a string (legacy) or an object
      const backup = `${paths.claudeSettings}.claudoro-backup.${Date.now()}`;
      copyFileSync(paths.claudeSettings, backup);
      backed_up = backup;
    }
  }

  settings.statusLine = claudoroStatusLine(pomoBin);

  const tmp = `${paths.claudeSettings}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  renameSync(tmp, paths.claudeSettings);

  return { backed_up, previous };
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
