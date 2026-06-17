/**
 * M4: Cross-platform sound and OS notification.
 * Degrades gracefully: platform tool -> terminal bell -> silent.
 * Never throws; never blocks the caller.
 */
import { platform } from 'node:os';
import { spawn } from 'node:child_process';

const IS_MAC = platform() === 'darwin';
const IS_WIN = platform() === 'win32';

/**
 * Spawn `cmd`, resolving when it exits or errors. Returns the exit code, or
 * null if the tool is missing / spawn failed. Never rejects.
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<number|null>}
 */
const trySpawn = (cmd, args) =>
  new Promise((resolve) => {
    try {
      const proc = spawn(cmd, args, {
        stdio: 'ignore',
        detached: false,
        windowsHide: true,
      });
      proc.on('close', (code) => resolve(code));
      proc.on('error', () => resolve(null)); // tool not found — resolve silently
    } catch {
      resolve(null);
    }
  });

const bell = () => process.stdout.write('\x07');

// Cue types with distinct characters
export const CUE = {
  warning: 'warning', // soft tick: pre-end warning
  focusEnd: 'focusEnd', // warm chime: focus block ends
  breakEnd: 'breakEnd', // gentle prompt: break ends
};

/**
 * Fire a sound cue. `mute` suppresses sound but still shows the OS notification.
 * @param {{ cue: string, label?: string|null, mute?: boolean }} opts
 */
export const fireCue = async ({ cue, label, mute = false }) => {
  await Promise.all([mute ? Promise.resolve() : playSound(cue), notify(cue, label)]);
};

const playSound = async (cue) => {
  if (IS_MAC) return playMac(cue);
  if (IS_WIN) return playWin(cue);
  return playLinux(cue);
};

const playMac = async (cue) => {
  // TODO: bundle short audio clips; fall back to system sounds
  const sounds = {
    [CUE.warning]: '/System/Library/Sounds/Tink.aiff',
    [CUE.focusEnd]: '/System/Library/Sounds/Glass.aiff',
    [CUE.breakEnd]: '/System/Library/Sounds/Blow.aiff',
  };
  const sound = sounds[cue] || sounds[CUE.focusEnd];
  const ok = await trySpawn('afplay', [sound]);
  if (ok !== 0) bell();
};

const playLinux = async (_cue) => {
  // TODO: detect paplay / aplay / ffplay; fall back to bell
  bell();
};

const playWin = async (_cue) => {
  // TODO: PowerShell [console]::beep or Media.SoundPlayer
  bell();
};

const notify = async (cue, label) => {
  const messages = {
    [CUE.warning]: 'Focus block ending soon',
    [CUE.focusEnd]: label ? `Focus complete: ${label}` : 'Focus block complete',
    [CUE.breakEnd]: 'Break over — ready to focus?',
  };
  const msg = messages[cue] || messages[CUE.focusEnd];

  if (IS_MAC) {
    await trySpawn('osascript', [
      '-e',
      `display notification "${msg}" with title "Claudoro"`,
    ]);
  } else if (!IS_WIN) {
    await trySpawn('notify-send', ['Claudoro', msg]);
  }
  // Windows: TODO PowerShell notification toast
};
