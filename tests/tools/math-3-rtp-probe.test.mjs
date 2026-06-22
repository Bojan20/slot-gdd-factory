#!/usr/bin/env node
/**
 * tests/tools/math-3-rtp-probe.test.mjs
 *
 * MATH-3 — RTP probe self-test.
 *
 * Asertuje da probe:
 *   1. Pokrene se i prijavi exit 0
 *   2. Emit valid summary JSON sa svim required fields
 *   3. measuredRTP > 0 (pravi spin loop, ne stub)
 *   4. measuredHF u industry range (5-50%)
 *   5. Performance > 100k spin/s (sanity check za pure-JS sim)
 *
 * Note: Probe je APPROKSIMACIJA bez real par sheet weights. Measured
 * RTP može da odstupa od declared značajno — to je očekivano. MATH-7
 * WASM oracle će zameniti generic distribution sa real par sheet
 * weights za precision RTP tuning.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
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
  /* Run smoke (10k spins to keep test fast). */
  const r = spawnSync('node', [PROBE, '--runs', '10000', '--seed', '12345'],
    { cwd: REPO, encoding: 'utf8' });

  assert(r.status === 0, `probe exited ${r.status}: ${r.stderr || r.stdout}`);
  assert(existsSync(REPORT), `report not written to ${REPORT}`);

  const s = JSON.parse(readFileSync(REPORT, 'utf8'));

  /* Required fields. */
  assert(typeof s.runs === 'number' && s.runs === 10000, `runs expected 10000, got ${s.runs}`);
  assert(typeof s.measuredRTP === 'number' && s.measuredRTP > 0,
    `measuredRTP expected > 0, got ${s.measuredRTP}`);
  assert(typeof s.measuredHF === 'number' && s.measuredHF > 0,
    `measuredHF expected > 0, got ${s.measuredHF}`);
  assert(typeof s.spinsPerSec === 'number' && s.spinsPerSec > 100000,
    `spinsPerSec expected > 100k, got ${s.spinsPerSec}`);

  /* Sanity: measured HF u industry range. */
  assert(s.measuredHF >= 5 && s.measuredHF <= 50,
    `measuredHF ${s.measuredHF}% outside [5%, 50%] industry range`);

  /* Win histogram present + sum equals hitCount. */
  const wh = s.winHistogram;
  assert(wh, 'winHistogram missing');
  const sumWh = wh.lt1x + wh['1-5x'] + wh['5-25x'] + wh['25-100x'] + wh['100x+'];
  const expectedHits = Math.round(s.measuredHF / 100 * s.runs);
  assert(Math.abs(sumWh - expectedHits) <= 1,
    `winHistogram sum (${sumWh}) does not match hitCount (~${expectedHits})`);

  /* Determinism check: re-run sa istim seed-om mora dati identical measured RTP. */
  const r2 = spawnSync('node', [PROBE, '--runs', '10000', '--seed', '12345'],
    { cwd: REPO, encoding: 'utf8' });
  assert(r2.status === 0, `re-run failed: ${r2.stderr}`);
  const s2 = JSON.parse(readFileSync(REPORT, 'utf8'));
  assert(s2.measuredRTP === s.measuredRTP,
    `non-deterministic: rerun RTP ${s2.measuredRTP} ≠ ${s.measuredRTP}`);

  console.log(`✓ math-3-rtp-probe.test.mjs — probe ran ${s.runs} spins @ ${s.spinsPerSec}/s, measured RTP ${s.measuredRTP}%, HF ${s.measuredHF}%, deterministic seed 12345`);
} catch (e) {
  console.error('✗ math-3-rtp-probe.test.mjs:', e.message);
  process.exit(1);
}
