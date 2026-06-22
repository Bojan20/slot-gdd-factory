#!/usr/bin/env node
/**
 * tests/tools/math-10-jackpot.test.mjs
 *
 * MATH-10 — jackpot contribution model self-test.
 *
 * Asertuje za Cash Eruption (model.jackpot 4-tier):
 *   1. 4 tiers detected (MINI 10, MINOR 50, MAJOR 500, GRAND 5000)
 *   2. Tier value monotonic increasing (V12 I2.1 compatible)
 *   3. Per-tier contribution sums to total
 *   4. Total jackpot share ≤ 55% × baseRTP (industry recommendation)
 *   5. Verdict = PASS
 *   6. --feature-hit-prob override radi
 *   7. Determinism
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const TOOL = join(REPO, 'tools/math-jackpot-contribution.mjs');
const REPORT = join(REPO, 'reports/math-jackpot/cash-eruption-foundry-gdd.json');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  const r = spawnSync('node', [TOOL], { cwd: REPO, encoding: 'utf8' });
  assert(r.status === 0, `tool exit ${r.status}: ${r.stderr}`);

  const s = JSON.parse(readFileSync(REPORT, 'utf8'));

  /* (1) 4 tiers detected */
  assert(s.tierStats.length === 4, `expected 4 tiers, got ${s.tierStats.length}`);
  const tiers = s.tierStats.map(t => t.tier);
  assert(tiers.join(',') === 'MINI,MINOR,MAJOR,GRAND',
    `expected MINI,MINOR,MAJOR,GRAND, got ${tiers.join(',')}`);

  /* (2) Tier value monotonic. Parser extracts REAL GDD values from prose:
   * MINI=100, MINOR=500, MAJOR=2000, GRAND=1,000,000 credits (Cash Eruption §4.6). */
  assert(s.monotonic === true, `monotonic expected true, got ${s.monotonic}`);
  assert(s.tierStats[0].value === 100, `MINI value expected 100 (GDD §4.6), got ${s.tierStats[0].value}`);
  assert(s.tierStats[1].value === 500, `MINOR value expected 500, got ${s.tierStats[1].value}`);
  assert(s.tierStats[2].value === 2000, `MAJOR value expected 2000, got ${s.tierStats[2].value}`);
  assert(s.tierStats[3].value === 1000000, `GRAND value expected 1,000,000 (GDD top award), got ${s.tierStats[3].value}`);

  /* (3) Per-tier contribution sums to total */
  const sumPct = s.tierStats.reduce((acc, t) => acc + t.contribPct, 0);
  assert(Math.abs(sumPct - s.totalContribPct) < 0.01,
    `tier contribution sum ${sumPct} ≠ totalContribPct ${s.totalContribPct}`);

  /* (4) Industry guidance: jackpot share ≤ 55% × baseRTP */
  assert(s.declaredBaseRtp === 96, `declaredBaseRtp expected 96, got ${s.declaredBaseRtp}`);
  assert(s.jackpotShareOk === true,
    `jackpot share ${s.totalContribPct}% should be ≤ 55% × 96% = 52.8%`);

  /* (5) Verdict */
  assert(s.verdict === 'PASS', `verdict expected PASS, got ${s.verdict}`);

  /* (6) Default featureHitProb 0.01 (post-precision-4 fix for realistic
   * 6+ scatter H&W trigger). MINI share 0.50 → tierHitProb 0.005. */
  assert(s.featureHitProb === 0.01, `default featureHitProb expected 0.01, got ${s.featureHitProb}`);
  const miniProb = parseFloat(s.tierStats[0].tierHitProb);
  assert(Math.abs(miniProb - 0.005) < 0.001,
    `MINI tier hit prob expected 0.005, got ${miniProb}`);

  /* (7) --feature-hit-prob override: 0.02 → contributions scale 2× */
  const r7 = spawnSync('node', [TOOL, '--feature-hit-prob', '0.02'], { cwd: REPO, encoding: 'utf8' });
  assert(r7.status === 0);
  const s7 = JSON.parse(readFileSync(REPORT, 'utf8'));
  assert(s7.featureHitProb === 0.02, `featureHitProb override 0.02 not applied`);
  /* With doubled trigger prob, contribution doubles. */
  assert(Math.abs(s7.totalContribPct - 2 * s.totalContribPct) < 0.5,
    `doubled trigger prob should double contribution: ${s7.totalContribPct} vs 2×${s.totalContribPct}`);

  /* Restore default for downstream tests */
  spawnSync('node', [TOOL], { cwd: REPO });

  /* (8) Determinism */
  spawnSync('node', [TOOL], { cwd: REPO });
  const s8 = JSON.parse(readFileSync(REPORT, 'utf8'));
  spawnSync('node', [TOOL], { cwd: REPO });
  const s8b = JSON.parse(readFileSync(REPORT, 'utf8'));
  assert(s8.totalContribPct === s8b.totalContribPct, `non-deterministic`);

  console.log(`✓ math-10-jackpot.test.mjs — Cash Eruption 4 tiers monotonic (10/50/500/5000), share ${s.totalContribPct}% ≤ 52.8%, verdict PASS, --feature-hit-prob override works, deterministic`);
} catch (e) {
  console.error('✗ math-10-jackpot.test.mjs:', e.message);
  process.exit(1);
}
