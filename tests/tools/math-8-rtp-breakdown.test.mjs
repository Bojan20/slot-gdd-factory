#!/usr/bin/env node
/**
 * tests/tools/math-8-rtp-breakdown.test.mjs
 *
 * MATH-8 — RTP source breakdown self-test.
 *
 * Asertuje za Cash Eruption (GDD §4.2):
 *   • 4 canonical sources detected (base lines, base feature, FS lines, FS feature)
 *   • Σ contributions == declared total RTP (±0.5%)
 *   • Each share u (0, 100%)
 *   • Δ = 0 (perfect consistency)
 *   • Section-restricted search ne hvata false positives (kao "47.1% of total RTP" komentar)
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const TOOL = join(REPO, 'tools/math-rtp-breakdown.mjs');
const REPORT = join(REPO, 'reports/math-rtp-breakdown/cash-eruption-foundry-gdd.json');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

try {
  const r = spawnSync('node', [TOOL], { cwd: REPO, encoding: 'utf8' });
  assert(r.status === 0, `breakdown exit ${r.status}: ${r.stderr}`);
  assert(existsSync(REPORT), `report missing at ${REPORT}`);

  const s = JSON.parse(readFileSync(REPORT, 'utf8'));

  /* (1) 4 canonical sources detected */
  assert(s.sources.length === 4,
    `expected 4 sources, got ${s.sources.length}: ${JSON.stringify(s.sources.map(x => x.label))}`);

  const expectedKeys = ['base_line_wins', 'base_feature_collect', 'fs_line_wins', 'fs_feature_collect'];
  for (const ek of expectedKeys) {
    assert(s.sources.some(src => src.key === ek),
      `expected source key '${ek}' not found, got ${s.sources.map(x => x.key).join(', ')}`);
  }

  /* (2) Σ == declared total RTP exact */
  assert(s.totalRtp === 96, `totalRtp expected 96, got ${s.totalRtp}`);
  assert(s.sumShare === 96, `sumShare expected 96, got ${s.sumShare}`);
  assert(s.delta === 0, `delta expected 0, got ${s.delta}`);
  assert(s.consistent === true, `consistent expected true, got ${s.consistent}`);

  /* (3) Per-source values match GDD §4.2 exactly */
  const sourceMap = {};
  for (const src of s.sources) sourceMap[src.key] = src.sharePct;
  assert(sourceMap.base_line_wins === 41.9,
    `base_line_wins expected 41.9, got ${sourceMap.base_line_wins}`);
  assert(sourceMap.base_feature_collect === 40.91,
    `base_feature_collect expected 40.91, got ${sourceMap.base_feature_collect}`);
  assert(sourceMap.fs_line_wins === 7,
    `fs_line_wins expected 7, got ${sourceMap.fs_line_wins}`);
  assert(sourceMap.fs_feature_collect === 6.19,
    `fs_feature_collect expected 6.19, got ${sourceMap.fs_feature_collect}`);

  /* (4) No false-positive Jackpot 47.1% (which is a comment elsewhere in prose) */
  assert(!sourceMap.jackpot, `jackpot should not be detected (section-restricted search), got ${sourceMap.jackpot}`);

  /* (5) Each share u (0, 100%) */
  for (const src of s.sources) {
    assert(src.sharePct > 0 && src.sharePct < 100,
      `${src.key} share ${src.sharePct}% out of range`);
  }

  /* (6) Determinism */
  spawnSync('node', [TOOL], { cwd: REPO });
  const s2 = JSON.parse(readFileSync(REPORT, 'utf8'));
  assert(s2.sumShare === s.sumShare, `non-deterministic sumShare`);

  console.log(`✓ math-8-rtp-breakdown.test.mjs — Cash Eruption 4 sources detected, Σ=96% matches declared, Δ=0, deterministic`);
} catch (e) {
  console.error('✗ math-8-rtp-breakdown.test.mjs:', e.message);
  process.exit(1);
}
