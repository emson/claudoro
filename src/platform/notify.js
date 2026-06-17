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

/**
 * Run spawn candidates in order; resolve true at the first exit code 0.
 * A candidate is [cmd, args]. Missing tool (null) or non-zero falls through.
 * @param {Array<[string, string[]]>} candidates
 * @returns {Promise<boolean>} true if any candidate exited 0
 */
export const tryChain = async (candidates) => {
  for (const [cmd, args] of candidates) {
    const code = await trySpawn(cmd, args);
    if (code === 0) return true;
  }
  return false;
};

const bell = () => process.stdout.write('\x07');

// Cue types with distinct characters
export const CUE = {
  warning: 'warning', // soft tick: pre-end warning
  focusEnd: 'focusEnd', // warm chime: focus block ends
  breakEnd: 'breakEnd', // gentle prompt: break ends
};

// Linux: XDG/freedesktop system sound paths per cue
export const LINUX_OGA = {
  [CUE.warning]: '/usr/share/sounds/freedesktop/stereo/message.oga',
  [CUE.focusEnd]: '/usr/share/sounds/freedesktop/stereo/complete.oga',
  [CUE.breakEnd]: '/usr/share/sounds/freedesktop/stereo/bell.oga',
};

// aplay is WAV-only; use a known ALSA sample rather than the .oga paths
export const LINUX_WAV = '/usr/share/sounds/alsa/Front_Left.wav';

// Windows: [console]::Beep frequencies (Hz) and durations (ms) per cue
export const WIN_BEEP = {
  [CUE.warning]: [880, 200],
  [CUE.focusEnd]: [660, 300],
  [CUE.breakEnd]: [440, 200],
};

/**
 * Build PowerShell args that are safe for non-interactive detached use.
 * @param {string} script
 * @returns {string[]}
 */
export const winPwshArgs = (script) => [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  script,
];

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

const playLinux = async (cue) => {
  const oga = LINUX_OGA[cue] || LINUX_OGA[CUE.focusEnd];
  const ok = await tryChain([
    ['paplay', [oga]],
    ['aplay', ['-q', LINUX_WAV]],
    ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', oga]],
  ]);
  if (!ok) bell();
};

const playWin = async (cue) => {
  const [freq, dur] = WIN_BEEP[cue] || WIN_BEEP[CUE.focusEnd];
  // Prefer modern PowerShell (pwsh), fall back to Windows PowerShell, then bell.
  const script = `[console]::Beep(${freq},${dur})`;
  const ok = await tryChain([
    ['pwsh', winPwshArgs(script)],
    ['powershell', winPwshArgs(script)],
  ]);
  if (!ok) bell();
};

const notify = async (cue, label) => {
  const messages = {
    [CUE.warning]: 'Focus block ending soon',
    [CUE.focusEnd]: label ? `Focus complete: ${label}` : 'Focus block complete',
    [CUE.breakEnd]: 'Break over: ready to focus?',
  };
  const msg = messages[cue] || messages[CUE.focusEnd];

  if (IS_MAC) {
    await trySpawn('osascript', [
      '-e',
      `display notification "${msg}" with title "Claudoro"`,
    ]);
  } else if (IS_WIN) {
    // Escape backticks and double-quotes before interpolation into PowerShell.
    const safe = msg.replace(/`/g, '').replace(/"/g, "'");
    const toast = [
      "$ErrorActionPreference='SilentlyContinue';",
      '[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] > $null;',
      '$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);',
      `$t.GetElementsByTagName('text').Item(0).AppendChild($t.CreateTextNode('Claudoro')) > $null;`,
      `$t.GetElementsByTagName('text').Item(1).AppendChild($t.CreateTextNode('${safe}')) > $null;`,
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Claudoro').Show([Windows.UI.Notifications.ToastNotification]::new($t))`,
    ].join('');
    // Toast unsupported on older Windows / no WinRT: silently skip. The beep is the cue.
    await tryChain([
      ['pwsh', winPwshArgs(toast)],
      ['powershell', winPwshArgs(toast)],
    ]);
  } else {
    // Linux: try modern notify-send with --app-name, fall back to basic form.
    const ok = await tryChain([
      ['notify-send', ['--app-name=Claudoro', 'Claudoro', msg]],
      ['notify-send', ['Claudoro', msg]],
    ]);
    // notify-send not available: no OS notification, audio cue is the signal.
    if (!ok) {
      /* graceful degrade */
    }
  }
};
