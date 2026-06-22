#!/usr/bin/env node
/**
 * tests/tools/math-5-volatility.test.mjs
 *
 * MATH-5 — volatility index calculator self-test.
 *
 * Asertuje:
 *   1. Vol calc reads probe report + emits valid summary JSON
 *   2. measuredIdx u [1, 10] range
 *   3. CV (coefficient of variation) > 0 (variance != 0)
 *   4. Tier mapping correct (CV bucket → tier idx)
 *   5. Determinism: re-run on same probe = identical output
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const PROBE = join(REPO, 'tools/math-rtp-probe.mjs');
const VOL = join(REPO, 'tools/math-volatility-calc.mjs');
const REPORT = join(REPO, 'reports/math-volatility/cash-eruption-foundry-gdd.json');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  /* Ensure probe report exists (run smoke if not). */
  if (!existsSync(join(REPO, 'reports/math-rtp/cash-eruption-foundry-gdd.json'))) {
    spawnSync('node', [PROBE, '--runs', '10000', '--seed', '42'], { cwd: REPO });
  }

  /* Run vol calc. */
  const r = spawnSync('node', [VOL], { cwd: REPO, encoding: 'utf8' });
  assert(r.status === 0, `vol calc exit ${r.status}: ${r.stderr || r.stdout}`);
  assert(existsSync(REPORT), `vol report not at ${REPORT}`);

  const s = JSON.parse(readFileSync(REPORT, 'utf8'));

  /* (1) Required fields */
  for (const f of ['mean', 'variance', 'sigma', 'cv', 'measuredTier', 'measuredIdx']) {
    assert(s[f] != null, `vol summary missing ${f}`);
  }

  /* (2) measuredIdx u [1, 10] */
  assert(s.measuredIdx >= 1 && s.measuredIdx <= 10,
    `measuredIdx ${s.measuredIdx} outside [1, 10]`);

  /* (3) CV > 0 (slot bez variance je broken probe) */
  assert(s.cv > 0, `cv expected > 0, got ${s.cv}`);
  assert(s.sigma > 0, `sigma expected > 0, got ${s.sigma}`);

  /* (4) Tier mapping consistency:
   *   cv < 2.5 → low (3)
   *   cv 2.5-5 → low-medium (4)
   *   cv 5-10 → medium (5)
   *   cv 10-20 → medium-high (7)
   *   cv 20-50 → high (8)
   *   cv > 50 → extreme (10)
   */
  const expectedIdx =
    s.cv < 2.5 ? 3 :
    s.cv < 5   ? 4 :
    s.cv < 10  ? 5 :
    s.cv < 20  ? 7 :
    s.cv < 50  ? 8 : 10;
  assert(s.measuredIdx === expectedIdx,
    `measuredIdx ${s.measuredIdx} doesn't match expected ${expectedIdx} for cv=${s.cv}`);

  /* (5) Determinism: re-run on same probe report — identical summary. */
  spawnSync('node', [VOL], { cwd: REPO, encoding: 'utf8' });
  const s2 = JSON.parse(readFileSync(REPORT, 'utf8'));
  assert(s2.cv === s.cv && s2.measuredIdx === s.measuredIdx,
    `non-deterministic: cv ${s2.cv} ≠ ${s.cv}`);

  console.log(`✓ math-5-volatility.test.mjs — Cash Eruption measured ${s.measuredTier} (idx ${s.measuredIdx}), cv ${s.cv}, σ ${s.sigma}, deterministic`);
} catch (e) {
  console.error('✗ math-5-volatility.test.mjs:', e.message);
  process.exit(1);
}
