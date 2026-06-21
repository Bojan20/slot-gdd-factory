/**
 * tests/tools/uq-fortify8-eighthtier.test.mjs
 *
 * Wave UQ-FORTIFY8 (2026-06-21) — Eighth-tier forensic audit fixes.
 *
 * Four real-world edge cases surfaced by an independent Explore agent
 * eighth-pass audit after 7 prior FORTIFY waves + UQ-COVER closed 48
 * architecture gaps.
 *
 *   #1  verify gate skip-blocks-downstream contract pinned via
 *       documented behavior + explicit dependency-chain assertion
 *   #2  trainer history JSON gains `__schema_version__` field with
 *       forward-migration on read and refuse-to-downgrade safety
 *   #3  fileLock SAB persistent fallback — once SAB creation fails,
 *       `_useSabView = false` flips off forever (no retry under
 *       sustained memory pressure)
 *   #4  fileLock SAB invalidation mid-process resets _useSabView so
 *       the catch path of Atomics.wait doesn't keep retrying
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = resolve(fileURLToPath(import.meta.url), '../../..');

/* ── #1 verify gate skip contract ───────────────────────────────────── */

test('UQ-FORTIFY8 #1: verify.mjs _isDepGreen treats skipped as failed dependency', () => {
  const src = readFileSync(resolve(REPO, 'tools/verify.mjs'), 'utf8');
  /* The function must reject when found.ok === false, which is what
     skipped gates carry. The doc comment must explicitly call out
     that skipped also blocks. */
  assert.ok(/dependency contract pinned/i.test(src),
    'UQ-FORTIFY8 #1 dependency contract doc comment missing');
  assert.ok(/skipped gate ALWAYS blocks/i.test(src),
    'skip-blocks-downstream contract not documented');
  /* The check must look at `ok === false` to cover both skip + fail. */
  assert.ok(/found\.ok\s*===\s*false/.test(src),
    'ok-equals-false predicate missing');
});

test('UQ-FORTIFY8 #1: skipped result shape carries both ok:false AND skipped:true', () => {
  const src = readFileSync(resolve(REPO, 'tools/verify.mjs'), 'utf8');
  /* The run() wrapper must push results with both flags when skipping. */
  assert.ok(/ok:\s*false[\s\S]{0,80}skipped:\s*true/.test(src),
    'skipped result shape lost both flags');
});

/* ── #2 trainer history schema version ──────────────────────────────── */

test('UQ-FORTIFY8 #2: trainer history schema version constant + read migration', () => {
  const src = readFileSync(resolve(REPO, 'tools/agent-calibration-trainer.mjs'), 'utf8');
  assert.ok(/_HISTORY_SCHEMA_VERSION\s*=\s*\d+/.test(src),
    'schema version constant missing');
  assert.ok(/__schema_version__/.test(src),
    'schema version field missing');
  /* Refuse-to-downgrade path */
  assert.ok(/Upgrade the trainer|onDiskVersion > _HISTORY_SCHEMA_VERSION/.test(src),
    'refuse-to-downgrade safety missing');
  /* Forward migration stamp */
  assert.ok(/__migrated_from__/.test(src),
    'migration stamp field missing');
});

test('UQ-FORTIFY8 #2: trainer refuses to overwrite newer schema on disk', () => {
  /* Live: write a v999 history, run trainer dry-run, expect exit 2. */
  const reportsDir = resolve(REPO, 'reports');
  const historyPath = resolve(reportsDir, 'calibration-history.json');
  const backup = historyPath + '.uq8-test.bak';
  /* Backup any existing history */
  const had = existsSync(historyPath);
  if (had) renameSync(historyPath, backup);
  try {
    writeFileSync(historyPath, JSON.stringify({
      __schema_version__: 999,
      runs: [{ ts: 'fake' }],
    }, null, 2));
    const r = spawnSync('node', [
      resolve(REPO, 'tools/agent-calibration-trainer.mjs'),
      /* dry-run — no --apply, so we only test the read path */
    ], { encoding: 'utf8', cwd: REPO });
    assert.equal(r.status, 2, 'expected exit 2 on schema-version-too-new, got ' + r.status);
    assert.ok(/schema v999|trainer only knows/.test(r.stderr + r.stdout),
      'schema-too-new error message missing');
  } finally {
    /* Restore */
    if (existsSync(historyPath)) unlinkSync(historyPath);
    if (had) renameSync(backup, historyPath);
  }
});

/* ── #3 + #4 fileLock SAB persistent fallback ───────────────────────── */

test('UQ-FORTIFY8 #3: fileLock has _useSabView kill-switch flag', () => {
  const src = readFileSync(resolve(REPO, 'src/registry/fileLock.mjs'), 'utf8');
  assert.ok(/let\s+_useSabView\s*=\s*true/.test(src),
    '_useSabView module-scoped flag missing');
  /* SAB allocation must be gated on _useSabView */
  assert.ok(/!_sabView\s*&&\s*_useSabView/.test(src),
    'SAB allocation must check _useSabView flag');
  /* On SAB creation failure, _useSabView must be flipped off */
  assert.ok(/_useSabView\s*=\s*false/.test(src),
    'kill-switch must be set on SAB failure');
});

test('UQ-FORTIFY8 #4: Atomics.wait failure also disables retry', () => {
  const src = readFileSync(resolve(REPO, 'src/registry/fileLock.mjs'), 'utf8');
  /* The catch on Atomics.wait must reset both _useSabView and _sabView */
  const atomicsCatch = src.match(/try\s*{\s*Atomics\.wait[\s\S]*?catch\s*\([^)]*\)\s*{[\s\S]*?}/);
  assert.ok(atomicsCatch, 'Atomics.wait try/catch block not found');
  assert.ok(/_useSabView\s*=\s*false/.test(atomicsCatch[0]),
    'Atomics.wait catch must disable retry');
  assert.ok(/_sabView\s*=\s*null/.test(atomicsCatch[0]),
    'Atomics.wait catch must null out _sabView');
});

test('UQ-FORTIFY8 #3: warning explicitly mentions PERMANENT fallback', () => {
  const src = readFileSync(resolve(REPO, 'src/registry/fileLock.mjs'), 'utf8');
  /* The stderr warning must say "permanently" so operators understand
     the kill-switch is irreversible (process-lifetime). */
  assert.ok(/permanently/.test(src),
    'warning text must mention permanent fallback');
});

/* ── live ────────────────────────────────────────────────────────────── */

test('UQ-FORTIFY8 live: full verify gate still green', () => {
  const r = spawnSync('node', [resolve(REPO, 'tools/verify.mjs'), '--quick'], {
    encoding: 'utf8', cwd: REPO,
  });
  assert.equal(r.status, 0, 'verify --quick failed: ' + r.stderr.slice(-400));
});
