/**
 * Test helpers.
 * Use makeTempEnv() to redirect state + config to a throwaway temp dir.
 * Every test that touches the filesystem must use this — never touch ~/
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Create a temp directory tree and return an env override + cleanup function.
 *
 * Usage:
 *   const { env, cleanup } = makeTempEnv();
 *   after(() => cleanup());
 *
 *   const paths = claudoroPaths(env);
 *   readState(env); // reads from the temp dir, not ~/
 */
export const makeTempEnv = () => {
  const base = mkdtempSync(join(tmpdir(), 'claudoro-test-'));
  const env = {
    XDG_STATE_HOME: join(base, 'state'),
    XDG_CONFIG_HOME: join(base, 'config'),
    // Redirect the Claude Code config dir so setup/uninstall tests never touch
    // the developer's real ~/.claude (honours CLAUDE_CONFIG_DIR, see paths.js).
    CLAUDE_CONFIG_DIR: join(base, 'dot-claude'),
  };
  const cleanup = () => rmSync(base, { recursive: true, force: true });
  return { env, base, cleanup };
};

/** Build a minimal valid state for testing. */
export const makeRunningState = (overrides = {}) => ({
  schema: 1,
  run_state: 'running',
  phase: 'focus',
  started: 1000,
  end_epoch: 1000 + 25 * 60,
  planned_min: 25,
  paused_at: null,
  paused_total_sec: 0,
  mode: 'auto',
  label: null,
  set_number: 1,
  set_index: 1,
  current_record_id: '2026-01-01T00:00:00Z-1',
  owner_session: 'test-session',
  alarms_fired: [],
  alarm_pid: null,
  alarm_seq: 0,
  config: { work: 25, short: 5, long: 15, frequency: 4, notify: 1, mute: false },
  ...overrides,
});

export const makeIdleState = (overrides = {}) => ({
  schema: 1,
  run_state: 'idle',
  phase: null,
  started: null,
  end_epoch: null,
  planned_min: null,
  paused_at: null,
  paused_total_sec: 0,
  mode: 'auto',
  label: null,
  set_number: 1,
  set_index: 0,
  current_record_id: null,
  owner_session: null,
  alarms_fired: [],
  alarm_pid: null,
  alarm_seq: 0,
  config: { work: 25, short: 5, long: 15, frequency: 4, notify: 1, mute: false },
  ...overrides,
});
