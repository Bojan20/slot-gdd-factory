#!/usr/bin/env node
/**
 * tests/tools/math-4-wincap.test.mjs
 *
 * MATH-4 — win cap runtime enforcement.
 *
 * Asertuje:
 *   1. Cash Eruption winCap.maxWinX === 50000 (iz GDD MATH-1, ne smartDefaults 5000)
 *   2. winCap blok HookBus subscriptions u src code-u (postSpin priority 100)
 *   3. winCap mode default 'spin' ili 'round'
 *   4. RTP probe sa override-anim cap-om clamp-uje stvarne win-ove (no spin > cap)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');
const CE = join(REPO, 'dist/real-games/cash-eruption-foundry-gdd/model.json');
const BLOCK_SRC = join(REPO, 'src/blocks/winCap.mjs');
const PROBE = join(REPO, 'tools/math-rtp-probe.mjs');
const TEST_GAME = join(REPO, 'dist/real-games/_math4-test-lowcap');

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

function cleanup() {
  if (existsSync(TEST_GAME)) rmSync(TEST_GAME, { recursive: true, force: true });
}

try {
  /* (1) Cash Eruption sad ima real maxWinX iz GDD-a, ne smartDefaults 5000. */
  const m = JSON.parse(readFileSync(CE, 'utf8'));
  assert(m.winCap?.maxWinX === 50000,
    `Cash Eruption winCap.maxWinX expected 50000 (from MATH-1), got ${m.winCap?.maxWinX}`);
  assert(m.payback?.maxWinX === 50000,
    `Cash Eruption payback.maxWinX mirror expected 50000, got ${m.payback?.maxWinX}`);

  /* (2) winCap block source-side HookBus subscriptions. */
  const src = readFileSync(BLOCK_SRC, 'utf8');
  assert(/HookBus\.on\(\s*['"]postSpin['"]/i.test(src),
    'winCap.mjs should subscribe to postSpin');
  assert(/priority:\s*100/.test(src),
    'winCap.mjs postSpin listener should be priority 100 (runs first to clamp)');
  assert(/HookBus\.emit\(\s*['"]onWinCapTriggered['"]/i.test(src),
    'winCap.mjs should emit onWinCapTriggered when cap reached');
  assert(/HookBus\.on\(\s*['"]preSpin['"]/i.test(src),
    'winCap.mjs should reset on preSpin (mode=spin)');
  assert(/HookBus\.on\(\s*['"]onFsTrigger['"]/i.test(src),
    'winCap.mjs should reset on onFsTrigger');

  /* (3) winCap config default fields. */
  assert(m.winCap?.enabled === true || m.winCap?.enabled === undefined,
    `winCap.enabled expected true/undefined, got ${m.winCap?.enabled}`);

  /* (4) Override cap u test fixture i verifikuj probe clamp.
   * Generate test model with very low maxWinX (5× bet) and run probe;
   * max single-spin should never exceed 5 × 1 = 5. */
  mkdirSync(TEST_GAME, { recursive: true });
  const testModel = JSON.parse(JSON.stringify(m));
  testModel.winCap.maxWinX = 5;  /* tight cap */
  writeFileSync(join(TEST_GAME, 'model.json'), JSON.stringify(testModel, null, 2));

  const r = spawnSync('node', [PROBE, '--slug=_math4-test-lowcap', '--runs=5000', '--seed=999'],
    { cwd: REPO, encoding: 'utf8' });
  assert(r.status === 0, `probe exit ${r.status}: ${r.stderr}`);

  const report = JSON.parse(readFileSync(join(REPO, 'reports/math-rtp/_math4-test-lowcap.json'), 'utf8'));
  assert(report.maxSingleSpinX <= 5,
    `maxSingleSpinX expected ≤ 5 (cap), got ${report.maxSingleSpinX}`);

  /* Determinism: cap clamping ne sme da menja RTP determinism. */
  const r2 = spawnSync('node', [PROBE, '--slug=_math4-test-lowcap', '--runs=5000', '--seed=999'],
    { cwd: REPO, encoding: 'utf8' });
  const report2 = JSON.parse(readFileSync(join(REPO, 'reports/math-rtp/_math4-test-lowcap.json'), 'utf8'));
  assert(report.measuredRTP === report2.measuredRTP,
    `cap non-deterministic: ${report.measuredRTP} ≠ ${report2.measuredRTP}`);

  cleanup();
  console.log(`✓ math-4-wincap.test.mjs — Cash Eruption maxWinX=50000, block hooks verified, probe clamp at 5× bet works deterministically`);
} catch (e) {
  cleanup();
  console.error('✗ math-4-wincap.test.mjs:', e.message);
  process.exit(1);
}
