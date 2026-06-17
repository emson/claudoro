/**
 * cmdUndo non-interactive safety: when there is no TTY to prompt on (e.g. the
 * /pomo slash command runs the CLI via Bash command substitution), undo must
 * degrade to a dry-run instead of erroring — show the plan, mutate nothing,
 * and exit cleanly (D-007: never delete unattended, but fail safe not loud).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cmdUndo } from '../src/cli.js';

const sampleRecord = (id) => ({
  id,
  phase: 'focus',
  status: 'completed',
  started: 1_700_000_000,
  planned_min: 25,
  actual_min: 25,
  label: null,
});

describe('cmdUndo: non-interactive degrade-to-dry-run', () => {
  let logged, undoCalled, restore;

  beforeEach(() => {
    logged = [];
    undoCalled = 0;
    const origLog = console.log;
    console.log = (...a) => logged.push(a.join(' '));
    restore = () => {
      console.log = origLog;
    };
  });
  afterEach(() => restore());

  const deps = (tty) => ({
    findLastNCompleted: () => [sampleRecord('r1')],
    findAllForToday: () => [sampleRecord('r1'), sampleRecord('r2')],
    undoRecords: async () => {
      undoCalled += 1;
      return 'backup-id';
    },
    prompt: async () => false,
    tty: () => tty,
  });

  it('non-TTY without --yes shows the plan and removes nothing', async () => {
    await cmdUndo({ positional: [], flags: { today: true } }, deps(false));
    const out = logged.join('\n');
    assert.equal(undoCalled, 0, 'must not mutate without confirmation');
    assert.match(out, /Would remove all 2 record\(s\) for today/);
    assert.match(out, /Re-run with --yes to confirm: pomo undo --today --yes/);
  });

  it('non-TTY with --yes performs the removal', async () => {
    await cmdUndo({ positional: [], flags: { today: true, yes: true } }, deps(false));
    assert.equal(undoCalled, 1, 'must remove when --yes is passed');
  });

  it('non-TTY --json emits needsConfirm without mutating', async () => {
    await cmdUndo({ positional: [], flags: { today: true, json: true } }, deps(false));
    const payload = JSON.parse(logged.join('\n'));
    assert.equal(undoCalled, 0);
    assert.equal(payload.needsConfirm, true);
    assert.equal(payload.dryRun, true);
    assert.equal(payload.backupId, null);
  });
});
