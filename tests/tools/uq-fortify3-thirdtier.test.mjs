/**
 * tests/tools/uq-fortify3-thirdtier.test.mjs
 *
 * Wave UQ-FORTIFY3 (2026-06-21) — Third-tier forensic audit fixes.
 *
 * Covers seven defensive fixes discovered by an independent Explore
 * agent forensic pass over UQ-CASH / UQ-TRAIN / UQ-FORTIFY / UQ-FORTIFY2:
 *
 *   #1  race-safe shared queue in kimi-reconcile worker pool
 *   #2  Pass B max-attempts guard (constant + assertion)
 *   #3  durable atomic write (fsync data + dir before rename)
 *   #4  `__self_corrected__` flag consumer in orchestrator E2E telemetry
 *   #5  AGENT_CALIBRATION input sanitization (no md/control-char leak)
 *   #6  ingest exit code 3 on Kimi soft-fail (vs 0 success vs 1 hard)
 *   #7  fileLock PID-reuse guard via acquiredAt + mtime cross-check
 *
 * Each test pins a single invariant from the audit. Failures here mean
 * a regression of the audit fixes.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO = resolve(fileURLToPath(import.meta.url), '../../..');

/* ── #1 race-safe shared queue ─────────────────────────────────────── */

test('UQ-FORTIFY3 #1: kimi-reconcile uses shared queue (not cursor++)', () => {
  const src = readFileSync(resolve(REPO, 'tools/_wave-v-kimi-reconcile.mjs'), 'utf8');
  /* Old design: `const idx = cursor++` inside worker. Active reference
     must be gone — but the comment that documents WHY we replaced it
     is allowed. Strip all /* … *​/ block comments before checking. */
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/const\s+idx\s*=\s*cursor\+\+/.test(codeOnly),
    'cursor++ pattern still present in active code');
  assert.ok(/queue\s*=\s*slugs\.slice\(\)/.test(src),
    'shared queue.slice() pattern missing');
  assert.ok(/queue\.shift\(\)/.test(src),
    'queue.shift() consumer missing');
});

/* ── #2 Pass B max-attempts ─────────────────────────────────────────── */

test('UQ-FORTIFY3 #2: Pass B has explicit max-attempts cap + assertion', () => {
  const src = readFileSync(resolve(REPO, 'tools/_wave-v-kimi-reconcile.mjs'), 'utf8');
  assert.ok(/_PASS_B_MAX_ATTEMPTS\s*=\s*1\b/.test(src),
    'Pass B max-attempts constant missing or not 1');
  assert.ok(/_PASS_B_MAX_ATTEMPTS\s*!==\s*1/.test(src),
    'guard assertion against future drift missing');
  assert.ok(/__pass_b_attempt__/.test(src),
    'Pass B attempt counter not stamped');
});

/* ── #3 durable atomic write ────────────────────────────────────────── */

test('UQ-FORTIFY3 #3: ingest cache-stamp uses fsync before rename', () => {
  const src = readFileSync(resolve(REPO, 'tools/ingest.mjs'), 'utf8');
  /* Must open the tmp file as a handle and sync() it before rename. */
  assert.ok(/await\s+fh\.sync\(\)/.test(src),
    'data fsync before rename missing');
  assert.ok(/await\s+fsp\.rename\(tmpFile,\s*cacheFile\)/.test(src),
    'atomic rename missing');
  /* Parent dir fsync (best-effort) for crash-resilient rename. */
  assert.ok(/dh\.sync\(\)/.test(src),
    'parent directory fsync missing');
});

/* ── #4 self-corrected consumer ─────────────────────────────────────── */

test('UQ-FORTIFY3 #4: orchestrator E2E reads __self_corrected__ telemetry', () => {
  const src = readFileSync(resolve(REPO, 'tools/orchestrator-e2e-test.mjs'), 'utf8');
  assert.ok(/v6SelfCorrected/.test(src),
    'self-corrected aggregation variable missing');
  assert.ok(/__self_corrected__/.test(src),
    'flag read from cache missing');
  assert.ok(/v6PassBAttempts/.test(src),
    'Pass B attempt aggregation missing');
  assert.ok(/__pass_b_attempt__/.test(src),
    'attempt counter consumed');
  /* Stamped into verdict telemetry */
  assert.ok(/telemetry\.v6SelfCorrected/.test(src));
  assert.ok(/telemetry\.v6PassBAttempts/.test(src));
});

/* ── #5 AGENT_CALIBRATION sanitization ─────────────────────────────── */

test('UQ-FORTIFY3 #5: agent-calibration-trainer sanitizes embedded values', () => {
  const src = readFileSync(resolve(REPO, 'tools/agent-calibration-trainer.mjs'), 'utf8');
  assert.ok(/_sanitizeForMd/.test(src),
    'sanitize helper missing');
  assert.ok(/\.replace\(\/`\/g/.test(src),
    'backtick neutralization missing');
  assert.ok(/refusing to write/.test(src),
    'round-trip self-check assertion missing');
});

/* ── #6 ingest exit-code semantics ──────────────────────────────────── */

test('UQ-FORTIFY3 #6: ingest documents exit 3 for soft-fail and routes there', () => {
  const src = readFileSync(resolve(REPO, 'tools/ingest.mjs'), 'utf8');
  assert.ok(/exit 3 — soft-fail/.test(src) || /process\.exit\(3\)/.test(src),
    'exit code 3 path missing');
  assert.ok(/summary\.softFail/.test(src),
    'soft-fail summary marker missing');
  /* Header docstring documents the four exit codes. */
  assert.ok(/3 \(UQ-FORTIFY3\) ingest finished but/.test(src),
    'exit code 3 missing from header docstring');
});

/* ── #7 fileLock PID-reuse guard ────────────────────────────────────── */

test('UQ-FORTIFY3 #7: fileLock stamps acquiredAt + checks mtime drift', () => {
  const src = readFileSync(resolve(REPO, 'src/registry/fileLock.mjs'), 'utf8');
  assert.ok(/acquiredAt:\s*Date\.now\(\)/.test(src),
    'acquiredAt stamp missing in lock payload');
  assert.ok(/meta\.acquiredAt/.test(src),
    'acquiredAt consumed in stale-check');
  assert.ok(/pidMismatch/.test(src),
    'PID mismatch branch missing');
  assert.ok(/PID-reuse/i.test(src),
    'explanatory comment missing');
});

/* ── live smoke for #6 ──────────────────────────────────────────────── */

test('UQ-FORTIFY3 #6 live: --no-llm exits 0 (no soft-fail when LLM explicitly skipped)', () => {
  const SAMPLE = resolve(REPO, 'samples/CRYSTAL_FORGE_GAME_GDD.md');
  if (!statSync(SAMPLE, { throwIfNoEntry: false })) return;
  const r = spawnSync('node', [
    resolve(REPO, 'tools/ingest.mjs'),
    '--file', SAMPLE, '--no-llm', '--slug', 'uq-fortify3-smoke',
  ], { encoding: 'utf8', cwd: REPO });
  assert.equal(r.status, 0, 'explicit --no-llm must exit 0, got ' + r.status + ': ' + r.stderr);
});
