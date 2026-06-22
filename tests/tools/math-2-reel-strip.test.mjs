#!/usr/bin/env node
/**
 * tests/tools/math-2-reel-strip.test.mjs
 *
 * MATH-2 — reel-strip inventory + industry-default weighted distribution.
 *
 * Asertuje da parser pulluje:
 *   - model.reelStrips.baseSetCount       (e.g. 36 za Cash Eruption)
 *   - model.reelStrips.fsSetCount         (e.g. 16)
 *   - model.reelStrips.samplingMode       ('physical-strip' / 'weighted-rng')
 *   - model.reelStrips.kind               ('industry-default-weighted' when par sheet declared)
 *   - model.reelStrips.stop_distribution  (hp/mp/lp/wild/scatter tier weights)
 *
 * Vendor-neutral: konstante su industry standard iz GLI-19 reference.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const CE = join(REPO, 'dist/real-games/cash-eruption-foundry-gdd/model.json');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  const m = JSON.parse(readFileSync(CE, 'utf8'));
  const rs = m.reelStrips || {};

  /* Game-A (Cash Eruption Foundry) eksplicitno deklariše: Base 36 + FS 16 + physical strip sampling. */
  assert(rs.baseSetCount === 36, `reelStrips.baseSetCount expected 36, got ${rs.baseSetCount}`);
  assert(rs.fsSetCount === 16, `reelStrips.fsSetCount expected 16, got ${rs.fsSetCount}`);
  assert(rs.samplingMode === 'physical-strip',
    `reelStrips.samplingMode expected 'physical-strip', got ${rs.samplingMode}`);
  assert(rs.kind === 'industry-default-weighted',
    `reelStrips.kind expected 'industry-default-weighted', got ${rs.kind}`);

  /* stop_distribution per-tier weights present and sane. */
  const sd = rs.stop_distribution || {};
  for (const tier of ['hp', 'mp', 'lp', 'wild', 'scatter']) {
    assert(typeof sd[tier] === 'number',
      `stop_distribution.${tier} expected number, got ${typeof sd[tier]}`);
    assert(sd[tier] > 0 && sd[tier] < 1,
      `stop_distribution.${tier} expected in (0,1), got ${sd[tier]}`);
  }

  /* Per-tier hierarchy: hp < mp < lp (LP simboli češći na strip-u nego HP). */
  assert(sd.hp < sd.mp, `hp (${sd.hp}) should be rarer than mp (${sd.mp})`);
  assert(sd.mp < sd.lp, `mp (${sd.mp}) should be rarer than lp (${sd.lp})`);

  /* Wild + scatter su najređi. */
  assert(sd.wild < sd.hp, `wild (${sd.wild}) should be rarer than hp (${sd.hp})`);
  assert(sd.scatter < sd.hp, `scatter (${sd.scatter}) should be rarer than hp (${sd.hp})`);

  console.log('✓ math-2-reel-strip.test.mjs — Cash Eruption reelStrips verified (36+16, physical-strip, weighted distribution, tier hierarchy)');
} catch (e) {
  console.error('✗ math-2-reel-strip.test.mjs:', e.message);
  process.exit(1);
}
