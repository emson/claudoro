/**
 * M3: Passthrough — the normal Claude Code status info that Claudoro composes with (D-004).
 * Reads fields from the Claude Code stdin JSON and re-renders model/context/git.
 * Never clobbers; always composes.
 *
 * Configurable via CLAUDORO_PASSTHROUGH="model,context,git" (default all three).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Fields available in the passthrough, in display order. */
const FIELD_ORDER = ['model', 'context', 'git'];

/**
 * Build the passthrough string from Claude Code's stdin JSON.
 *
 * @param {object} ccJson - Parsed stdin object from Claude Code
 * @param {string} passthrough - Comma-separated list of fields to include
 * @returns {string}
 */
export const renderPassthrough = (ccJson = {}, passthrough = 'model,context,git') => {
  const enabled = new Set(passthrough.split(',').map((f) => f.trim()));
  const parts = [];

  for (const field of FIELD_ORDER) {
    if (!enabled.has(field)) continue;
    const value = extractField(field, ccJson);
    if (value) parts.push(value);
  }

  // Normal intensity (not dim) so the passthrough matches the prompt brightness.
  return parts.join(' · ');
};

const extractField = (field, ccJson) => {
  switch (field) {
    case 'model':
      return ccJson.model?.display_name ?? ccJson.model?.id ?? null;
    case 'context': {
      // Primary path per the Claude Code stdin contract; fall back to older
      // shapes so the segment is resilient to version differences.
      const pct =
        ccJson.context_window?.used_percentage ??
        ccJson.context_percentage ??
        ccJson.context?.used_percentage ??
        null;
      return pct != null ? `${Math.round(pct)}%` : null;
    }
    case 'git':
      return readGitBranch(ccJson.workspace?.current_dir ?? ccJson.cwd);
    default:
      return null;
  }
};

/**
 * Read git branch cheaply from .git/HEAD without spawning a subprocess.
 * Returns null if not in a git repo.
 */
const readGitBranch = (dir) => {
  if (!dir) return null;
  try {
    const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref: refs/heads/')) {
      return head.slice('ref: refs/heads/'.length);
    }
    return head.slice(0, 7); // detached HEAD — short sha
  } catch {
    return null;
  }
};
