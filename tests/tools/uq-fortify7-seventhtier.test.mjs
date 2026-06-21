/**
 * tests/tools/uq-fortify7-seventhtier.test.mjs
 *
 * Wave UQ-FORTIFY7 (2026-06-21) — Seventh-tier forensic audit fixes.
 *
 * Three real-world residual gaps surfaced by an independent Explore
 * agent seventh-pass audit after 6 prior FORTIFY waves + UQ-COVER
 * closed 45 architecture gaps.
 *
 *   #1  signal-killed child swallowed by `r.status !== 0` check —
 *       SIGTERM/SIGKILL during reconcile must hard-fail (exit 1)
 *       so a stale partial cache never gets pinned in
 *   #2  rollback prevContent snapshot captured AFTER initial read but
 *       AFTER rename — race window where peer write could change the
 *       file between read and rollback. Use the locked-in original
 *       snapshot captured under the SAME lock acquisition.
 *   #3  SAB-per-iteration allocation in fileLock — under high
 *       concurrency the per-poll SharedArrayBuffer churn burned kernel
 *       resources. Allocate ONCE at module scope, reuse across all
 *       acquireLock invocations + emit one-time failure warning.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = resolve(fileURLToPath(import.meta.url), '../../..');

/* ── #1 signal-killed children → hard fail ──────────────────────────── */

test('UQ-FORTIFY7 #1: ingest pdfToText surfaces r.signal', () => {
  const src = readFileSync(resolve(REPO, 'tools/ingest.mjs'), 'utf8');
  assert.ok(/pdftotext\s+killed\s+by\s+signal/.test(src),
    'pdftotext signal-killed branch missing');
  /* Check signal BEFORE checking status (signal is more specific).
     Strip comments first so a `r.status` reference inside the
     explanatory comment doesn't fool the ordering check. */
  const pdfTextFn = src.match(/function pdfToText[\s\S]*?\n\}/);
  assert.ok(pdfTextFn, 'pdfToText fn not found');
  const body = pdfTextFn[0].replace(/\/\*[\s\S]*?\*\//g, '');
  const sigIdx = body.indexOf('r.signal');
  const statIdx = body.indexOf('r.status');
  assert.ok(sigIdx > 0 && statIdx > 0, 'both r.signal and r.status checks must be present');
  assert.ok(sigIdx < statIdx, 'r.signal must be checked BEFORE r.status');
});

test('UQ-FORTIFY7 #1: reconcile signal-kill triggers hardFail error', () => {
  const src = readFileSync(resolve(REPO, 'tools/ingest.mjs'), 'utf8');
  /* Signal-killed reconcile path must throw with hardFail flag */
  assert.ok(/reconcile killed by signal/.test(src),
    'reconcile signal-killed branch missing');
  assert.ok(/err\.hardFail\s*=\s*true/.test(src),
    'hardFail error flag missing');
  /* The catch block must re-throw on hardFail to escalate to outer try */
  assert.ok(/if\s*\(e\s*&&\s*e\.hardFail\)/.test(src),
    'hardFail escalation in catch block missing');
});

/* ── #2 rollback prevContent snapshot ───────────────────────────────── */

test('UQ-FORTIFY7 #2: trainer captures _originalContent under lock', () => {
  const src = readFileSync(resolve(REPO, 'tools/agent-calibration-trainer.mjs'), 'utf8');
  /* The snapshot var must be declared BEFORE the try block and assigned
     to the first readFileSync result. */
  assert.ok(/let\s+_originalContent/.test(src),
    '_originalContent declaration missing');
  assert.ok(/_originalContent\s*=\s*src/.test(src),
    '_originalContent assignment to initial read missing');
  /* Rollback path must write _originalContent, not a re-read prevContent */
  assert.ok(/writeFileSync\(rbTmp,\s*_originalContent\)/.test(src),
    'rollback must restore _originalContent snapshot');
  /* Legacy prevContent re-read after rename should be GONE */
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/const\s+prevContent\s*=\s*readFileSync\(path/.test(codeOnly),
    'legacy prevContent re-read still present');
});

/* ── #3 SAB module-scoped reuse ─────────────────────────────────────── */

test('UQ-FORTIFY7 #3: fileLock pre-allocates SAB once at module scope', () => {
  const src = readFileSync(resolve(REPO, 'src/registry/fileLock.mjs'), 'utf8');
  /* Module-scoped vars must exist */
  assert.ok(/let\s+_sabView\s*=\s*null/.test(src),
    'module-scoped _sabView declaration missing');
  assert.ok(/let\s+_sabFailureWarned\s*=\s*false/.test(src),
    'one-time warning flag missing');
  /* The polling loop must check existence before re-allocating.
     UQ-FORTIFY8 #3 evolved the guard from `if (!_sabView)` to
     `if (!_sabView && _useSabView)` so the kill-switch can pin off
     SAB allocation under sustained failure. Accept either form. */
  assert.ok(/if\s*\(!_sabView(\s*&&\s*_useSabView)?\)/.test(src),
    'lazy alloc guard missing');
  /* Atomics.wait must use the module-scoped view, not a fresh one */
  assert.ok(/Atomics\.wait\(_sabView,\s*0,\s*0,\s*POLL_INTERVAL_MS\)/.test(src),
    'Atomics.wait must use _sabView module-scoped reference');
  /* The legacy per-iteration `new SharedArrayBuffer(4)` inside the loop
     must be gone from the active path (allowed in init guard only). */
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '');
  /* Count: only one `new SharedArrayBuffer` allowed (the lazy init one) */
  const sabCreates = (codeOnly.match(/new\s+SharedArrayBuffer/g) || []).length;
  assert.equal(sabCreates, 1, 'exactly one SharedArrayBuffer creation, got ' + sabCreates);
});

test('UQ-FORTIFY7 #3: SAB creation failure emits one-time stderr warning', () => {
  const src = readFileSync(resolve(REPO, 'src/registry/fileLock.mjs'), 'utf8');
  /* The warn-once path must write to stderr with explanatory text */
  assert.ok(/SharedArrayBuffer unavailable/.test(src),
    'SAB unavailable warning text missing');
  assert.ok(/process\.stderr\.write/.test(src),
    'stderr.write call missing');
  assert.ok(/--max-old-space-size/.test(src) || /container config/.test(src),
    'mitigation hint missing from warning');
});

/* ── live integration sanity ────────────────────────────────────────── */

test('UQ-FORTIFY7 live: lock acquire+release smoke still passes', async () => {
  const result = spawnSync('node', ['-e', `
    const { acquireLock, releaseLock } = await import('${REPO}/src/registry/fileLock.mjs');
    const t = acquireLock('/tmp/uq7-fortify7-smoke-' + Math.random());
    releaseLock(t);
    process.stdout.write('OK');
  `], { encoding: 'utf8' });
  assert.equal(result.stdout, 'OK', 'lock smoke: ' + result.stderr);
});

test('UQ-FORTIFY7 live: --no-llm ingest still exits 0', async () => {
  const SAMPLE = resolve(REPO, 'samples/CRYSTAL_FORGE_GAME_GDD.md');
  const { existsSync } = await import('node:fs');
  if (!existsSync(SAMPLE)) return;
  const r = spawnSync('node', [
    resolve(REPO, 'tools/ingest.mjs'),
    '--file', SAMPLE, '--no-llm', '--slug', 'uq-fortify7-smoke',
  ], { encoding: 'utf8', cwd: REPO });
  assert.equal(r.status, 0, 'stderr: ' + r.stderr);
});
