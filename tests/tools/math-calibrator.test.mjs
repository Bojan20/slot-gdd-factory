#!/usr/bin/env node
/**
 * tests/tools/math-calibrator.test.mjs
 *
 * MATH-PRECISION-3 — RTP calibrator self-test.
 *
 * Asertuje:
 *   1. Calibrator runs and emits report
 *   2. Report has iteration log + converged boolean + final measured RTP
 *   3. Iterations track scatter weight binary search
 *   4. Generic-distribution calibrator does NOT converge for Cash Eruption
 *      (gap surfaces real par sheet need — that JE intencija)
 *   5. Exit code 1 (non-converged) is the expected outcome with generic dist
 *   6. Determinism: same RUNS + same FIXED_SEED → identical iteration log
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const TOOL = join(REPO, 'tools/math-rtp-calibrator.mjs');
const REPORT = join(REPO, 'reports/math-calibrator/cash-eruption-foundry-gdd.json');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  /* (1) Calibrator runs */
  const r = spawnSync('node', [TOOL, '--runs', '20000', '--max-iter', '15'],
    { cwd: REPO, encoding: 'utf8' });
  /* Generic distribution: expect non-converge → exit 1 */
  assert(r.status === 1, `calibrator should exit 1 (non-converged), got ${r.status}\nstdout:\n${r.stdout}`);
  assert(existsSync(REPORT), `report not at ${REPORT}`);

  const s = JSON.parse(readFileSync(REPORT, 'utf8'));

  /* (2) Required fields */
  assert(s.targetRtp === 96, `targetRtp expected 96 (Cash Eruption declared), got ${s.targetRtp}`);
  assert(s.precisionBand === '±0.05%', `precisionBand expected '±0.05%', got ${s.precisionBand}`);
  assert(Array.isArray(s.iterations) && s.iterations.length > 0,
    `iterations array empty`);
  assert(typeof s.converged === 'boolean', `converged should be boolean`);
  assert(typeof s.finalMeasuredRtp === 'number', `finalMeasuredRtp should be number`);

  /* (3) Each iteration has scatterW + measuredRTP + delta */
  for (const it of s.iterations) {
    assert(typeof it.scatterW === 'number', `iter missing scatterW`);
    assert(typeof it.measuredRTP === 'number', `iter missing measuredRTP`);
    assert(typeof it.delta === 'number', `iter missing delta`);
  }

  /* (4) Generic-distribution doesn't converge — that's expected */
  assert(s.converged === false,
    `generic dist should NOT converge (gap surfaces real par sheet need); converged=${s.converged}`);

  /* (5) Determinism — same args → same iteration count + final scatterW */
  const r2 = spawnSync('node', [TOOL, '--runs', '20000', '--max-iter', '15'],
    { cwd: REPO, encoding: 'utf8' });
  assert(r2.status === r.status, `non-deterministic exit code`);
  const s2 = JSON.parse(readFileSync(REPORT, 'utf8'));
  assert(s2.iterations.length === s.iterations.length,
    `non-deterministic iteration count: ${s2.iterations.length} ≠ ${s.iterations.length}`);
  assert(s2.calibrated.scatter === s.calibrated.scatter,
    `non-deterministic final scatter weight`);

  console.log(`✓ math-calibrator.test.mjs — ${s.iterations.length} iter run, converged=${s.converged}, finalRTP=${s.finalMeasuredRtp}%, deterministic`);
} catch (e) {
  console.error('✗ math-calibrator.test.mjs:', e.message);
  process.exit(1);
}
