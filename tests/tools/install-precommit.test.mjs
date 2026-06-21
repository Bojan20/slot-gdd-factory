/**
 * tests/tools/install-precommit.test.mjs
 *
 * UQ-AUDIT (2026-06-21) — Smoke test for tools/install-precommit.mjs.
 *
 * Asserts:
 *   1. Installer writes .git/hooks/pre-commit with our marker
 *   2. Hook is executable (chmod 0o755)
 *   3. Hook contains all skip refs (MERGE_HEAD, REBASE_HEAD,
 *      CHERRY_PICK_HEAD, REVERT_HEAD) — installer audit fix
 *   4. Re-running installer is idempotent (no foreign-backup created)
 *   5. Foreign hook is backed up, not clobbered
 *
 * The test does NOT execute the hook end-to-end (that would require a
 * staged commit) — we assert on the on-disk artifact only.
 */
import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, copyFileSync, statSync, unlinkSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(import.meta.url), '../../..');
const TOOL = resolve(REPO, 'tools/install-precommit.mjs');
const HOOK = resolve(REPO, '.git/hooks/pre-commit');
const BACKUP = HOOK + '.local-backup';

function run(args = []) {
  return spawnSync('node', [TOOL, ...args], { encoding: 'utf8', cwd: REPO });
}

/* Preserve the existing hook so this test never erases user setup. */
const SAVED = existsSync(HOOK) ? readFileSync(HOOK, 'utf8') : null;
after(() => {
  /* Restore exactly what was there before the test. */
  if (existsSync(BACKUP)) {
    try { unlinkSync(BACKUP); } catch (_) {}
  }
  if (SAVED !== null) writeFileSync(HOOK, SAVED, { mode: 0o755 });
});

test('UQ-AUDIT: installer writes hook with our MARKER', () => {
  const r = run();
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
  assert.ok(existsSync(HOOK));
  const body = readFileSync(HOOK, 'utf8');
  assert.ok(body.includes('UQ-12 verify gate'), 'marker missing in hook');
});

test('UQ-AUDIT: hook is executable (chmod 0o755)', () => {
  run();
  const mode = statSync(HOOK).mode & 0o777;
  assert.equal(mode, 0o755, 'hook should be 0o755, got 0o' + mode.toString(8));
});

test('UQ-AUDIT: hook skips during merge / rebase / cherry-pick / revert', () => {
  run();
  const body = readFileSync(HOOK, 'utf8');
  for (const ref of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    assert.ok(body.includes(ref), 'hook should skip on ' + ref);
  }
  assert.ok(body.includes('rebase-merge') || body.includes('rebase-apply'),
    'hook should detect in-progress rebase dirs');
});

test('UQ-AUDIT: re-running installer is idempotent — no new backup made', () => {
  run();
  /* Capture mtime, run again, assert no backup file appeared from this run. */
  const wasBackupBefore = existsSync(BACKUP);
  run();
  const wasBackupAfter = existsSync(BACKUP);
  assert.equal(wasBackupAfter, wasBackupBefore,
    'idempotent re-run should NOT create a fresh backup of our own hook');
});

test('UQ-AUDIT: foreign hook (no marker) is backed up before overwrite', () => {
  /* Inject a foreign hook missing our MARKER. */
  const foreign = '#!/bin/sh\n# foreign hook\necho hi\n';
  if (existsSync(BACKUP)) unlinkSync(BACKUP);
  writeFileSync(HOOK, foreign, { mode: 0o755 });
  const r = run();
  assert.equal(r.status, 0);
  assert.ok(existsSync(BACKUP), 'foreign hook should be backed up to .local-backup');
  assert.ok(readFileSync(BACKUP, 'utf8').includes('foreign hook'));
  assert.ok(readFileSync(HOOK, 'utf8').includes('UQ-12 verify gate'));
  /* Cleanup the backup; `after()` restores SAVED. */
  unlinkSync(BACKUP);
});
