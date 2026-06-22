#!/usr/bin/env node
/**
 * tests/math/rtp-determinism.test.mjs
 *
 * MATH-12 · QA Test #1 — RTP probe determinism.
 *
 * Critical invariant: two probe runs sa istim seed-om moraju proizvesti
 * BIT-IDENTICAL output (measuredRTP, hitFreq, winHistogram, maxSingleSpin).
 * Bilo koja non-determinism u RNG path-u je regression vector.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const PROBE = join(REPO, 'tools/math-rtp-probe.mjs');
const REPORT = join(REPO, 'reports/math-rtp/cash-eruption-foundry-gdd.json');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  /* Run 1 */
  spawnSync('node', [PROBE, '--runs', '5000', '--seed', '777'], { cwd: REPO });
  const s1 = JSON.parse(readFileSync(REPORT, 'utf8'));

  /* Run 2 — same seed */
  spawnSync('node', [PROBE, '--runs', '5000', '--seed', '777'], { cwd: REPO });
  const s2 = JSON.parse(readFileSync(REPORT, 'utf8'));

  /* Run 3 — different seed (sanity check that seed actually matters) */
  spawnSync('node', [PROBE, '--runs', '5000', '--seed', '111'], { cwd: REPO });
  const s3 = JSON.parse(readFileSync(REPORT, 'utf8'));

  /* Same seed → bit-identical RTP, HF, max spin */
  assert(s1.measuredRTP === s2.measuredRTP,
    `measuredRTP non-deterministic: ${s1.measuredRTP} ≠ ${s2.measuredRTP}`);
  assert(s1.measuredHF === s2.measuredHF,
    `measuredHF non-deterministic: ${s1.measuredHF} ≠ ${s2.measuredHF}`);
  assert(s1.maxSingleSpinX === s2.maxSingleSpinX,
    `maxSingleSpin non-deterministic: ${s1.maxSingleSpinX} ≠ ${s2.maxSingleSpinX}`);
  assert(s1.longestLosingStreak === s2.longestLosingStreak,
    `longestLosingStreak non-deterministic`);

  /* Histogram bit-identical */
  for (const k of Object.keys(s1.winHistogram)) {
    assert(s1.winHistogram[k] === s2.winHistogram[k],
      `winHistogram[${k}] non-deterministic: ${s1.winHistogram[k]} ≠ ${s2.winHistogram[k]}`);
  }

  /* Different seed → different RTP (seed actually affects output) */
  assert(s1.measuredRTP !== s3.measuredRTP || s1.measuredHF !== s3.measuredHF,
    `seed 777 and 111 produced identical output — seed not affecting RNG`);

  console.log(`✓ rtp-determinism.test.mjs — seed 777 = bit-identical (RTP ${s1.measuredRTP}%, HF ${s1.measuredHF}%, histogram), seed 111 differs`);
} catch (e) {
  console.error('✗ rtp-determinism.test.mjs:', e.message);
  process.exit(1);
}
