#!/usr/bin/env node
/**
 * tests/math/hit-frequency.test.mjs
 *
 * MATH-12 · QA Test #2 — Hit frequency u industry band.
 *
 * Asertuje da measured HF iz probe-a ostaje u [5%, 50%] industry range —
 * isti range V14 M5 koristi za HARD violation gate. Bez ovog testa,
 * generic distribution drift može da dovede HF van band-a a probe ne bi
 * pokazao alarm.
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
  /* Run probe at production scale (20k spins for stable estimate). */
  const r = spawnSync('node', [PROBE, '--runs', '20000', '--seed', '42'], { cwd: REPO });
  assert(r.status === 0, `probe failed`);
  const s = JSON.parse(readFileSync(REPORT, 'utf8'));

  /* Measured HF u industry band */
  assert(s.measuredHF >= 5,  `measured HF ${s.measuredHF}% below industry floor 5%`);
  assert(s.measuredHF <= 50, `measured HF ${s.measuredHF}% above industry ceiling 50%`);

  /* Histogram non-empty */
  const totalHits = Object.values(s.winHistogram).reduce((a, b) => a + b, 0);
  assert(totalHits > 0, `winHistogram has zero hits at 20k runs`);

  /* Most hits should be small wins (<5×) — sanity check on tier distribution */
  const smallHitShare = (s.winHistogram.lt1x + s.winHistogram['1-5x']) / totalHits;
  assert(smallHitShare > 0.3,
    `small-win share ${(smallHitShare*100).toFixed(1)}% suspiciously low — distribution skew`);

  /* Big wins (100×+) should be rare (< 5% of hits) — high-vol but not exotic */
  const bigHitShare = s.winHistogram['100x+'] / totalHits;
  assert(bigHitShare < 0.1,
    `big-win share ${(bigHitShare*100).toFixed(1)}% too high — generic distribution skew`);

  console.log(`✓ hit-frequency.test.mjs — measured HF ${s.measuredHF}% u [5%, 50%] band, small-win share ${(smallHitShare*100).toFixed(1)}%, big-win share ${(bigHitShare*100).toFixed(1)}%`);
} catch (e) {
  console.error('✗ hit-frequency.test.mjs:', e.message);
  process.exit(1);
}
