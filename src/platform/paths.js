/**
 * M1: Path resolution — XDG on Linux/macOS, LOCALAPPDATA/APPDATA on Windows.
 * Pure functions of the environment; pass `env` in tests to avoid touching HOME.
 */
import { join } from 'node:path';
import { homedir, platform, tmpdir } from 'node:os';
import { today } from '../derive.js';

const isWindows = platform() === 'win32';

/**
 * Resolve HOME, degrading to TMPDIR when it is missing or unwritable
 * (no-HOME shells, read-only roots — M1 edge case). Returns a usable base dir.
 */
const safeHome = () => {
  try {
    const home = homedir();
    if (home && home !== '/' && home.length > 1) return home;
  } catch {
    // homedir() can throw on exotic environments
  }
  return tmpdir();
};

const stateRoot = (env = process.env) => {
  if (env.XDG_STATE_HOME) return env.XDG_STATE_HOME;
  if (isWindows) {
    const base = env.LOCALAPPDATA || join(safeHome(), 'AppData', 'Local');
    return join(base, 'State');
  }
  return join(safeHome(), '.local', 'state');
};

const configRoot = (env = process.env) => {
  if (env.XDG_CONFIG_HOME) return env.XDG_CONFIG_HOME;
  if (isWindows) {
    return env.APPDATA || join(safeHome(), 'AppData', 'Roaming');
  }
  return join(safeHome(), '.config');
};

/**
 * Returns all paths Claudoro uses.
 * Pass a custom `env` to redirect state in tests (e.g. to a temp dir).
 */
export const claudoroPaths = (env = process.env) => {
  const stateDir = join(stateRoot(env), 'claudoro');
  const configDir = join(configRoot(env), 'claudoro');
  // Honour Claude Code's own CLAUDE_CONFIG_DIR override so `pomo setup` wires
  // the right config dir if the user relocated it (and so it stays testable).
  const claudeDir = env.CLAUDE_CONFIG_DIR || join(safeHome(), '.claude');

  return {
    stateDir,
    configDir,
    stateFile: join(stateDir, 'state.json'),
    lockFile: join(stateDir, 'lock'),
    logsDir: join(stateDir, 'logs'),
    backupsDir: join(stateDir, 'backups'),
    manifestFile: join(stateDir, 'manifest.json'),
    dashboardFile: join(stateDir, 'dashboard.html'),
    prefsFile: join(configDir, 'prefs.json'),
    claudeDir,
    commandsDir: join(claudeDir, 'commands'),
    pomoCmdFile: join(claudeDir, 'commands', 'pomo.md'),
    claudeSettings: join(claudeDir, 'settings.json'),
  };
};

export const logFileForDate = (date, env = process.env) => {
  const { logsDir } = claudoroPaths(env);
  return join(logsDir, `${date}.jsonl`);
};

export const todayLogFile = (env = process.env) => logFileForDate(today(), env);
