/**
 * M9: Open a file or URL in the user's default application (browser).
 * Cross-platform, best-effort, never throws: returns false when no opener is
 * available so the caller can degrade to printing the path (D-011).
 */
import { platform } from 'node:os';
import { spawn } from 'node:child_process';

const opener = () => {
  if (platform() === 'darwin') return { cmd: 'open', args: [] };
  if (platform() === 'win32') return { cmd: 'cmd', args: ['/c', 'start', ''] };
  return { cmd: 'xdg-open', args: [] }; // Linux / BSD
};

/**
 * Launch `target` detached so it outlives the CLI process.
 * @param {string} target - file path or URL
 * @returns {boolean} true if the opener was spawned, false if it could not start
 */
export const openPath = (target) => {
  const { cmd, args } = opener();
  try {
    const proc = spawn(cmd, [...args, target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    proc.on('error', () => {}); // opener missing — swallow, caller prints the path
    proc.unref();
    return true;
  } catch {
    return false;
  }
};
