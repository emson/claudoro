/**
 * M5 history tests (TEST-M5-001, TEST-M5-002 from spec.md)
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTempEnv } from './helpers.js';
import { ensureDirs } from '../src/store.js';
import { appendFileSync } from 'node:fs';
import { todayLogFile } from '../src/platform/paths.js';
import {
  appendRecord,
  readTodayRecords,
  writeBackup,
  listBackups,
  findLastNCompleted,
  undoRecords,
  restoreBackup,
} from '../src/history.js';

const makeRecord = (id, status = 'completed') => ({
  id,
  schema: 1,
  phase: 'focus',
  status,
  started: Math.floor(Date.now() / 1000),
  ended: Math.floor(Date.now() / 1000) + 1500,
  planned_min: 25,
  actual_min: 25,
  config_snapshot: { frequency: 4 },
  label: null,
});

describe('M5: append + read', () => {
  let env, cleanup;
  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
  });
  after(() => cleanup());

  it('appendRecord + readTodayRecords round-trips', () => {
    const r = makeRecord('test-001');
    appendRecord(r, env);
    const records = readTodayRecords(env);
    assert.equal(records.length, 1);
    assert.equal(records[0].id, 'test-001');
  });

  it('skips corrupt trailing lines', () => {
    // Append a valid record, then corrupt the file with a bad line
    const r = makeRecord('test-002');
    appendRecord(r, env);
    appendFileSync(todayLogFile(env), 'NOT JSON\n', 'utf8');
    const records = readTodayRecords(env);
    assert.ok(records.length >= 1, 'should still read valid records');
  });
});

describe('M5: backup + undo + restore (TEST-M5-001, TEST-M5-002)', () => {
  let env, cleanup;
  before(() => {
    ({ env, cleanup } = makeTempEnv());
    ensureDirs(env);
  });
  after(() => cleanup());

  it('writeBackup creates a backup and lists it', () => {
    const r = makeRecord('backup-001');
    appendRecord(r, env);
    const id = writeBackup(env);
    const backups = listBackups(env);
    assert.ok(backups.includes(id), 'backup should be listed');
  });

  it('undo removes records and writes a backup first (TEST-M5-001)', async () => {
    const r1 = makeRecord('undo-001');
    const r2 = makeRecord('undo-002');
    appendRecord(r1, env);
    appendRecord(r2, env);

    const found = findLastNCompleted(2, env);
    assert.ok(found.length >= 2, 'should find 2 completed records');

    const backupId = await undoRecords([found[0]], env);
    assert.ok(backupId, 'backup id should be returned');

    const after = readTodayRecords(env);
    assert.ok(!after.find((r) => r.id === found[0].id), 'undone record should be gone');
  });

  it('restore reverses an undo (TEST-M5-002)', async () => {
    const r = makeRecord('restore-001');
    appendRecord(r, env);
    const before = readTodayRecords(env);

    const found = findLastNCompleted(1, env);
    const backupId = await undoRecords(found, env);
    const afterUndo = readTodayRecords(env);
    assert.ok(afterUndo.length < before.length, 'record removed after undo');

    await restoreBackup(backupId, env);
    const afterRestore = readTodayRecords(env);
    assert.ok(afterRestore.length >= before.length, 'record restored');
  });
});
