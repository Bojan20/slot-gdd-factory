#!/usr/bin/env node
/**
 * tests/tools/math-1-paytable-extractor.test.mjs
 *
 * MATH-1 — paytable real vrednosti iz GDD-a.
 *
 * Asertuje da parser pulluje:
 *   - payback.rtp                primary RTP (96.00% u Cash Eruption)
 *   - payback.rtpVariants[]      3 variants (96 / 95 / 93.1%)
 *   - payback.hitFrequency       19.03%
 *   - payback.winFrequency       8.94% (newly added)
 *   - payback.volatilityIdx      8 (HIGH → integer mapping)
 *   - payback.maxWinX            50000 (50,000× total bet)
 *   - winCap.maxWinX             50000 (mirror)
 *
 * Bez ovog testa, MATH-1 može da prođe ali parser regresija ne bi
 * uhvaćena u verify gate.
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
  const p = m.payback || {};

  /* Game-A (Cash Eruption Foundry) ima eksplicitno declared math values
   * u svom GDD-u — najjača test fixture za MATH-1. */
  assert(p.rtp === 96, `payback.rtp expected 96, got ${p.rtp}`);
  assert(Array.isArray(p.rtpVariants), `payback.rtpVariants expected array, got ${typeof p.rtpVariants}`);
  assert(p.rtpVariants.length === 3, `expected 3 variants (96/95/93.1), got ${p.rtpVariants.length}`);
  const variantRtps = p.rtpVariants.map(v => v.rtp).sort((a, b) => b - a);
  assert(variantRtps[0] === 96, `top variant rtp expected 96, got ${variantRtps[0]}`);
  assert(variantRtps[2] === 93.1, `bottom variant rtp expected 93.1, got ${variantRtps[2]}`);

  /* Hold + RTP per variant should sum to ~100% */
  for (const v of p.rtpVariants) {
    assert(Math.abs((v.rtp + v.hold) - 100) < 0.51,
      `variant ${v.label} rtp+hold=${v.rtp + v.hold} not ~100`);
  }

  assert(p.hitFrequency === 19.03, `payback.hitFrequency expected 19.03, got ${p.hitFrequency}`);
  assert(p.winFrequency === 8.94, `payback.winFrequency expected 8.94, got ${p.winFrequency}`);
  assert(p.volatilityIdx === 8, `payback.volatilityIdx expected 8 (HIGH), got ${p.volatilityIdx}`);
  assert(p.maxWinX === 50000, `payback.maxWinX expected 50000, got ${p.maxWinX}`);

  /* winCap mirror */
  assert(m.winCap?.maxWinX === 50000, `winCap.maxWinX expected 50000, got ${m.winCap?.maxWinX}`);

  console.log('✓ math-1-paytable-extractor.test.mjs — Cash Eruption math fields verified (rtp + 3 variants + hf + wf + vol + maxX)');
} catch (e) {
  console.error('✗ math-1-paytable-extractor.test.mjs:', e.message);
  process.exit(1);
}
