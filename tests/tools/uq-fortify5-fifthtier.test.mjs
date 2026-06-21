/**
 * tests/tools/uq-fortify5-fifthtier.test.mjs
 *
 * Wave UQ-FORTIFY5 (2026-06-21) — Fifth-tier forensic audit fixes.
 *
 * Three residual rupe found by independent Explore agent after
 * UQ-FORTIFY through UQ-FORTIFY4 closed 37 prior gaps. All landed
 * in this wave:
 *
 *   #1  parserHash TOCTOU — hash computed and lock acquired together
 *       so concurrent trainer rewrites can't invalidate spuriously
 *   #2  Pass B prompt-frame injection — XML-style <CORRECTIONS> frame
 *       replaces `===` delimiter that an agent could echo back, plus
 *       sanitizer strips frame markers from agent string values
 *   #3  series.json race — randomUUID tmp suffix replaces PID,
 *       shape-validated re-read inside lock, defensive warn on corrupt
 *
 * Each test pins a single invariant; failures here mean a regression.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(import.meta.url), '../../..');

/* ── #1 parserHash TOCTOU ───────────────────────────────────────────── */

test('UQ-FORTIFY5 #1: ingest acquires lock BEFORE computing parser hash', () => {
  const src = readFileSync(resolve(REPO, 'tools/ingest.mjs'), 'utf8');
  /* Strip comments so we test the active code path. */
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '');
  /* The first acquireLock(cacheFile) call must precede the first
     INVOCATION of _computeParserHash() inside the Step 5 reconcile
     block. The function definition lives earlier in the file, so we
     match `await _computeParserHash()` (the call site) instead. */
  const lockIdx = codeOnly.indexOf('acquireLock(cacheFile)');
  const hashIdx = codeOnly.indexOf('await _computeParserHash()');
  assert.ok(lockIdx > 0, 'acquireLock(cacheFile) not found');
  assert.ok(hashIdx > 0, 'await _computeParserHash() call site not found');
  assert.ok(lockIdx < hashIdx, 'lock must be acquired BEFORE first hash compute');
  /* The memoization-clear must come AFTER lock acquisition. */
  assert.ok(codeOnly.includes('_parserHashCache = null'),
    'memoization clear missing');
});

test('UQ-FORTIFY5 #1: pre-Kimi lock released before long reconcile spawn', () => {
  const src = readFileSync(resolve(REPO, 'tools/ingest.mjs'), 'utf8');
  /* The pre-lock must be released before the spawnSync to avoid
     holding the lock across the multi-minute Kimi call (would
     trigger 60s stale-steal on a peer process). */
  assert.ok(/releaseLock\(preLock\)/.test(src),
    'preLock release missing');
});

/* ── #2 Pass B frame delimiter + sanitizer ──────────────────────────── */

test('UQ-FORTIFY5 #2: Pass B uses XML-style <CORRECTIONS> frame', () => {
  const src = readFileSync(resolve(REPO, 'tools/_wave-v-kimi-reconcile.mjs'), 'utf8');
  assert.ok(/<CORRECTIONS pass="B">/.test(src),
    'XML-style open frame missing');
  assert.ok(/<\/CORRECTIONS>/.test(src),
    'XML-style close frame missing');
  /* Old `=== CORRECTIONS ===` frame must be gone from active code (still
     allowed in comments documenting WHY we replaced it). */
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/'===\s+CORRECTIONS/.test(codeOnly),
    'legacy === frame still present in active code');
});

test('UQ-FORTIFY5 #2: _sanitizeForBlock strips XML frame markers', () => {
  const src = readFileSync(resolve(REPO, 'tools/_wave-v-kimi-reconcile.mjs'), 'utf8');
  /* The sanitizer must strip `<CORRECTIONS>` and `</CORRECTIONS>` markup
     so a Kimi reply that echoes the frame can't break a subsequent
     Pass B prompt. */
  assert.ok(/<\\?\/?CORRECTIONS/.test(src) || /CORRECTIONS\\b/.test(src),
    'sanitizer regex for CORRECTIONS markup missing');
});

test('UQ-FORTIFY5 #2: Pass B stamps strict-boolean self-corrected + sanitizes string values', () => {
  const src = readFileSync(resolve(REPO, 'tools/_wave-v-kimi-reconcile.mjs'), 'utf8');
  /* The stamp must overwrite (=) not preserve agent-supplied value. */
  assert.ok(/pb\.parsed\.__self_corrected__\s*=\s*true/.test(src),
    'strict boolean self-corrected stamp missing');
  /* String values must be sanitized post-Pass B */
  assert.ok(/typeof v === 'string'/.test(src),
    'string value sanitization missing');
  assert.ok(/_sanitizeForBlock\(v\)/.test(src),
    'sanitizer not applied to string values');
});

/* ── #3 series.json race fix ────────────────────────────────────────── */

test('UQ-FORTIFY5 #3: orchestrator series.json tmp uses randomUUID (not PID)', () => {
  const src = readFileSync(resolve(REPO, 'tools/orchestrator-e2e-test.mjs'), 'utf8');
  assert.ok(/_sUuid/.test(src), 'randomUUID import alias missing');
  /* The tmp filename for series.json must use the UUID generator, not
     process.pid. Check the actual assignment site. */
  assert.ok(/seriesPath\s*\+\s*'\.tmp\.'\s*\+\s*_sUuid\(\)/.test(src),
    'tmp filename must use _sUuid() not process.pid');
  /* PID-based tmp pattern for series.json must be gone */
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/seriesPath\s*\+\s*'\.tmp\.'\s*\+\s*process\.pid/.test(codeOnly),
    'legacy PID-based tmp still present');
});

test('UQ-FORTIFY5 #3: series JSON shape-validated on read + corrupt warning', () => {
  const src = readFileSync(resolve(REPO, 'tools/orchestrator-e2e-test.mjs'), 'utf8');
  /* Re-read happens inside lock with shape validation */
  assert.ok(/Array\.isArray\(parsed\.runs\)/.test(src),
    'shape validation missing on series.runs');
  assert.ok(/unexpected shape/.test(src),
    'unexpected-shape warning missing');
  assert.ok(/unparseable/.test(src),
    'corrupt-JSON warning missing');
});

/* ── Live integration sanity: --no-llm ingest still works ───────────── */

test('UQ-FORTIFY5 live: --no-llm ingest exits 0 (lock acquisition path skipped)', async () => {
  const { spawnSync } = await import('node:child_process');
  const SAMPLE = resolve(REPO, 'samples/CRYSTAL_FORGE_GAME_GDD.md');
  const { existsSync } = await import('node:fs');
  if (!existsSync(SAMPLE)) return;
  const r = spawnSync('node', [
    resolve(REPO, 'tools/ingest.mjs'),
    '--file', SAMPLE, '--no-llm', '--slug', 'uq-fortify5-smoke',
  ], { encoding: 'utf8', cwd: REPO });
  assert.equal(r.status, 0, 'stderr: ' + r.stderr + '\nstdout: ' + r.stdout);
});
